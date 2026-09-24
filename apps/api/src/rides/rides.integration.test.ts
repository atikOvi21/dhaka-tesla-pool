import { beforeAll, afterAll, describe, it, expect } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import { createRideService } from "./service.js";
import { createRideRouter } from "./index.js";
import { createAuth, type AuthRuntime } from "../auth/index.js";
import { createApp } from "../app.js";
import { soloFare } from "./fare.js";
const url = process.env.AUTH_TEST_DATABASE_URL;
if (
  !url ||
  new URL(url).pathname !== "/dhaka_tesla_auth_test" ||
  process.env.DATABASE_URL !== url
)
  throw new Error("Use the isolated auth test database through test:rides.");
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url }),
});
const service = createRideService(db);
let routeId: string,
  secondRoute: string,
  passwordHash: string,
  auth: AuthRuntime,
  app: ReturnType<typeof createApp>;
beforeAll(async () => {
  routeId = (
    await db.route.findFirstOrThrow({ where: { demo_distance_meters: 3000 } })
  ).id;
  secondRoute = (
    await db.route.findFirstOrThrow({ where: { demo_distance_meters: 4000 } })
  ).id;
  passwordHash = (
    await db.user.findUniqueOrThrow({
      where: { email: "nusrat@demo.dhaka.test" },
    })
  ).password_hash;
  auth = await createAuth({
    db,
    connectionString: url!,
    secret: "test-only-secret".repeat(4),
    origins: ["http://localhost:5173"],
    secureCookie: false,
    trustProxy: 0,
    credentialLimit: 1000,
    bootstrapLimit: 1000,
  });
  app = createApp(async () => {}, auth, createRideRouter(db, auth));
}, 20000);
afterAll(async () => {
  await auth.close();
  await db.$disconnect();
});
async function passenger() {
  return db.user.create({
    data: {
      name: "Test Passenger",
      email: randomUUID() + "@ride.test",
      password_hash: passwordHash,
    },
  });
}
async function driver(online = true, capacity = 3) {
  return db.user.create({
    data: {
      name: "Test Driver",
      email: randomUUID() + "@ride.test",
      password_hash: passwordHash,
      role: "DRIVER",
      driver_profile: { create: { online } },
      vehicle: { create: { name: "Test Bullet", capacity } },
    },
  });
}
async function fixture(seats = 1) {
  const p = await passenger(),
    d = await driver();
  const r = await service.create(p.id, { routeId, seats }, randomUUID());
  return { p, d, r: r.booking };
}
const code = (value: Promise<unknown>, expected = "STATE_CONFLICT") =>
  expect(value).rejects.toMatchObject({ code: expected });
async function assertAllocation(poolId: string) {
  const pool = await db.pool.findUniqueOrThrow({
    where: { id: poolId },
    include: { memberships: true },
  });
  expect(pool.allocated_seats).toBe(
    pool.memberships
      .filter((m) => !m.released_at)
      .reduce((sum, m) => sum + m.seats, 0),
  );
  expect(pool.allocated_seats).toBeGreaterThanOrEqual(0);
  expect(pool.allocated_seats).toBeLessThanOrEqual(pool.capacity_snapshot);
}
describe("single booking lifecycle on real PostgreSQL", () => {
  it("calculates half-up integer fares and seat multiplication", () => {
    expect(soloFare(1, 3000)).toBe(5000);
    expect(soloFare(3, 3000)).toBe(15000);
    expect(soloFare(1, 500, 0, 1)).toBe(1);
    expect(soloFare(1, 499, 0, 1)).toBe(0);
    expect(soloFare(3, 500, 0, 1)).toBe(2);
    expect(() => soloFare(0, 3000)).toThrow();
    expect(() => soloFare(2147483647, 2147483647)).toThrow();
  });
  it("completes the journey, fixes fares at arrival, preserves history, and avoids duplicate side effects", async () => {
    const { p, d, r } = await fixture(2);
    expect(r.fare.soloMaximumPoisha).toBe(10000);
    expect(r.fare.finalFarePoisha).toBeNull();
    let pool = await service.accept(d.id, r.id);
    expect(pool.members).toHaveLength(1);
    expect(pool.allocatedSeats).toBe(2);
    expect((await service.accept(d.id, r.id)).id).toBe(pool.id);
    await code(service.availability(d.id, false), "ACTIVE_RESOURCE_EXISTS");
    await code(service.transition(d.id, pool.id, "start"));
    await code(service.transition(d.id, pool.id, "complete"));
    pool = await service.transition(d.id, pool.id, "arrive");
    const fare = (await service.booking(p.id, r.id)).fare;
    expect(fare.finalFarePoisha).toBe(10000);
    expect(fare.finalizedAt).not.toBeNull();
    await service.transition(d.id, pool.id, "arrive");
    await code(service.cancel(p.id, r.id));
    await service.transition(d.id, pool.id, "start");
    await service.transition(d.id, pool.id, "start");
    await code(service.transition(d.id, pool.id, "arrive"));
    await code(service.transition(d.id, pool.id, "complete"));
    await service.transition(d.id, pool.id, "complete", pool.members[0].id);
    await service.transition(d.id, pool.id, "complete", pool.members[0].id);
    await assertAllocation(pool.id);
    await service.transition(d.id, pool.id, "complete");
    await service.transition(d.id, pool.id, "complete");
    expect(await service.activeBooking(p.id)).toBeNull();
    expect(await service.activePool(d.id)).toBeNull();
    expect((await service.booking(p.id, r.id)).fare).toEqual(fare);
    expect((await service.bookings(p.id, { limit: 20 })).items[0].status).toBe(
      "COMPLETED",
    );
    expect((await service.pools(d.id, { limit: 20 })).items[0].status).toBe(
      "COMPLETED",
    );
    expect(
      await db.rideEvent.count({
        where: { OR: [{ request_id: r.id }, { pool_id: pool.id }] },
      }),
    ).toBe(7);
    expect((await service.availability(d.id, false)).online).toBe(false);
    await code(service.accept(d.id, r.id));
  });

  it("rolls back fare, status and event writes if a later database write fails", async () => {
    const {p,d,r}=await fixture(), pool=await service.accept(d.id,r.id);
    const blocker=await db.rideEvent.create({data:{actor_id:d.id,request_id:r.id,pool_id:pool.id,event_type:"DRIVER_ARRIVED",operation_key:"DRIVER_ARRIVED:"+r.id}});
    try {
      await expect(service.transition(d.id,pool.id,"arrive")).rejects.toThrow();
      const booking=await service.booking(p.id,r.id);
      expect(booking.status).toBe("MATCHED");
      expect(booking.fare.finalFarePoisha).toBeNull();
      expect((await service.pool(d.id,pool.id)).status).toBe("ACCEPTED");
      await assertAllocation(pool.id);
    } finally { await db.rideEvent.delete({where:{id:blocker.id}}); }
    expect((await service.transition(d.id,pool.id,"arrive")).status).toBe("DRIVER_ARRIVED");
  });
  it("rejects unsupported routes and seats without inserting requests", async () => {
    const p = await passenger();
    for (const input of [
      { routeId: randomUUID(), seats: 1 },
      { routeId, seats: 0 },
      { routeId, seats: -1 },
      { routeId, seats: 1.5 },
      { routeId, seats: 4 },
    ])
      await code(service.create(p.id, input, randomUUID()), "VALIDATION_ERROR");
    expect(await db.rideRequest.count({ where: { passenger_id: p.id } })).toBe(
      0,
    );
  });
  it("enforces one active booking and serializes concurrent idempotent retries", async () => {
    const p = await passenger(),
      key = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        service.create(p.id, { routeId, seats: 1 }, key),
      ),
    );
    expect(new Set(results.map((r) => r.booking.id)).size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    await code(
      service.create(p.id, { routeId: secondRoute, seats: 1 }, key),
      "IDEMPOTENCY_CONFLICT",
    );
    await code(
      service.create(p.id, { routeId, seats: 2 }, randomUUID()),
      "ACTIVE_RESOURCE_EXISTS",
    );
    await service.cancel(p.id, results[0].booking.id);
    expect(
      (await service.create(p.id, { routeId, seats: 1 }, key)).booking.status,
    ).toBe("CANCELLED");
    const other = await passenger();
    expect(
      (await service.create(other.id, { routeId, seats: 1 }, key)).created,
    ).toBe(true);
  });
  it("allows only one winner for concurrent different booking intents by one passenger", async () => {
    const p = await passenger();
    const results = await Promise.allSettled(
      [1, 2].map((seats) =>
        service.create(p.id, { routeId, seats }, randomUUID()),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.rideRequest.count({ where: { passenger_id: p.id } })).toBe(
      1,
    );
  });
  it("rejects offline and over-capacity acceptance", async () => {
    const { r } = await fixture(2),
      offline = await driver(false),
      small = await driver(true, 1);
    await code(service.accept(offline.id, r.id));
    await code(service.accept(small.id, r.id), "CAPACITY_CONFLICT");
    expect(
      (await db.rideRequest.findUniqueOrThrow({ where: { id: r.id } })).status,
    ).toBe("REQUESTED");
  });
  it("allows one driver to win when two drivers accept one booking", async () => {
    const { d, r } = await fixture(),
      other = await driver();
    const results = await Promise.allSettled([
      service.accept(d.id, r.id),
      service.accept(other.id, r.id),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.poolMembership.count({ where: { request_id: r.id } })).toBe(
      1,
    );
    const winner = results.find((r) => r.status === "fulfilled")!;
    if (winner.status === "fulfilled") await assertAllocation(winner.value.id);
  });
  it("allows one pool when a driver accepts two different requests concurrently", async () => {
    const { d, r } = await fixture(),
      p2 = await passenger();
    const r2 = await service.create(p2.id, { routeId, seats: 1 }, randomUUID());
    const results = await Promise.allSettled([
      service.accept(d.id, r.id),
      service.accept(d.id, r2.booking.id),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const pool = await service.activePool(d.id);
    expect(pool?.members).toHaveLength(1);
    await assertAllocation(pool!.id);
  });
  it("cancels waiting and matched requests without charge and releases exactly once", async () => {
    const waiting = await fixture();
    await service.cancel(waiting.p.id, waiting.r.id);
    const { p, d, r } = await fixture(3),
      pool = await service.accept(d.id, r.id);
    await service.cancel(p.id, r.id);
    await service.cancel(p.id, r.id);
    const result = await service.pool(d.id, pool.id);
    expect(result.status).toBe("CANCELLED");
    expect(result.allocatedSeats).toBe(0);
    expect(result.members[0].releasedAt).not.toBeNull();
    expect((await service.booking(p.id, r.id)).fare.finalFarePoisha).toBeNull();
    expect((await service.pools(d.id, { limit: 20 })).items[0].status).toBe(
      "CANCELLED",
    );
    await assertAllocation(pool.id);
    await code(service.transition(d.id, pool.id, "arrive"));
    expect(
      await db.rideEvent.count({
        where: { request_id: r.id, event_type: "REQUEST_CANCELLED" },
      }),
    ).toBe(1);
  });
  it("serializes cancellation racing acceptance without orphan seats", async () => {
    const { p, d, r } = await fixture(2);
    await Promise.allSettled([
      service.accept(d.id, r.id),
      service.cancel(p.id, r.id),
    ]);
    const result = await service.booking(p.id, r.id);
    expect(result.status).toBe("CANCELLED");
    expect(await service.activePool(d.id)).toBeNull();
    if (result.pool) await assertAllocation(result.pool.id);
  });
  it("serializes cancellation racing arrival with all-or-nothing finalization", async () => {
    for (const reverse of [false, true]) {
      const { p, d, r } = await fixture(),
        pool = await service.accept(d.id, r.id);
      const calls = [
        () => service.cancel(p.id, r.id),
        () => service.transition(d.id, pool.id, "arrive"),
      ];
      if (reverse) calls.reverse();
      const results = await Promise.allSettled(calls.map((f) => f()));
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const b = await service.booking(p.id, r.id),
        state = await service.pool(d.id, pool.id);
      if (b.status === "CANCELLED") {
        expect(b.fare.finalFarePoisha).toBeNull();
        expect(state.status).toBe("CANCELLED");
      } else {
        expect(b.status).toBe("DRIVER_ARRIVED");
        expect(b.fare.finalFarePoisha).toBe(5000);
        expect(state.status).toBe("DRIVER_ARRIVED");
      }
      await assertAllocation(pool.id);
    }
  });
  it("serializes going offline against acceptance", async () => {
    const { d, r } = await fixture();
    const results = await Promise.allSettled([
      service.availability(d.id, false),
      service.accept(d.id, r.id),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const active = await service.activePool(d.id),
      profile = await service.profile(d.id);
    expect(active ? profile.online : !profile.online).toBe(true);
  });
  it("protects ownership, membership boundaries and private data", async () => {
    const { p, d, r } = await fixture(),
      otherP = await passenger(),
      otherD = await driver(),
      pool = await service.accept(d.id, r.id);
    await code(service.booking(otherP.id, r.id), "NOT_FOUND");
    await code(service.cancel(otherP.id, r.id), "NOT_FOUND");
    await code(service.pool(otherD.id, pool.id), "NOT_FOUND");
    await code(service.transition(otherD.id, pool.id, "arrive"), "NOT_FOUND");
    await code(
      service.transition(d.id, pool.id, "complete", randomUUID()),
      "NOT_FOUND",
    );
    const serialized = JSON.stringify(pool);
    for (const secret of ["password", "email", "fare", "Poisha", p.email])
      expect(serialized).not.toContain(secret);
    const waiting = JSON.stringify(await service.waiting(d.id, { limit: 100 }));
    for (const secret of ["password", "email", "passengerName", "Poisha"])
      expect(waiting).not.toContain(secret);
    expect(
      (await service.bookings(otherP.id, { limit: 20 })).items,
    ).toHaveLength(0);
  });
  it("keeps fare snapshots despite a reference distance change", async () => {
    const source = await db.route.findUniqueOrThrow({ where: { id: routeId } });
    const zone = await db.zone.create({
      data: { name: "Test " + randomUUID() },
    });
    const route = await db.route.create({
      data: {
        pickup_zone_id: zone.id,
        destination_zone_id: source.destination_zone_id,
        compatibility_group: "test",
        demo_distance_meters: 3000,
      },
    });
    const p = await passenger(),
      d = await driver();
    const r = await service.create(
      p.id,
      { routeId: route.id, seats: 1 },
      randomUUID(),
    );
    await db.route.update({
      where: { id: route.id },
      data: { demo_distance_meters: 9000 },
    });
    const pool = await service.accept(d.id, r.booking.id);
    await service.transition(d.id, pool.id, "arrive");
    const b = await service.booking(p.id, r.booking.id);
    expect(b.route.demoDistanceMeters).toBe(3000);
    expect(b.fare.finalFarePoisha).toBe(5000);
  });
  it("paginates own history without duplicates and includes terminal records", async () => {
    const p = await passenger();
    for (let i = 0; i < 3; i++) {
      const r = await service.create(p.id, { routeId, seats: 1 }, randomUUID());
      await service.cancel(p.id, r.booking.id);
    }
    const first = await service.bookings(p.id, { limit: 2 });
    expect(first.items).toHaveLength(2);
    const cursor = JSON.parse(
      Buffer.from(first.nextCursor!, "base64url").toString(),
    );
    const last = await service.bookings(p.id, {
      limit: 2,
      cursor: { at: new Date(cursor.at), id: cursor.id },
    });
    expect(last.items).toHaveLength(1);
    expect(last.nextCursor).toBeNull();
    expect(new Set([...first.items, ...last.items].map((r) => r.id)).size).toBe(
      3,
    );
  });
  it("enforces HTTP roles, CSRF, strict validation, idempotency headers and response envelopes", async () => {
    const p = await passenger(),
      d = await driver();
    async function login(email: string) {
      const agent = request.agent(app);
      const csrf = await agent.get("/api/v1/auth/csrf");
      expect(
        (
          await agent
            .post("/api/v1/auth/login")
            .set("Origin", "http://localhost:5173")
            .set("X-CSRF-Token", csrf.body.data.csrfToken)
            .send({ email, password: "DemoOnly!Dhaka2026" })
        ).status,
      ).toBe(200);
      const token = (await agent.get("/api/v1/auth/csrf")).body.data.csrfToken;
      return { agent, token };
    }
    const a = await login(p.email),
      b = await login(d.email);
    expect((await request(app).get("/api/v1/zones")).status).toBe(200);
    expect(
      (await request(app).get("/api/v1/routes?pickupZoneId=bad")).status,
    ).toBe(400);
    expect(
      (await request(app).get("/api/v1/ride-requests/active")).status,
    ).toBe(401);
    expect((await a.agent.get("/api/v1/driver/profile")).status).toBe(403);
    expect((await b.agent.get("/api/v1/ride-requests")).status).toBe(403);
    expect((await a.agent.get("/api/v1/ride-requests?cursor=bad")).status).toBe(
      400,
    );
    expect((await a.agent.get("/api/v1/ride-requests?limit=101")).status).toBe(
      400,
    );
    expect(
      (await a.agent.post("/api/v1/ride-requests").send({ routeId, seats: 1 }))
        .status,
    ).toBe(403);
    const post = (path: string, body: object, key?: string) => {
      const call = a.agent
        .post("/api/v1" + path)
        .set("Origin", "http://localhost:5173")
        .set("X-CSRF-Token", a.token);
      if (key) call.set("Idempotency-Key", key);
      return call.send(body);
    };
    expect((await post("/ride-requests", { routeId, seats: 1 })).status).toBe(
      400,
    );
    expect(
      (
        await post(
          "/ride-requests",
          { routeId, seats: 1, passengerId: p.id },
          randomUUID(),
        )
      ).status,
    ).toBe(400);
    expect(
      (await post("/fare-estimates", { routeId, seats: 1 })).body.data
        .soloMaximumPoisha,
    ).toBe(5000);
    const key = randomUUID(),
      created = await post("/ride-requests", { routeId, seats: 1 }, key);
    expect(created.status).toBe(201);
    expect(
      (await post("/ride-requests", { routeId, seats: 1 }, key)).status,
    ).toBe(200);
    expect(
      (await a.agent.get("/api/v1/ride-requests/" + created.body.data.id)).body
        .data.id,
    ).toBe(created.body.data.id);
    expect(
      (
        await b.agent
          .patch("/api/v1/driver/availability")
          .set("Origin", "http://localhost:5173")
          .set("X-CSRF-Token", b.token)
          .send({ online: false })
      ).status,
    ).toBe(200);
  }, 20000);
});
