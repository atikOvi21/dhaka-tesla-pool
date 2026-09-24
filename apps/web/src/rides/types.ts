export type Route = {
  id: string;
  pickupZoneId: string;
  destinationZoneId: string;
  pickup: string;
  destination: string;
  demoDistanceMeters: number;
};
export type Booking = {
  id: string;
  route: Route;
  seats: number;
  status: string;
  createdAt: string;
  allowedActions: string[];
  fare: {
    soloMaximumPoisha: number;
    provisionalPooledPoisha: number;
    discountBps: number | null;
    finalFarePoisha: number | null;
    finalizedAt: string | null;
  };
  pool: {
    id: string;
    status: string;
    sharing: boolean;
    driver: { name: string };
    vehicle: { name: string; capacity: number };
  } | null;
};
export type Pool = {
  id: string;
  status: string;
  createdAt: string;
  allocatedSeats: number;
  capacitySnapshot: number;
  allowedActions: string[];
  vehicle: { name: string };
  members: {
    id: string;
    requestId: string;
    passengerName: string;
    route: Route;
    seats: number;
    status: string;
    allowedActions: string[];
  }[];
};
export type Profile = {
  online: boolean;
  vehicle: { name: string; capacity: number };
};
export type Page<T> = { items: T[]; nextCursor: string | null };
export type Waiting = { id: string; route: Route; seats: number };
export const money = (poisha: number) => (poisha / 100).toFixed(2) + " BDT";
export const statusLabel = (status: string) =>
  ({
    REQUESTED: "Waiting for a driver",
    MATCHED: "Driver assigned",
    DRIVER_ARRIVED: "Driver arrived",
    IN_PROGRESS: "On the way",
    COMPLETED: "Completed",
    CANCELLED: "Cancelled",
    ACCEPTED: "Accepted",
    STARTED: "Trip started",
  })[status] ?? status;
