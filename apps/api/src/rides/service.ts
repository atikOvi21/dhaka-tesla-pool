import { createHash } from "node:crypto";
import {
  Prisma,
  type PrismaClient,
  type BookingStatus,
  type PoolStatus,
  type EventType,
} from "../generated/prisma/client.js";
import { AuthError } from "../auth/service.js";
import {
  soloFare,
  sharedFare,
  BASE_POISHA,
  RATE_POISHA,
  PRICING_VERSION,
} from "./fare.js";
type Tx = Prisma.TransactionClient;
export type BookingInput = { routeId: string; seats: number };
export type Page = { limit: number; cursor?: { at: Date; id: string } };
const activeBookings: BookingStatus[] = [
  "REQUESTED",
  "MATCHED",
  "DRIVER_ARRIVED",
  "IN_PROGRESS",
];
const activePools: PoolStatus[] = ["ACCEPTED", "DRIVER_ARRIVED", "STARTED"];
const routeInclude = { pickup_zone: true, destination_zone: true } as const;
const vehicleInclude = {
  driver: { select: { id: true, name: true } },
} as const;
const bookingInclude = {
  events: {
    where: { event_type: "DRIVER_ARRIVED" },
    select: { metadata: true },
  },
  route: { include: routeInclude },
  membership: {
    include: {
      pool: {
        include: {
          vehicle: { include: vehicleInclude },
          _count: {
            select: {
              memberships: {
                where: { request: { status: { not: "CANCELLED" } } },
              },
            },
          },
        },
      },
    },
  },
} as const;
const poolInclude = {
  vehicle: { include: vehicleInclude },
  pickup_zone: true,
  memberships: {
    orderBy: { joined_at: "asc" },
    include: {
      request: {
        include: {
          route: { include: routeInclude },
          passenger: { select: { name: true } },
        },
      },
    },
  },
} as const;
type BookingRow = Prisma.RideRequestGetPayload<{
  include: typeof bookingInclude;
}>;
type PoolRow = Prisma.PoolGetPayload<{ include: typeof poolInclude }>;
type RouteRow = Prisma.RouteGetPayload<{ include: typeof routeInclude }>;
const fail = (code: string, message: string, status = 409): never => {
  throw new AuthError(status, code, message);
};
const missing = (): never => fail("NOT_FOUND", "Resource not found.", 404);
function routeView(r: RouteRow) {
  return {
    id: r.id,
    pickupZoneId: r.pickup_zone_id,
    destinationZoneId: r.destination_zone_id,
    pickup: r.pickup_zone.name,
    destination: r.destination_zone.name,
    demoDistanceMeters: r.demo_distance_meters,
    compatibilityGroup: r.compatibility_group,
  };
}
function bookingView(r: BookingRow) {
  const p = r.membership?.pool;
  const arrivalPolicy = r.events[0]?.metadata as
    { pricingVersion?: string } | undefined;
  const sharedQuote = !r.finalized_at && r.status !== "CANCELLED";
  return {
    id: r.id,
    route: { ...routeView(r.route), demoDistanceMeters: r.distance_meters },
    seats: r.seats,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    fare: {
      soloMaximumPoisha: r.solo_maximum_poisha,
      provisionalPooledPoisha: sharedQuote
        ? sharedFare(r.solo_maximum_poisha)
        : r.provisional_pooled_poisha,
      poolingPricingVersion: sharedQuote ? PRICING_VERSION : null,
      finalPricingVersion: r.finalized_at
        ? (arrivalPolicy?.pricingVersion ?? r.pricing_version)
        : null,
      discountBps: r.discount_bps,
      finalFarePoisha: r.final_fare_poisha,
      finalizedAt: r.finalized_at,
      currency: "BDT",
      pricingVersion: r.pricing_version,
    },
    pool: p
      ? {
          id: p.id,
          status: p.status,
          sharing: p._count.memberships > 1,
          driver: p.vehicle.driver,
          vehicle: {
            id: p.vehicle.id,
            name: p.vehicle.name,
            capacity: p.capacity_snapshot,
          },
        }
      : null,
    allowedActions: ["REQUESTED", "MATCHED"].includes(r.status)
      ? ["cancel"]
      : [],
  };
}
function poolView(p: PoolRow) {
  return {
    id: p.id,
    status: p.status,
    capacitySnapshot: p.capacity_snapshot,
    allocatedSeats: p.allocated_seats,
    pickup: p.pickup_zone.name,
    routeGroup: p.route_group,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    arrivedAt: p.arrived_at,
    startedAt: p.started_at,
    completedAt: p.completed_at,
    vehicle: {
      id: p.vehicle.id,
      name: p.vehicle.name,
      capacity: p.capacity_snapshot,
    },
    members: p.memberships.map((m) => ({
      id: m.id,
      requestId: m.request_id,
      passengerName: m.request.passenger.name,
      route: {
        ...routeView(m.request.route),
        demoDistanceMeters: m.request.distance_meters,
      },
      seats: m.seats,
      status: m.request.status,
      joinedAt: m.joined_at,
      releasedAt: m.released_at,
      allowedActions:
        p.status === "STARTED" && m.request.status === "IN_PROGRESS"
          ? ["complete"]
          : [],
    })),
    allowedActions:
      p.status === "ACCEPTED"
        ? ["arrive"]
        : p.status === "DRIVER_ARRIVED"
          ? ["start"]
          : p.status === "STARTED" &&
              p.memberships.every((m) =>
                ["COMPLETED", "CANCELLED"].includes(m.request.status),
              )
            ? ["complete"]
            : [],
  };
}
function cursorWhere(page: Page) {
  return page.cursor
    ? {
        OR: [
          { created_at: { lt: page.cursor.at } },
          { created_at: page.cursor.at, id: { lt: page.cursor.id } },
        ],
      }
    : {};
}
function pageView<T extends { id: string; created_at: Date }, V>(
  rows: T[],
  page: Page,
  map: (r: T) => V,
) {
  const items = rows.slice(0, page.limit),
    last = items.at(-1);
  return {
    items: items.map(map),
    nextCursor:
      rows.length > page.limit && last
        ? Buffer.from(
            JSON.stringify({ at: last.created_at.toISOString(), id: last.id }),
          ).toString("base64url")
        : null,
  };
}
export function createRideService(db: PrismaClient) {
  // One database-wide ride write lock, always acquired before business reads/writes.
  // It is shared across API instances and released automatically on commit/rollback.
  async function write<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await db.$transaction(
          async (tx) => {
            await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '5s'");
            await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(73421, 1)`;
            return work(tx);
          },
          { maxWait: 10000, timeout: 15000 },
        );
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2034" &&
          attempt < 2
        )
          continue;
        throw error;
      }
    }
  }
  const read = <T>(work: (tx: Tx) => Promise<T>) =>
    db.$transaction(work, { isolationLevel: "RepeatableRead" });
  async function booking(tx: Tx, id: string, passengerId: string) {
    return (
      (await tx.rideRequest.findFirst({
        where: { id, passenger_id: passengerId },
        include: bookingInclude,
      })) ?? missing()
    );
  }
  async function pool(tx: Tx, id: string, driverId: string) {
    return (
      (await tx.pool.findFirst({
        where: { id, vehicle: { driver_id: driverId } },
        include: poolInclude,
      })) ?? missing()
    );
  }
  async function profile(tx: Tx, driverId: string) {
    const user = await tx.user.findUnique({
      where: { id: driverId },
      include: { driver_profile: true, vehicle: true },
    });
    if (!user?.driver_profile || !user.vehicle) return missing();
    return {
      online: user.driver_profile.online,
      vehicle: {
        id: user.vehicle.id,
        name: user.vehicle.name,
        capacity: user.vehicle.capacity,
      },
    };
  }
  async function estimate(tx: Tx, input: BookingInput) {
    const route = await tx.route.findUnique({
      where: { id: input.routeId },
      include: routeInclude,
    });
    if (!route) fail("VALIDATION_ERROR", "Select a supported route.", 400);
    const capacity =
      (await tx.vehicle.aggregate({ _max: { capacity: true } }))._max
        .capacity ?? 0;
    if (
      !Number.isInteger(input.seats) ||
      input.seats < 1 ||
      input.seats > capacity
    )
      fail(
        "VALIDATION_ERROR",
        "Select a seat count within vehicle capacity.",
        400,
      );
    const fare = soloFare(input.seats, route!.demo_distance_meters);
    return { route: route!, fare };
  }
  async function event(
    tx: Tx,
    actor: string,
    type: EventType,
    subject: { requestId?: string; poolId?: string },
    fromBooking?: BookingStatus,
    toBooking?: BookingStatus,
    fromPool?: PoolStatus,
    toPool?: PoolStatus,
    metadata: Prisma.InputJsonValue = {},
  ) {
    await tx.rideEvent.create({
      data: {
        actor_id: actor,
        request_id: subject.requestId,
        pool_id: subject.poolId,
        metadata,
        event_type: type,
        operation_key: type + ":" + (subject.requestId ?? subject.poolId),
        from_booking_status: fromBooking,
        to_booking_status: toBooking,
        from_pool_status: fromPool,
        to_pool_status: toPool,
      },
    });
  }

  // These helpers only run inside write(), after taking the shared ride lock.
  async function assign(
    tx: Tx,
    actor: string,
    request: { id: string; seats: number },
    target: { id: string; capacity_snapshot: number },
  ) {
    const changed = await tx.pool.updateMany({
      where: {
        id: target.id,
        status: "ACCEPTED",
        allocated_seats: { lte: target.capacity_snapshot - request.seats },
      },
      data: { allocated_seats: { increment: request.seats } },
    });
    if (changed.count !== 1)
      fail(
        "CAPACITY_CONFLICT",
        "This pool no longer has room for the whole booking.",
      );
    await tx.poolMembership.create({
      data: {
        request_id: request.id,
        pool_id: target.id,
        seats: request.seats,
      },
    });
    await tx.rideRequest.update({
      where: { id: request.id },
      data: { status: "MATCHED" },
    });
    await event(
      tx,
      actor,
      "REQUEST_MATCHED",
      { requestId: request.id, poolId: target.id },
      "REQUESTED",
      "MATCHED",
    );
  }
  async function matchNew(tx: Tx, actor: string, request: BookingRow) {
    const candidates = await tx.$queryRaw<
      { id: string; capacity_snapshot: number }[]
    >`
      SELECT p.id, p.capacity_snapshot FROM pools p
      JOIN vehicles v ON v.id = p.vehicle_id
      JOIN driver_profiles d ON d.user_id = v.driver_id
      WHERE p.status = 'ACCEPTED' AND d.online
        AND p.pickup_zone_id = ${request.route.pickup_zone_id}::uuid
        AND p.route_group = ${request.route.compatibility_group}
        AND p.capacity_snapshot - p.allocated_seats >= ${request.seats}
      ORDER BY p.created_at ASC, p.id ASC LIMIT 1`;
    if (candidates[0]) await assign(tx, actor, request, candidates[0]);
  }
  async function fillWaiting(tx: Tx, actor: string, poolId: string) {
    const target = await tx.pool.findUniqueOrThrow({
      where: { id: poolId },
      include: {
        vehicle: { include: { driver: { include: { driver_profile: true } } } },
      },
    });
    if (
      target.status !== "ACCEPTED" ||
      !target.vehicle.driver.driver_profile?.online
    )
      return;
    let remaining = target.capacity_snapshot - target.allocated_seats;
    // Each iteration fills a seat; skip oversized bookings without splitting them.
    while (remaining > 0) {
      const next = await tx.rideRequest.findFirst({
        where: {
          status: "REQUESTED",
          seats: { lte: remaining },
          route: {
            pickup_zone_id: target.pickup_zone_id,
            compatibility_group: target.route_group,
          },
        },
        orderBy: [{ created_at: "asc" }, { id: "asc" }],
      });
      if (!next) break;
      await assign(tx, actor, next, target);
      remaining -= next.seats;
    }
  }
  return {
    zones: () =>
      db.zone.findMany({
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
    routes: (pickupZoneId?: string) =>
      read(async (tx) =>
        (
          await tx.route.findMany({
            where: { pickup_zone_id: pickupZoneId },
            include: routeInclude,
            orderBy: { id: "asc" },
          })
        ).map(routeView),
      ),
    estimate: (input: BookingInput) =>
      read(async (tx) => {
        const { fare } = await estimate(tx, input);
        return {
          soloMaximumPoisha: fare,
          provisionalPooledPoisha: sharedFare(fare),
          currency: "BDT",
          pricingVersion: PRICING_VERSION,
          provisional: true,
          poolingAvailable: true,
        };
      }),
    create: (passengerId: string, input: BookingInput, key: string) =>
      write(async (tx) => {
        const fingerprint = createHash("sha256")
          .update(JSON.stringify([input.routeId.toLowerCase(), input.seats]))
          .digest("hex");
        const previous = await tx.rideRequest.findUnique({
          where: {
            passenger_id_idempotency_key: {
              passenger_id: passengerId,
              idempotency_key: key,
            },
          },
          include: bookingInclude,
        });
        if (previous) {
          if (previous.payload_fingerprint !== fingerprint)
            fail(
              "IDEMPOTENCY_CONFLICT",
              "This request key was already used for different booking details.",
            );
          return { created: false, booking: bookingView(previous) };
        }
        if (
          await tx.rideRequest.findFirst({
            where: {
              passenger_id: passengerId,
              status: { in: activeBookings },
            },
          })
        )
          fail(
            "ACTIVE_RESOURCE_EXISTS",
            "You already have an active ride request.",
          );
        const { route, fare } = await estimate(tx, input);
        const r = await tx.rideRequest.create({
          data: {
            passenger_id: passengerId,
            route_id: route.id,
            seats: input.seats,
            idempotency_key: key,
            payload_fingerprint: fingerprint,
            pricing_version: PRICING_VERSION,
            distance_meters: route.demo_distance_meters,
            base_fare_poisha: BASE_POISHA,
            rate_per_km_poisha: RATE_POISHA,
            solo_maximum_poisha: fare,
            provisional_pooled_poisha: sharedFare(fare),
          },
          include: bookingInclude,
        });
        await event(
          tx,
          passengerId,
          "REQUEST_CREATED",
          { requestId: r.id },
          undefined,
          "REQUESTED",
        );
        await matchNew(tx, passengerId, r);
        return {
          created: true,
          booking: bookingView(await booking(tx, r.id, passengerId)),
        };
      }),
    booking: (passengerId: string, id: string) =>
      read(async (tx) => bookingView(await booking(tx, id, passengerId))),
    activeBooking: (passengerId: string) =>
      read(async (tx) => {
        const r = await tx.rideRequest.findFirst({
          where: { passenger_id: passengerId, status: { in: activeBookings } },
          include: bookingInclude,
        });
        return r ? bookingView(r) : null;
      }),
    bookings: (passengerId: string, page: Page) =>
      read(async (tx) =>
        pageView(
          await tx.rideRequest.findMany({
            where: { passenger_id: passengerId, ...cursorWhere(page) },
            orderBy: [{ created_at: "desc" }, { id: "desc" }],
            take: page.limit + 1,
            include: bookingInclude,
          }),
          page,
          bookingView,
        ),
      ),
    cancel: (passengerId: string, id: string) =>
      write(async (tx) => {
        const r = await booking(tx, id, passengerId);
        if (r.status === "CANCELLED") return bookingView(r);
        if (!["REQUESTED", "MATCHED"].includes(r.status))
          fail(
            "STATE_CONFLICT",
            "Cancellation is allowed only before driver arrival.",
          );
        if (r.membership) {
          const m = r.membership,
            p = m.pool;
          if (p.status !== "ACCEPTED" || m.released_at)
            fail("STATE_CONFLICT", "This trip can no longer be cancelled.");
          await tx.poolMembership.update({
            where: { id: m.id },
            data: { released_at: new Date(), release_reason: "CANCELLED" },
          });
          await tx.pool.update({
            where: { id: p.id },
            data: { allocated_seats: { decrement: m.seats } },
          });
          const remaining = await tx.poolMembership.count({
            where: { pool_id: p.id, released_at: null },
          });
          if (!remaining) {
            await tx.pool.update({
              where: { id: p.id },
              data: { status: "CANCELLED" },
            });
            await event(
              tx,
              passengerId,
              "POOL_CANCELLED",
              { poolId: p.id },
              undefined,
              undefined,
              "ACCEPTED",
              "CANCELLED",
            );
          }
        }
        await tx.rideRequest.update({
          where: { id },
          data: { status: "CANCELLED" },
        });
        await event(
          tx,
          passengerId,
          "REQUEST_CANCELLED",
          { requestId: id, poolId: r.membership?.pool_id },
          r.status,
          "CANCELLED",
        );
        if (r.membership)
          await fillWaiting(tx, passengerId, r.membership.pool_id);
        return bookingView(await booking(tx, id, passengerId));
      }),
    profile: (driverId: string) => read((tx) => profile(tx, driverId)),
    availability: (driverId: string, online: boolean) =>
      write(async (tx) => {
        const p = await profile(tx, driverId);
        if (
          !online &&
          (await tx.pool.findFirst({
            where: { vehicle_id: p.vehicle.id, status: { in: activePools } },
          }))
        )
          fail(
            "ACTIVE_RESOURCE_EXISTS",
            "Complete your active trip before going offline.",
          );
        await tx.driverProfile.update({
          where: { user_id: driverId },
          data: { online },
        });
        return profile(tx, driverId);
      }),
    waiting: (driverId: string, page: Page) =>
      read(async (tx) => {
        const p = await profile(tx, driverId);
        return pageView(
          await tx.rideRequest.findMany({
            where: {
              status: "REQUESTED",
              seats: { lte: p.vehicle.capacity },
              ...cursorWhere(page),
            },
            include: { route: { include: routeInclude } },
            orderBy: [{ created_at: "desc" }, { id: "desc" }],
            take: page.limit + 1,
          }),
          page,
          (r) => ({
            id: r.id,
            route: routeView(r.route),
            seats: r.seats,
            createdAt: r.created_at,
          }),
        );
      }),
    accept: (driverId: string, id: string) =>
      write(async (tx) => {
        const driver = await profile(tx, driverId);
        const r =
          (await tx.rideRequest.findUnique({
            where: { id },
            include: bookingInclude,
          })) ?? missing();
        if (
          r.status === "MATCHED" &&
          r.membership?.pool.vehicle.driver_id === driverId &&
          r.membership.pool.status === "ACCEPTED"
        )
          return poolView(await pool(tx, r.membership.pool_id, driverId));
        if (r.status !== "REQUESTED")
          fail("STATE_CONFLICT", "This request is no longer waiting.");
        if (!driver.online)
          fail("STATE_CONFLICT", "Go online before accepting a request.");
        if (
          await tx.pool.findFirst({
            where: {
              vehicle_id: driver.vehicle.id,
              status: { in: activePools },
            },
          })
        )
          fail("ACTIVE_RESOURCE_EXISTS", "You already have an active trip.");
        if (r.seats > driver.vehicle.capacity)
          fail(
            "CAPACITY_CONFLICT",
            "The request exceeds your vehicle capacity.",
          );
        const p = await tx.pool.create({
          data: {
            vehicle_id: driver.vehicle.id,
            capacity_snapshot: driver.vehicle.capacity,
            allocated_seats: 0,
            pickup_zone_id: r.route.pickup_zone_id,
            route_group: r.route.compatibility_group,
          },
        });
        await event(
          tx,
          driverId,
          "POOL_ACCEPTED",
          { poolId: p.id },
          undefined,
          undefined,
          undefined,
          "ACCEPTED",
        );
        await assign(tx, driverId, r, p);
        await fillWaiting(tx, driverId, p.id);
        return poolView(await pool(tx, p.id, driverId));
      }),
    pool: (driverId: string, id: string) =>
      read(async (tx) => poolView(await pool(tx, id, driverId))),
    activePool: (driverId: string) =>
      read(async (tx) => {
        const p = await tx.pool.findFirst({
          where: {
            vehicle: { driver_id: driverId },
            status: { in: activePools },
          },
          include: poolInclude,
        });
        return p ? poolView(p) : null;
      }),
    pools: (driverId: string, page: Page) =>
      read(async (tx) =>
        pageView(
          await tx.pool.findMany({
            where: { vehicle: { driver_id: driverId }, ...cursorWhere(page) },
            include: poolInclude,
            orderBy: [{ created_at: "desc" }, { id: "desc" }],
            take: page.limit + 1,
          }),
          page,
          poolView,
        ),
      ),
    transition: (
      driverId: string,
      id: string,
      action: "arrive" | "start" | "complete",
      membershipId?: string,
    ) =>
      write(async (tx) => {
        const p = await pool(tx, id, driverId);
        const now = new Date();
        if (membershipId) {
          const m =
            p.memberships.find((m) => m.id === membershipId) ?? missing();
          if (
            m.request.status === "COMPLETED" &&
            ["STARTED", "COMPLETED"].includes(p.status)
          )
            return poolView(p);
          if (
            p.status !== "STARTED" ||
            m.request.status !== "IN_PROGRESS" ||
            m.released_at
          )
            fail(
              "STATE_CONFLICT",
              "Start the trip before marking this passenger dropped off.",
            );
          await tx.rideRequest.update({
            where: { id: m.request_id },
            data: { status: "COMPLETED" },
          });
          await tx.poolMembership.update({
            where: { id: m.id },
            data: { released_at: now, release_reason: "COMPLETED" },
          });
          await tx.pool.update({
            where: { id },
            data: { allocated_seats: { decrement: m.seats } },
          });
          await event(
            tx,
            driverId,
            "BOOKING_COMPLETED",
            { poolId: id, requestId: m.request_id },
            "IN_PROGRESS",
            "COMPLETED",
          );
        } else if (action === "arrive") {
          if (p.status === "DRIVER_ARRIVED") return poolView(p);
          if (p.status !== "ACCEPTED")
            fail(
              "STATE_CONFLICT",
              "Arrival is available only for an accepted trip.",
            );
          const members = p.memberships.filter((m) => !m.released_at);
          if (
            !members.length ||
            members.some((m) => m.request.status !== "MATCHED")
          )
            fail("STATE_CONFLICT", "The trip has no eligible passengers.");
          await tx.pool.update({
            where: { id },
            data: { status: "DRIVER_ARRIVED", arrived_at: now },
          });
          for (const m of members) {
            await tx.rideRequest.update({
              where: { id: m.request_id },
              data: {
                status: "DRIVER_ARRIVED",
                final_fare_poisha:
                  members.length >= 2
                    ? sharedFare(m.request.solo_maximum_poisha)
                    : m.request.solo_maximum_poisha,
                discount_bps: members.length >= 2 ? 2000 : 0,
                finalized_at: now,
              },
            });
            await event(
              tx,
              driverId,
              "DRIVER_ARRIVED",
              { poolId: id, requestId: m.request_id },
              "MATCHED",
              "DRIVER_ARRIVED",
              "ACCEPTED",
              "DRIVER_ARRIVED",
              {
                pricingVersion: PRICING_VERSION,
                discountBps: members.length >= 2 ? 2000 : 0,
                activeBookings: members.length,
              },
            );
          }
        } else if (action === "start") {
          if (p.status === "STARTED") return poolView(p);
          if (p.status !== "DRIVER_ARRIVED")
            fail("STATE_CONFLICT", "Mark arrival before starting the trip.");
          await tx.pool.update({
            where: { id },
            data: { status: "STARTED", started_at: now },
          });
          await tx.rideRequest.updateMany({
            where: {
              membership: { pool_id: id, released_at: null },
              status: "DRIVER_ARRIVED",
            },
            data: { status: "IN_PROGRESS" },
          });
          await event(
            tx,
            driverId,
            "POOL_STARTED",
            { poolId: id },
            "DRIVER_ARRIVED",
            "IN_PROGRESS",
            "DRIVER_ARRIVED",
            "STARTED",
          );
        } else {
          if (p.status === "COMPLETED") return poolView(p);
          if (
            p.status !== "STARTED" ||
            p.allocated_seats !== 0 ||
            p.memberships.some(
              (m) => !["COMPLETED", "CANCELLED"].includes(m.request.status),
            )
          )
            fail(
              "STATE_CONFLICT",
              "Complete every passenger drop-off before completing the trip.",
            );
          await tx.pool.update({
            where: { id },
            data: { status: "COMPLETED", completed_at: now },
          });
          await event(
            tx,
            driverId,
            "POOL_COMPLETED",
            { poolId: id },
            undefined,
            undefined,
            "STARTED",
            "COMPLETED",
          );
        }
        return poolView(await pool(tx, id, driverId));
      }),
  };
}
