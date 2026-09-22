-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('PASSENGER', 'DRIVER');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('REQUESTED', 'MATCHED', 'DRIVER_ARRIVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PoolStatus" AS ENUM ('ACCEPTED', 'DRIVER_ARRIVED', 'STARTED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReleaseReason" AS ENUM ('CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('REQUEST_CREATED', 'REQUEST_MATCHED', 'REQUEST_CANCELLED', 'POOL_ACCEPTED', 'DRIVER_ARRIVED', 'POOL_STARTED', 'BOOKING_COMPLETED', 'POOL_COMPLETED', 'POOL_CANCELLED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'PASSENGER',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "sid" VARCHAR NOT NULL,
    "sess" JSON NOT NULL,
    "expire" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("sid")
);

-- CreateTable
CREATE TABLE "driver_profiles" (
    "user_id" UUID NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'DRIVER',
    "online" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "driver_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "driver_role" "Role" NOT NULL DEFAULT 'DRIVER',
    "name" VARCHAR(100) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zones" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,

    CONSTRAINT "zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routes" (
    "id" UUID NOT NULL,
    "pickup_zone_id" UUID NOT NULL,
    "destination_zone_id" UUID NOT NULL,
    "compatibility_group" VARCHAR(100) NOT NULL,
    "demo_distance_meters" INTEGER NOT NULL,

    CONSTRAINT "routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ride_requests" (
    "id" UUID NOT NULL,
    "passenger_id" UUID NOT NULL,
    "passenger_role" "Role" NOT NULL DEFAULT 'PASSENGER',
    "route_id" UUID NOT NULL,
    "seats" INTEGER NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'REQUESTED',
    "idempotency_key" VARCHAR(128) NOT NULL,
    "payload_fingerprint" VARCHAR(64) NOT NULL,
    "pricing_version" VARCHAR(50) NOT NULL,
    "distance_meters" INTEGER NOT NULL,
    "base_fare_poisha" INTEGER NOT NULL,
    "rate_per_km_poisha" INTEGER NOT NULL,
    "solo_maximum_poisha" INTEGER NOT NULL,
    "provisional_pooled_poisha" INTEGER NOT NULL,
    "discount_bps" INTEGER,
    "final_fare_poisha" INTEGER,
    "finalized_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ride_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pools" (
    "id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "capacity_snapshot" INTEGER NOT NULL,
    "allocated_seats" INTEGER NOT NULL DEFAULT 0,
    "pickup_zone_id" UUID NOT NULL,
    "route_group" VARCHAR(100) NOT NULL,
    "status" "PoolStatus" NOT NULL DEFAULT 'ACCEPTED',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "arrived_at" TIMESTAMPTZ(3),
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "pools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pool_memberships" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "pool_id" UUID NOT NULL,
    "seats" INTEGER NOT NULL,
    "joined_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" TIMESTAMPTZ(3),
    "release_reason" "ReleaseReason",

    CONSTRAINT "pool_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ride_events" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "request_id" UUID,
    "pool_id" UUID,
    "event_type" "EventType" NOT NULL,
    "operation_key" VARCHAR(200) NOT NULL,
    "from_booking_status" "BookingStatus",
    "to_booking_status" "BookingStatus",
    "from_pool_status" "PoolStatus",
    "to_pool_status" "PoolStatus",
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ride_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_id_role_key" ON "users"("id", "role");

-- CreateIndex
CREATE INDEX "sessions_expire_idx" ON "sessions"("expire");

-- CreateIndex
CREATE UNIQUE INDEX "driver_profiles_user_id_role_key" ON "driver_profiles"("user_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_driver_id_key" ON "vehicles"("driver_id");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_driver_id_driver_role_key" ON "vehicles"("driver_id", "driver_role");

-- CreateIndex
CREATE UNIQUE INDEX "zones_name_key" ON "zones"("name");

-- CreateIndex
CREATE INDEX "routes_destination_zone_id_idx" ON "routes"("destination_zone_id");

-- CreateIndex
CREATE UNIQUE INDEX "routes_pickup_zone_id_destination_zone_id_key" ON "routes"("pickup_zone_id", "destination_zone_id");

-- CreateIndex
CREATE INDEX "ride_requests_passenger_id_created_at_id_idx" ON "ride_requests"("passenger_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "ride_requests_status_created_at_id_idx" ON "ride_requests"("status", "created_at", "id");

-- CreateIndex
CREATE INDEX "ride_requests_route_id_status_idx" ON "ride_requests"("route_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ride_requests_passenger_id_idempotency_key_key" ON "ride_requests"("passenger_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "pools_pickup_zone_id_route_group_status_created_at_idx" ON "pools"("pickup_zone_id", "route_group", "status", "created_at");

-- CreateIndex
CREATE INDEX "pools_vehicle_id_created_at_id_idx" ON "pools"("vehicle_id", "created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "pool_memberships_request_id_key" ON "pool_memberships"("request_id");

-- CreateIndex
CREATE INDEX "pool_memberships_pool_id_released_at_idx" ON "pool_memberships"("pool_id", "released_at");

-- CreateIndex
CREATE UNIQUE INDEX "ride_events_operation_key_key" ON "ride_events"("operation_key");

-- CreateIndex
CREATE INDEX "ride_events_request_id_created_at_id_idx" ON "ride_events"("request_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "ride_events_pool_id_created_at_id_idx" ON "ride_events"("pool_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "ride_events_actor_id_idx" ON "ride_events"("actor_id");

-- AddForeignKey
ALTER TABLE "driver_profiles" ADD CONSTRAINT "driver_profiles_user_id_role_fkey" FOREIGN KEY ("user_id", "role") REFERENCES "users"("id", "role") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_driver_id_driver_role_fkey" FOREIGN KEY ("driver_id", "driver_role") REFERENCES "users"("id", "role") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "routes" ADD CONSTRAINT "routes_pickup_zone_id_fkey" FOREIGN KEY ("pickup_zone_id") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routes" ADD CONSTRAINT "routes_destination_zone_id_fkey" FOREIGN KEY ("destination_zone_id") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_requests" ADD CONSTRAINT "ride_requests_passenger_id_passenger_role_fkey" FOREIGN KEY ("passenger_id", "passenger_role") REFERENCES "users"("id", "role") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ride_requests" ADD CONSTRAINT "ride_requests_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "routes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pools" ADD CONSTRAINT "pools_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pools" ADD CONSTRAINT "pools_pickup_zone_id_fkey" FOREIGN KEY ("pickup_zone_id") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pool_memberships" ADD CONSTRAINT "pool_memberships_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "ride_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pool_memberships" ADD CONSTRAINT "pool_memberships_pool_id_fkey" FOREIGN KEY ("pool_id") REFERENCES "pools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_events" ADD CONSTRAINT "ride_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_events" ADD CONSTRAINT "ride_events_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "ride_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_events" ADD CONSTRAINT "ride_events_pool_id_fkey" FOREIGN KEY ("pool_id") REFERENCES "pools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- PostgreSQL-specific invariants; retain these when evolving the Prisma model.
ALTER TABLE users ADD CONSTRAINT users_email_normalized CHECK (email = lower(btrim(email)) AND length(email) > 3);
ALTER TABLE driver_profiles ADD CONSTRAINT driver_profiles_driver_role CHECK (role = 'DRIVER');
ALTER TABLE vehicles ADD CONSTRAINT vehicles_driver_role CHECK (driver_role = 'DRIVER'), ADD CONSTRAINT vehicles_positive_capacity CHECK (capacity > 0);
ALTER TABLE routes ADD CONSTRAINT routes_positive_distance CHECK (demo_distance_meters > 0), ADD CONSTRAINT routes_distinct_zones CHECK (pickup_zone_id <> destination_zone_id);
ALTER TABLE ride_requests
  ADD CONSTRAINT ride_requests_passenger_role CHECK (passenger_role = 'PASSENGER'),
  ADD CONSTRAINT ride_requests_positive_seats CHECK (seats > 0),
  ADD CONSTRAINT ride_requests_valid_key CHECK (length(idempotency_key) > 0),
  ADD CONSTRAINT ride_requests_fingerprint CHECK (payload_fingerprint ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT ride_requests_fare_inputs CHECK (distance_meters > 0 AND base_fare_poisha >= 0 AND rate_per_km_poisha >= 0 AND solo_maximum_poisha >= 0 AND provisional_pooled_poisha BETWEEN 0 AND solo_maximum_poisha),
  ADD CONSTRAINT ride_requests_finalization CHECK (
    (final_fare_poisha IS NULL AND finalized_at IS NULL AND discount_bps IS NULL AND status IN ('REQUESTED','MATCHED','CANCELLED'))
    OR (final_fare_poisha IS NOT NULL AND finalized_at IS NOT NULL AND discount_bps IS NOT NULL AND final_fare_poisha BETWEEN 0 AND solo_maximum_poisha AND discount_bps BETWEEN 0 AND 10000 AND status IN ('DRIVER_ARRIVED','IN_PROGRESS','COMPLETED'))
  );
ALTER TABLE pools ADD CONSTRAINT pools_capacity_bounds CHECK (capacity_snapshot > 0 AND allocated_seats BETWEEN 0 AND capacity_snapshot);
ALTER TABLE pool_memberships
  ADD CONSTRAINT memberships_positive_seats CHECK (seats > 0),
  ADD CONSTRAINT memberships_release_consistent CHECK ((released_at IS NULL AND release_reason IS NULL) OR (released_at IS NOT NULL AND release_reason IS NOT NULL AND released_at >= joined_at));
ALTER TABLE ride_events ADD CONSTRAINT events_has_subject CHECK (request_id IS NOT NULL OR pool_id IS NOT NULL);
CREATE UNIQUE INDEX one_active_booking_per_passenger ON ride_requests(passenger_id) WHERE status IN ('REQUESTED','MATCHED','DRIVER_ARRIVED','IN_PROGRESS');
CREATE UNIQUE INDEX one_active_pool_per_vehicle ON pools(vehicle_id) WHERE status IN ('ACCEPTED','DRIVER_ARRIVED','STARTED');