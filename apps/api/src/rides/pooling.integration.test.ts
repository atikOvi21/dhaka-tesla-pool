import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import { createRideService } from "./service.js";
import { sharedFare } from "./fare.js";
import { createAuth, type AuthRuntime } from "../auth/index.js";
import { createRideRouter } from "./index.js";
import { createApp } from "../app.js";
const url = process.env.AUTH_TEST_DATABASE_URL;
if (
  !url ||
  new URL(url).pathname !== "/dhaka_tesla_auth_test" ||
  process.env.DATABASE_URL !== url
)
  throw Error("Use the isolated test database.");
// Independent adapters, pools, PostgreSQL connections and Express/session instances.
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url, max: 1 }),
});
const other = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url, max: 1 }),
});
const a = createRideService(db),
  b = createRideService(other);
let hash: string,
  authA: AuthRuntime,
  authB: AuthRuntime,
  appA: ReturnType<typeof createApp>,
  appB: ReturnType<typeof createApp>;
beforeAll(async () => {
  hash = (
    await db.user.findUniqueOrThrow({
      where: { email: "nusrat@demo.dhaka.test" },
    })
  ).password_hash;
  const options = {
    connectionString: url!,
    secret: "pooling-test-secret".repeat(3),
    origins: ["http://localhost:5173"],
    secureCookie: false,
    trustProxy: 0 as const,
    credentialLimit: 1000,
    bootstrapLimit: 1000,
  };
  authA = await createAuth({ ...options, db });
  authB = await createAuth({ ...options, db: other });
  appA = createApp(async () => {}, authA, createRideRouter(db, authA));
  appB = createApp(async () => {}, authB, createRideRouter(other, authB));
}, 20000);
afterAll(async () => {
  await authA.close();
  await authB.close();
  await db.$disconnect();
  await other.$disconnect();
});
async function passenger(name = "Passenger") {
  return db.user.create({
    data: { name, email: randomUUID() + "@pool.test", password_hash: hash },
  });
}
async function driver() {
  return db.user.create({
    data: {
      name: "Test Jashim",
      email: randomUUID() + "@pool.test",
      password_hash: hash,
      role: "DRIVER",
      driver_profile: { create: { online: true } },
      vehicle: { create: { name: "Test Bullet", capacity: 3 } },
    },
  });
}
async function world() {
  const group = randomUUID(),
    pickup = await db.zone.create({ data: { name: group } });
  const destinations = await Promise.all(
    [0, 1, 2].map((n) => db.zone.create({ data: { name: group + "-" + n } })),
  );
  const r3 = await db.route.create({
    data: {
      pickup_zone_id: pickup.id,
      destination_zone_id: destinations[0].id,
      compatibility_group: group,
      demo_distance_meters: 3000,
    },
  });
  const r4 = await db.route.create({
    data: {
      pickup_zone_id: pickup.id,
      destination_zone_id: destinations[1].id,
      compatibility_group: group,
      demo_distance_meters: 4000,
    },
  });
  const wrong = await db.route.create({
    data: {
      pickup_zone_id: pickup.id,
      destination_zone_id: destinations[2].id,
      compatibility_group: group + "-other",
      demo_distance_meters: 4000,
    },
  });
  const elsewhere = await db.route.create({
    data: {
      pickup_zone_id: destinations[2].id,
      destination_zone_id: destinations[0].id,
      compatibility_group: group,
      demo_distance_meters: 3000,
    },
  });
  return { r3, r4, wrong, elsewhere, d: await driver() };
}
async function book(routeId: string, seats = 1, name = "Passenger") {
  const p = await passenger(name);
  const key = randomUUID();
  return { p, key, r: (await a.create(p.id, { routeId, seats }, key)).booking };
}
async function invariant(id: string) {
  const p = await db.pool.findUniqueOrThrow({
    where: { id },
    include: { memberships: { include: { request: true } } },
  });
  expect(p.allocated_seats).toBe(
    p.memberships
      .filter((m) => !m.released_at)
      .reduce((sum, m) => sum + m.seats, 0),
  );
  expect(p.allocated_seats).toBeLessThanOrEqual(p.capacity_snapshot);
  expect(new Set(p.memberships.map((m) => m.request_id)).size).toBe(
    p.memberships.length,
  );
  for (const m of p.memberships)
    if (!m.released_at)
      expect(["MATCHED", "DRIVER_ARRIVED", "IN_PROGRESS"]).toContain(
        m.request.status,
      );
  return p;
}
async function login(app: ReturnType<typeof createApp>, email: string) {
  const agent = request.agent(app);
  let csrf = (await agent.get("/api/v1/auth/csrf")).body.data.csrfToken;
  expect(
    (
      await agent
        .post("/api/v1/auth/login")
        .set("Origin", "http://localhost:5173")
        .set("X-CSRF-Token", csrf)
        .send({ email, password: "DemoOnly!Dhaka2026" })
    ).status,
  ).toBe(200);
  csrf = (await agent.get("/api/v1/auth/csrf")).body.data.csrfToken;
  return { agent, csrf };
}
describe("shared pooling with PostgreSQL and independent app instances", () => {
  it("matches Nusrat/Rafiq, finalizes 40/48 BDT, protects privacy, and completes independent drop-offs", async () => {
    const w = await world(),
      n = await book(w.r3.id, 1, "Nusrat"),
      pool = await a.accept(w.d.id, n.r.id),
      r = await book(w.r4.id, 1, "Rafiq");
    expect(r.r.pool?.id).toBe(pool.id);
    expect(r.r.pool?.sharing).toBe(true);
    expect((await a.booking(n.p.id, n.r.id)).pool?.sharing).toBe(true);
    expect(r.r.fare.provisionalPooledPoisha).toBe(4800);
    const view = await a.booking(n.p.id, n.r.id);
    for (const secret of [r.r.id, r.p.email, r.p.name, "4800"])
      expect(JSON.stringify(view)).not.toContain(secret);
    const driverView = JSON.stringify(await a.pool(w.d.id, pool.id));
    for (const secret of ["Poisha", "email", n.p.email])
      expect(driverView).not.toContain(secret);
    await a.transition(w.d.id, pool.id, "arrive");
    const fareN = (await a.booking(n.p.id, n.r.id)).fare,
      fareR = (await a.booking(r.p.id, r.r.id)).fare;
    expect(fareN.finalFarePoisha).toBe(4000);
    expect(fareR.finalFarePoisha).toBe(4800);
    expect(fareN.discountBps).toBe(2000);
    expect(fareN.finalPricingVersion).toBe("demo-pool-v1");
    await a.transition(w.d.id, pool.id, "start");
    let current = await a.pool(w.d.id, pool.id);
    await a.transition(
      w.d.id,
      pool.id,
      "complete",
      current.members.find((m) => m.requestId === n.r.id)!.id,
    );
    await expect(
      a.transition(w.d.id, pool.id, "complete"),
    ).rejects.toMatchObject({ code: "STATE_CONFLICT" });
    expect((await a.booking(r.p.id, r.r.id)).fare).toEqual(fareR);
    const late = await book(w.r3.id);
    expect(late.r.status).toBe("REQUESTED");
    await a.transition(
      w.d.id,
      pool.id,
      "complete",
      current.members.find((m) => m.requestId === r.r.id)!.id,
    );
    await a.transition(w.d.id, pool.id, "complete");
    expect((await a.bookings(n.p.id, { limit: 20 })).items[0].status).toBe(
      "COMPLETED",
    );
    expect(
      (await a.pools(w.d.id, { limit: 20 })).items[0].members,
    ).toHaveLength(2);
    await invariant(pool.id);
  });
  it("keeps incompatible pickups/groups waiting and reserves whole multi-seat bookings", async () => {
    const w = await world(),
      n = await book(w.r3.id),
      pool = await a.accept(w.d.id, n.r.id);
    expect((await book(w.wrong.id)).r.status).toBe("REQUESTED");
    expect((await book(w.elsewhere.id)).r.status).toBe("REQUESTED");
    const two = await book(w.r4.id, 2);
    expect(two.r.pool?.id).toBe(pool.id);
    const extra = await book(w.r3.id);
    expect(extra.r.status).toBe("REQUESTED");
    expect((await invariant(pool.id)).allocated_seats).toBe(3);
  });
  it("acceptance scans waiting bookings in stable creation order, skipping those that do not fit", async () => {
    const w = await world(),
      selected = await book(w.r3.id),
      large = await book(w.r3.id, 3);
    const waiting = await Promise.all([0, 1, 2].map(() => book(w.r4.id)));
    const at = new Date("2026-01-01T00:00:00Z");
    await db.rideRequest.updateMany({
      where: { id: { in: [large.r.id, ...waiting.map((v) => v.r.id)] } },
      data: { created_at: at },
    });
    const pool = await a.accept(w.d.id, selected.r.id);
    expect(pool.members.map((m) => m.requestId).sort()).toEqual(
      [
        selected.r.id,
        ...waiting
          .map((v) => v.r.id)
          .sort()
          .slice(0, 2),
      ].sort(),
    );
    expect((await a.booking(large.p.id, large.r.id)).status).toBe("REQUESTED");
    await invariant(pool.id);
  });
  it("prefers the oldest eligible pool with a stable ID tie breaker", async () => {
    const w = await world(),
      first = await book(w.r3.id, 2),
      p1 = await a.accept(w.d.id, first.r.id),
      filler = await book(w.r3.id);
    const second = await book(w.r3.id, 2),
      d2 = await driver(),
      p2 = await a.accept(d2.id, second.r.id),
      filler2 = await book(w.r3.id);
    await a.cancel(filler.p.id, filler.r.id);
    await a.cancel(filler2.p.id, filler2.r.id);
    await db.pool.update({
      where: { id: p1.id },
      data: { created_at: new Date("2026-01-01") },
    });
    const next = await book(w.r3.id);
    expect(next.r.pool?.id).toBe(p1.id);
    await a.cancel(next.p.id, next.r.id);
    await db.pool.updateMany({
      where: { id: { in: [p1.id, p2.id] } },
      data: { created_at: new Date("2026-01-01") },
    });
    expect((await book(w.r3.id)).r.pool?.id).toBe([p1.id, p2.id].sort()[0]);
  });
  it("releases only cancelled seats and refills a nonempty accepted pool from waiting requests", async () => {
    const w = await world(),
      n = await book(w.r3.id),
      pool = await a.accept(w.d.id, n.r.id),
      two = await book(w.r4.id, 2),
      waiting = await book(w.r3.id, 2);
    await a.cancel(two.p.id, two.r.id);
    await a.cancel(two.p.id, two.r.id);
    const after = await a.pool(w.d.id, pool.id);
    expect(after.status).toBe("ACCEPTED");
    expect(after.allocatedSeats).toBe(3);
    expect(after.members).toHaveLength(3);
    expect((await a.booking(n.p.id, n.r.id)).status).toBe("MATCHED");
    expect((await a.booking(waiting.p.id, waiting.r.id)).pool?.id).toBe(
      pool.id,
    );
    expect(after.members.find((m) => m.requestId === two.r.id)?.status).toBe(
      "CANCELLED",
    );
    await invariant(pool.id);
  });
  it("cancels a last-member pool instead of filling it with another trip", async () => {
    const w = await world(),
      n = await book(w.r3.id, 3),
      pool = await a.accept(w.d.id, n.r.id),
      waiting = await book(w.r3.id);
    await a.cancel(n.p.id, n.r.id);
    expect((await a.pool(w.d.id, pool.id)).status).toBe("CANCELLED");
    expect((await a.booking(waiting.p.id, waiting.r.id)).status).toBe(
      "REQUESTED",
    );
    await invariant(pool.id);
  });
  it("does not match offline drivers even when an accepted pool has space", async () => {
    const w = await world(),
      n = await book(w.r3.id),
      pool = await a.accept(w.d.id, n.r.id);
    // Test-only inconsistent operational fixture; normal availability blocks going offline.
    await db.driverProfile.update({
      where: { user_id: w.d.id },
      data: { online: false },
    });
    expect((await book(w.r4.id)).r.status).toBe("REQUESTED");
    expect((await invariant(pool.id)).allocated_seats).toBe(1);
  });
  it("allocates exactly one last seat across separate HTTP apps/connections", async () => {
    const ids = await Promise.all([
      db.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`,
      other.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`,
    ]);
    expect(ids[0][0].pid).not.toBe(ids[1][0].pid);
    for (let run = 0; run < 3; run++) {
      const w = await world(),
        owner = await book(w.r3.id, 2),
        pool = await a.accept(w.d.id, owner.r.id);
      const p1 = await passenger(),
        p2 = await passenger(),
        x = await login(appA, p1.email),
        y = await login(appB, p2.email);
      const results = await Promise.all(
        [x, y].map((client) =>
          client.agent
            .post("/api/v1/ride-requests")
            .set("Origin", "http://localhost:5173")
            .set("X-CSRF-Token", client.csrf)
            .set("Idempotency-Key", randomUUID())
            .send({ routeId: w.r3.id, seats: 1 }),
        ),
      );
      expect(results.map((r) => r.status)).toEqual([201, 201]);
      expect(results.map((r) => r.body.data.status).sort()).toEqual([
        "MATCHED",
        "REQUESTED",
      ]);
      expect(
        results.filter((r) => r.body.data.pool?.id === pool.id),
      ).toHaveLength(1);
      expect((await invariant(pool.id)).allocated_seats).toBe(3);
    }
  }, 20000);
  it("idempotent cross-connection retries never repeat assignment or events", async () => {
    const w = await world(),
      owner = await book(w.r3.id),
      pool = await a.accept(w.d.id, owner.r.id),
      p = await passenger(),
      key = randomUUID(),
      input = { routeId: w.r4.id, seats: 1 };
    const results = await Promise.all([
      a.create(p.id, input, key),
      b.create(p.id, input, key),
      a.create(p.id, input, key),
    ]);
    expect(new Set(results.map((r) => r.booking.id)).size).toBe(1);
    const id = results[0].booking.id;
    expect(await db.poolMembership.count({ where: { request_id: id } })).toBe(
      1,
    );
    expect(
      await db.rideEvent.count({
        where: { request_id: id, event_type: "REQUEST_MATCHED" },
      }),
    ).toBe(1);
    await a.cancel(p.id, id);
    expect((await b.create(p.id, input, key)).booking.status).toBe("CANCELLED");
    expect((await invariant(pool.id)).allocated_seats).toBe(1);
  });
  it("orders joining against arrival and never boards a late booking", async () => {
    for (const reverse of [false, true]) {
      const w = await world(),
        n = await book(w.r3.id),
        pool = await a.accept(w.d.id, n.r.id),
        p = await passenger();
      const calls = [
        () => b.create(p.id, { routeId: w.r4.id, seats: 1 }, randomUUID()),
        () => a.transition(w.d.id, pool.id, "arrive"),
      ];
      if (reverse) calls.reverse();
      await Promise.all(calls.map((f) => f()));
      const arrival = await a.booking(n.p.id, n.r.id),
        newcomer = (await a.bookings(p.id, { limit: 1 })).items[0];
      if (newcomer.pool) {
        expect(newcomer.status).toBe("DRIVER_ARRIVED");
        expect(newcomer.fare.finalFarePoisha).toBe(4800);
        expect(arrival.fare.finalFarePoisha).toBe(4000);
      } else {
        expect(newcomer.status).toBe("REQUESTED");
        expect(arrival.fare.finalFarePoisha).toBe(5000);
      }
      expect((await book(w.r3.id)).r.status).toBe("REQUESTED");
      await invariant(pool.id);
    }
  });
  it("orders cancellation against arrival and finalizes only the remaining active bookings", async () => {
    for (const reverse of [false, true]) {
      const w = await world(),
        n = await book(w.r3.id),
        pool = await a.accept(w.d.id, n.r.id),
        r = await book(w.r4.id);
      const calls = [
        () => b.cancel(r.p.id, r.r.id),
        () => a.transition(w.d.id, pool.id, "arrive"),
      ];
      if (reverse) calls.reverse();
      await Promise.allSettled(calls.map((f) => f()));
      const nr = await a.booking(n.p.id, n.r.id),
        rr = await a.booking(r.p.id, r.r.id);
      if (rr.status === "CANCELLED") {
        expect(rr.fare.finalFarePoisha).toBeNull();
        expect(nr.fare.finalFarePoisha).toBe(5000);
      } else {
        expect(rr.status).toBe("DRIVER_ARRIVED");
        expect(rr.fare.finalFarePoisha).toBe(4800);
        expect(nr.fare.finalFarePoisha).toBe(4000);
      }
      await invariant(pool.id);
    }
  });
  it("one booking with multiple seats and cancellation leaving one booking do not qualify", async () => {
    const w = await world(),
      n = await book(w.r3.id, 2),
      pool = await a.accept(w.d.id, n.r.id),
      r = await book(w.r4.id);
    await a.cancel(r.p.id, r.r.id);
    await a.transition(w.d.id, pool.id, "arrive");
    const fare = (await a.booking(n.p.id, n.r.id)).fare;
    expect(fare.finalFarePoisha).toBe(10000);
    expect(fare.discountBps).toBe(0);
  });
  it("preserves legacy quote inputs, applies new arrival policy, and leaves completed legacy fares unchanged", async () => {
    const w = await world(),
      n = await book(w.r3.id),
      pool = await a.accept(w.d.id, n.r.id);
    await db.rideRequest.update({
      where: { id: n.r.id },
      data: {
        pricing_version: "demo-solo-v1",
        provisional_pooled_poisha: 5000,
      },
    });
    const before = await db.rideRequest.findUniqueOrThrow({
      where: { id: n.r.id },
    });
    await book(w.r4.id);
    expect((await a.booking(n.p.id, n.r.id)).fare.provisionalPooledPoisha).toBe(
      4000,
    );
    await a.transition(w.d.id, pool.id, "arrive");
    const after = await db.rideRequest.findUniqueOrThrow({
      where: { id: n.r.id },
    });
    for (const field of [
      "pricing_version",
      "distance_meters",
      "base_fare_poisha",
      "rate_per_km_poisha",
      "solo_maximum_poisha",
      "provisional_pooled_poisha",
      "seats",
    ] as const)
      expect(after[field]).toBe(before[field]);
    expect(after.final_fare_poisha).toBe(4000);
    expect((await a.booking(n.p.id, n.r.id)).fare.finalPricingVersion).toBe(
      "demo-pool-v1",
    );
    // Represent a historical pre-upgrade finalized quote; no read/replay recalculates it.
    await db.rideRequest.update({
      where: { id: n.r.id },
      data: { final_fare_poisha: 5000, discount_bps: 0 },
    });
    await db.rideEvent.update({
      where: { operation_key: "DRIVER_ARRIVED:" + n.r.id },
      data: { metadata: {} },
    });
    await a.transition(w.d.id, pool.id, "arrive");
    expect((await a.booking(n.p.id, n.r.id)).fare.finalFarePoisha).toBe(5000);
    expect((await a.booking(n.p.id, n.r.id)).fare.finalPricingVersion).toBe(
      "demo-solo-v1",
    );
  });
  it("rolls back every member fare/status when later finalization fails", async () => {
    const w = await world(),
      n = await book(w.r3.id),
      pool = await a.accept(w.d.id, n.r.id),
      r = await book(w.r4.id);
    const blocker = await db.rideEvent.create({
      data: {
        request_id: r.r.id,
        event_type: "DRIVER_ARRIVED",
        operation_key: "DRIVER_ARRIVED:" + r.r.id,
      },
    });
    try {
      await expect(a.transition(w.d.id, pool.id, "arrive")).rejects.toThrow();
      for (const item of [n, r]) {
        const row = await a.booking(item.p.id, item.r.id);
        expect(row.status).toBe("MATCHED");
        expect(row.fare.finalFarePoisha).toBeNull();
      }
      expect((await a.pool(w.d.id, pool.id)).status).toBe("ACCEPTED");
      await invariant(pool.id);
    } finally {
      await db.rideEvent.delete({ where: { id: blocker.id } });
    }
  });
  it("rounds the shared discount in integer poisha and preserves solo rounding", () => {
    expect(sharedFare(5000)).toBe(4000);
    expect(sharedFare(6000)).toBe(4800);
    expect(sharedFare(1)).toBe(1);
    expect(sharedFare(2)).toBe(2);
    expect(sharedFare(3)).toBe(2);
  });
});
