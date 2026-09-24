import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { BookingForm, BookingCard, RideWorkspace } from "./RideWorkspace";
import { useResource } from "./hooks";
import { apiPost, apiMutation, apiGet, ApiError } from "../api";
vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ user: { id: "test-passenger" }, restore }),
}));
vi.mock("../api", () => ({
  apiPost: vi.fn(),
  apiMutation: vi.fn(),
  apiGet: vi.fn(),
  ApiError: class extends Error {
    constructor(
      public status: number,
      public code: string,
      message: string,
    ) {
      super(message);
    }
  },
  errorMessage: (e: Error) => e.message,
}));
const restore = vi.hoisted(() => vi.fn());
const route = {
  id: "route-1",
  pickupZoneId: "a",
  destinationZoneId: "b",
  pickup: "Banani",
  destination: "Mohakhali",
  demoDistanceMeters: 3000,
};
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  sessionStorage.clear();
});
async function preview() {
  vi.mocked(apiPost).mockResolvedValue({
    soloMaximumPoisha: 5000,
    provisionalPooledPoisha: 4000,
  });
  fireEvent.click(screen.getByRole("button", { name: "Preview fare" }));
  await screen.findByText("50.00 BDT");
}
describe("booking intent and polling behavior", () => {
  it("clears an uncertain intent after recovering its active booking", async () => {
    sessionStorage.setItem(
      "dtp-booking-intent:test-passenger",
      JSON.stringify({ key: "old-key", routeId: route.id, seats: 1 }),
    );
    vi.mocked(apiGet).mockImplementation(async (path) => {
      if (path === "/ride-requests/active")
        return {
          id: "recovered",
          route,
          seats: 1,
          status: "REQUESTED",
          fare: {
            soloMaximumPoisha: 5000,
            provisionalPooledPoisha: 4000,
            finalFarePoisha: null,
          },
          pool: null,
          allowedActions: ["cancel"],
        } as never;
      if (path === "/routes") return [route] as never;
      return { items: [], nextCursor: null } as never;
    });
    render(
      <MemoryRouter initialEntries={["/passenger"]}>
        <RideWorkspace driver={false} />
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { name: "Waiting for a driver" });
    await waitFor(() =>
      expect(
        sessionStorage.getItem("dtp-booking-intent:test-passenger"),
      ).toBeNull(),
    );
  });

  it("retains the same request key after an uncertain failure, including a remount", async () => {
    vi.mocked(apiMutation).mockRejectedValue(
      new ApiError(0, "NETWORK_ERROR", "Connection lost"),
    );
    const first = render(<BookingForm routes={[route]} onCreated={vi.fn()} />);
    await preview();
    fireEvent.click(screen.getByRole("button", { name: "Request ride" }));
    await screen.findByRole("alert");
    const key = vi.mocked(apiMutation).mock.calls[0][3]!["Idempotency-Key"];
    expect(key).toBeTruthy();
    expect(apiMutation).toHaveBeenCalledTimes(1);
    first.unmount();
    render(<BookingForm routes={[route]} onCreated={vi.fn()} />);
    await preview();
    fireEvent.click(screen.getByRole("button", { name: "Request ride" }));
    await screen.findByRole("alert");
    expect(vi.mocked(apiMutation).mock.calls[1][3]!["Idempotency-Key"]).toBe(
      key,
    );
  });
  it("requires a fresh preview and key for changed booking details", async () => {
    vi.mocked(apiMutation).mockRejectedValue(new Error("Conflict"));
    render(<BookingForm routes={[route]} onCreated={vi.fn()} />);
    await preview();
    fireEvent.click(screen.getByRole("button", { name: "Request ride" }));
    await screen.findByRole("alert");
    const key = vi.mocked(apiMutation).mock.calls[0][3]!["Idempotency-Key"];
    fireEvent.change(screen.getByLabelText("Seats"), {
      target: { value: "2" },
    });
    expect(screen.getByRole("button", { name: "Request ride" })).toBeDisabled();
    await preview();
    fireEvent.click(screen.getByRole("button", { name: "Request ride" }));
    await waitFor(() => expect(apiMutation).toHaveBeenCalledTimes(2));
    expect(
      vi.mocked(apiMutation).mock.calls[1][3]!["Idempotency-Key"],
    ).not.toBe(key);
  });
  it("disables duplicate submission and clears confirmed intent", async () => {
    let finish!: (result: unknown) => void;
    vi.mocked(apiMutation).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const created = vi.fn();
    render(<BookingForm routes={[route]} onCreated={created} />);
    await preview();
    const submit = screen.getByRole("button", { name: "Request ride" });
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(apiMutation).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Seats")).toBeDisabled();
    await act(async () => finish({ id: "booking-1" }));
    expect(created).toHaveBeenCalledWith({ id: "booking-1" });
    expect(
      sessionStorage.getItem("dtp-booking-intent:test-passenger"),
    ).toBeNull();
  });
  it("polls only after a read finishes and aborts on unmount", async () => {
    vi.useFakeTimers();
    let finish!: (result: unknown) => void;
    vi.mocked(apiGet).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    function Probe() {
      useResource("/ride-requests/active", true);
      return null;
    }
    const view = render(<Probe />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(apiGet).toHaveBeenCalledTimes(1);
    await act(async () => finish(null));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(apiGet).toHaveBeenCalledTimes(2);
    const signal = vi.mocked(apiGet).mock.calls[1][1]!;
    view.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(apiGet).toHaveBeenCalledTimes(2);
  });
  it("shows a retryable server error and restores auth specifically for 401", async () => {
    vi.mocked(apiGet)
      .mockRejectedValueOnce(new ApiError(503, "SERVER_ERROR", "Unavailable"))
      .mockRejectedValueOnce(
        new ApiError(401, "UNAUTHENTICATED", "Session ended"),
      );
    function Probe() {
      const r = useResource("/ride-requests/active");
      return (
        <>
          <p>{r.error}</p>
          <button onClick={r.refresh}>Retry</button>
        </>
      );
    }
    render(<Probe />);
    await screen.findByText("Unavailable");
    expect(restore).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(restore).toHaveBeenCalledTimes(1));
  });
});

describe("shared fare presentation", () => {
  const booking = {
    id: "own-booking",
    route,
    seats: 1,
    status: "MATCHED",
    createdAt: "2026-09-24",
    allowedActions: ["cancel"],
    fare: {
      soloMaximumPoisha: 5000,
      provisionalPooledPoisha: 4000,
      finalFarePoisha: null,
      finalizedAt: null,
      discountBps: null,
    },
    pool: {
      id: "pool",
      status: "ACCEPTED",
      sharing: true,
      driver: { name: "Jashim" },
      vehicle: { name: "Bullet", capacity: 3 },
    },
  };
  it("labels shared fare as provisional and shows only own booking", () => {
    render(
      <MemoryRouter>
        <BookingCard booking={booking} refresh={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Shared ride assigned/)).toBeVisible();
    expect(screen.getByText(/at least two separate bookings/)).toBeVisible();
    expect(screen.getByText("50.00 BDT")).toBeVisible();
    expect(screen.getByText("40.00 BDT")).toBeVisible();
    expect(screen.queryByText(/Final fare/)).not.toBeInTheDocument();
  });
  it("shows fixed final fare without continuing to promise a provisional discount", () => {
    render(
      <MemoryRouter>
        <BookingCard
          booking={{
            ...booking,
            status: "IN_PROGRESS",
            allowedActions: [],
            fare: {
              ...booking.fare,
              finalFarePoisha: 4000,
              finalizedAt: "2026-09-24",
              discountBps: 2000,
            },
          }}
          refresh={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Final fare/)).toHaveTextContent("40.00 BDT");
    expect(
      screen.queryByText(/Provisional shared fare/),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Cancel request" }),
    ).not.toBeInTheDocument();
  });
});
