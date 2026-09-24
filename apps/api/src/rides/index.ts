import { Router, type Request } from "express";
import { z } from "zod";
import { AuthError } from "../auth/service.js";
import type { AuthRuntime } from "../auth/index.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { createRideService, type Page } from "./service.js";
const uuid = z
  .string()
  .uuid()
  .transform((v) => v.toLowerCase());
const input = z
  .object({ routeId: uuid, seats: z.number().int().positive().max(2147483647) })
  .strict();
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new AuthError(
      400,
      "VALIDATION_ERROR",
      "Check the request fields, identifiers and supported values.",
    );
  return result.data;
}
function page(req: Request): Page {
  const value = parse(
    z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(20),
        cursor: z.string().max(512).optional(),
      })
      .strict(),
    req.query,
  );
  if (!value.cursor) return { limit: value.limit };
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value.cursor)) throw new Error();
    const c = parse(
      z.object({ at: z.string().datetime(), id: uuid }).strict(),
      JSON.parse(Buffer.from(value.cursor, "base64url").toString()),
    );
    return { limit: value.limit, cursor: { at: new Date(c.at), id: c.id } };
  } catch {
    throw new AuthError(400, "VALIDATION_ERROR", "Invalid history cursor.");
  }
}
export function createRideRouter(db: PrismaClient, auth: AuthRuntime) {
  const router = Router(),
    service = createRideService(db);
  const id = (req: Request) => parse(uuid, req.params.id);
  const user = (req: Request) => req.currentUser!.id;
  const empty = (req: Request) => parse(z.object({}).strict(), req.body ?? {});
  router.get("/zones", async (_req, res) =>
    res.json({ data: await service.zones() }),
  );
  router.get("/routes", async (req, res) => {
    const q = parse(
      z.object({ pickupZoneId: uuid.optional() }).strict(),
      req.query,
    );
    res.json({ data: await service.routes(q.pickupZoneId) });
  });
  const passenger = Router();
  passenger.use(auth.requireAuth, auth.requireRole("PASSENGER"));
  passenger.post("/fare-estimates", async (req, res) =>
    res.json({ data: await service.estimate(parse(input, req.body)) }),
  );
  passenger.post("/ride-requests", async (req, res) => {
    const key = parse(
      z
        .string()
        .min(1)
        .max(128)
        .regex(/^[\x20-\x7e]+$/),
      req.get("Idempotency-Key"),
    );
    const result = await service.create(user(req), parse(input, req.body), key);
    res.status(result.created ? 201 : 200).json({ data: result.booking });
  });
  passenger.get("/ride-requests/active", async (req, res) =>
    res.json({ data: await service.activeBooking(user(req)) }),
  );
  passenger.get("/ride-requests", async (req, res) =>
    res.json({ data: await service.bookings(user(req), page(req)) }),
  );
  passenger.get("/ride-requests/:id", async (req, res) =>
    res.json({ data: await service.booking(user(req), id(req)) }),
  );
  passenger.post("/ride-requests/:id/cancel", async (req, res) => {
    empty(req);
    res.json({ data: await service.cancel(user(req), id(req)) });
  });
  const driver = Router();
  driver.use(auth.requireAuth, auth.requireRole("DRIVER"));
  driver.get("/profile", async (req, res) =>
    res.json({ data: await service.profile(user(req)) }),
  );
  driver.patch("/availability", async (req, res) =>
    res.json({
      data: await service.availability(
        user(req),
        parse(z.object({ online: z.boolean() }).strict(), req.body).online,
      ),
    }),
  );
  driver.get("/ride-requests", async (req, res) =>
    res.json({ data: await service.waiting(user(req), page(req)) }),
  );
  driver.post("/ride-requests/:id/accept", async (req, res) => {
    empty(req);
    res.json({ data: await service.accept(user(req), id(req)) });
  });
  driver.get("/pools/active", async (req, res) =>
    res.json({ data: await service.activePool(user(req)) }),
  );
  driver.get("/pools", async (req, res) =>
    res.json({ data: await service.pools(user(req), page(req)) }),
  );
  driver.get("/pools/:id", async (req, res) =>
    res.json({ data: await service.pool(user(req), id(req)) }),
  );
  for (const action of ["arrive", "start", "complete"] as const)
    driver.post("/pools/:id/" + action, async (req, res) => {
      empty(req);
      res.json({ data: await service.transition(user(req), id(req), action) });
    });
  driver.post(
    "/pools/:id/memberships/:membershipId/complete",
    async (req, res) => {
      empty(req);
      res.json({
        data: await service.transition(
          user(req),
          id(req),
          "complete",
          parse(uuid, req.params.membershipId),
        ),
      });
    },
  );
  router.use("/driver", driver);
  router.use(passenger);
  return router;
}
