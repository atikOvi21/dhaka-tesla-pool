import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { apiPost, ApiError, errorMessage } from "../api";
import { useAuth } from "../auth/AuthContext";
import { useAction, useResource } from "./hooks";
import {
  money,
  statusLabel,
  type Booking,
  type Route,
  type Pool,
  type Profile,
  type Page,
  type Waiting,
} from "./types";
import styles from "./rides.module.css";

function ReadState({
  resource,
}: {
  resource: { loading: boolean; error: string; refresh: () => void };
}) {
  return (
    <>
      {resource.loading && (
        <p role="status">Loading your ride information...</p>
      )}
      {resource.error && (
        <div role="alert">
          <p>{resource.error}</p>
          <button onClick={resource.refresh}>Retry ride information</button>
        </div>
      )}
    </>
  );
}
function RouteText({ route, seats }: { route: Route; seats: number }) {
  return (
    <p>
      {route.pickup} to {route.destination} · {route.demoDistanceMeters / 1000}{" "}
      demo km · {seats} {seats === 1 ? "seat" : "seats"}
    </p>
  );
}
export function BookingCard({
  booking,
  refresh,
}: {
  booking: Booking;
  refresh: () => void;
}) {
  const action = useAction(refresh);
  return (
    <article className={styles.card} aria-label="Booking">
      <h2>{statusLabel(booking.status)}</h2>
      <RouteText route={booking.route} seats={booking.seats} />
      <p>
        {booking.fare.finalFarePoisha === null ? "Solo maximum" : "Final fare"}:{" "}
        <strong>
          {money(
            booking.fare.finalFarePoisha ?? booking.fare.soloMaximumPoisha,
          )}
        </strong>
      </p>
      {booking.fare.finalFarePoisha === null &&
        booking.status !== "CANCELLED" && (
          <p>
            Provisional shared fare (20% off):{" "}
            <strong>{money(booking.fare.provisionalPooledPoisha)}</strong>.
            Applies only if at least two separate bookings remain when the
            driver arrives.
          </p>
        )}
      {booking.fare.finalFarePoisha !== null && (
        <p>
          {booking.fare.discountBps === 2000
            ? "20% sharing discount applied at arrival."
            : "Solo fare fixed at arrival."}
        </p>
      )}
      {booking.status === "REQUESTED" && (
        <p>
          Waiting for an online driver or a compatible pool with room for your
          entire booking.
        </p>
      )}
      {booking.pool && booking.status !== "CANCELLED" && (
        <p>
          {booking.pool.sharing
            ? "Shared ride assigned. Your fare and booking details stay private."
            : booking.pool.status === "ACCEPTED" ? "Your ride is assigned. Compatible passengers may join before arrival." : "Your ride is assigned; boarding is closed."}
        </p>
      )}
      {booking.status === "CANCELLED" && (
        <p>No charge. This booking was cancelled before arrival.</p>
      )}
      {booking.pool && (
        <p>
          Driver: <strong>{booking.pool.driver.name}</strong> · Vehicle:{" "}
          <strong>{booking.pool.vehicle.name}</strong>
        </p>
      )}
      {booking.allowedActions.includes("cancel") && (
        <button
          disabled={action.pending}
          onClick={() =>
            void action.run("/ride-requests/" + booking.id + "/cancel")
          }
        >
          {action.pending ? "Cancelling..." : "Cancel request"}
        </button>
      )}
      {action.error && (
        <p role="alert">
          {action.error} Refresh the ride information before trying again.
        </p>
      )}
      <p>
        <Link to={"/passenger/bookings/" + booking.id}>Booking details</Link>
      </p>
    </article>
  );
}
type Intent = { key: string; routeId: string; seats: number };
function readIntent(storageKey: string): Intent | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
    return value &&
      typeof value.key === "string" &&
      typeof value.routeId === "string" &&
      Number.isInteger(value.seats) &&
      value.seats > 0
      ? value
      : null;
  } catch {
    return null;
  }
}
export function BookingForm({
  routes,
  onCreated,
}: {
  routes: Route[];
  onCreated: (booking: Booking) => void;
}) {
  const { user, restore } = useAuth();
  const storageKey = "dtp-booking-intent:" + user!.id;
  const [saved] = useState(() => readIntent(storageKey));
  const [routeId, setRouteId] = useState(saved?.routeId ?? routes[0]?.id ?? "");
  const [seats, setSeats] = useState(saved?.seats ?? 1);
  const intent = useRef<Intent | null>(saved);
  const [estimate, setEstimate] = useState<{
    signature: string;
    poisha: number;
    pooled: number;
  } | null>(null);
  const [previewError, setPreviewError] = useState(""),
    [previewing, setPreviewing] = useState(false);
  const previewVersion = useRef(0),
    previewBusy = useRef(false);
  const action = useAction(() => {});
  const signature = routeId + ":" + seats;
  useEffect(
    () => () => {
      previewVersion.current++;
    },
    [],
  );
  function changed() {
    previewVersion.current++;
    setEstimate(null);
    setPreviewError("");
    intent.current = null;
    try {
      sessionStorage.removeItem(storageKey);
    } catch {}
  }
  async function preview() {
    if (previewBusy.current) return;
    previewBusy.current = true;
    setPreviewing(true);
    setPreviewError("");
    const version = ++previewVersion.current;
    try {
      const fare = await apiPost<{
        soloMaximumPoisha: number;
        provisionalPooledPoisha: number;
      }>("/fare-estimates", { routeId, seats });
      if (version === previewVersion.current)
        setEstimate({
          signature,
          poisha: fare.soloMaximumPoisha,
          pooled: fare.provisionalPooledPoisha,
        });
    } catch (error) {
      if (version === previewVersion.current) {
        setPreviewError(errorMessage(error));
        if (error instanceof ApiError && error.status === 401) void restore();
      }
    } finally {
      previewBusy.current = false;
      setPreviewing(false);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!estimate || estimate.signature !== signature) return;
    if (
      !intent.current ||
      intent.current.routeId !== routeId ||
      intent.current.seats !== seats
    )
      intent.current = { key: crypto.randomUUID(), routeId, seats };
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(intent.current));
    } catch {}
    const result = await action.run<Booking>(
      "/ride-requests",
      { routeId, seats },
      "POST",
      { "Idempotency-Key": intent.current.key },
    );
    if (result) {
      intent.current = null;
      try {
        sessionStorage.removeItem(storageKey);
      } catch {}
      onCreated(result);
    }
  }
  return (
    <form className={styles.card} onSubmit={submit}>
      <h2>Request your ride</h2>
      <p>
        Compatible trips can share a vehicle. Fares become fixed when the driver
        arrives.
      </p>
      <fieldset disabled={action.pending || previewing}>
        <label htmlFor="ride-route">Route</label>
        <select
          id="ride-route"
          value={routeId}
          onChange={(e) => {
            changed();
            setRouteId(e.target.value);
          }}
          required
        >
          {routes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.pickup} to {r.destination} ({r.demoDistanceMeters / 1000} demo
              km)
            </option>
          ))}
        </select>
        <label htmlFor="ride-seats">Seats</label>
        <input
          id="ride-seats"
          type="number"
          min="1"
          step="1"
          value={seats}
          required
          onChange={(e) => {
            changed();
            setSeats(Number(e.target.value));
          }}
        />
        <button
          type="button"
          onClick={() => void preview()}
          disabled={!routeId || !Number.isInteger(seats) || seats < 1}
        >
          {previewing ? "Calculating..." : "Preview fare"}
        </button>
        {estimate?.signature === signature && (
          <p role="status">
            Solo maximum: <strong>{money(estimate.poisha)}</strong>. Provisional
            shared fare (20% off): <strong>{money(estimate.pooled)}</strong>.
            The discount applies only if at least two separate bookings remain
            at arrival.
          </p>
        )}
        <button
          type="submit"
          disabled={!estimate || estimate.signature !== signature}
        >
          {action.pending ? "Requesting..." : "Request ride"}
        </button>
      </fieldset>
      {previewError && <p role="alert">{previewError}</p>}
      {action.error && (
        <p role="alert">
          {action.error} You can retry these same details safely; your request
          key is retained.
        </p>
      )}
    </form>
  );
}
function PassengerHome() {
  // Fetch active state and recent history together; terminal trips stay visible when active becomes null.
  const { user } = useAuth();
  const active = useResource<Booking | null>("/ride-requests/active", true);
  useEffect(() => {
    if (active.data) {
      try {
        sessionStorage.removeItem("dtp-booking-intent:" + user!.id);
      } catch {}
    }
  }, [active.data, user]);
  const history = useResource<Page<Booking>>("/ride-requests?limit=1", true);
  const routes = useResource<Route[]>("/routes");
  const navigate = useNavigate();
  const refresh = () => {
    active.refresh();
    history.refresh();
  };
  return (
    <>
      <ReadState resource={active} />
      <ReadState resource={routes} />
      {active.data && <BookingCard booking={active.data} refresh={refresh} />}
      {active.data === null && !active.error && (
        <>
          <p>You have no active ride request.</p>
          {routes.data?.length ? (
            <BookingForm
              routes={routes.data}
              onCreated={(b) => navigate("/passenger/bookings/" + b.id)}
            />
          ) : (
            !routes.loading && <p>No supported routes are available.</p>
          )}
          {history.data?.items[0] && (
            <section aria-label="Latest booking">
              <h2>Latest booking</h2>
              <BookingCard booking={history.data.items[0]} refresh={refresh} />
            </section>
          )}
        </>
      )}
      <ReadState resource={history} />
    </>
  );
}
function PassengerDetail() {
  const { id } = useParams();
  const resource = useResource<Booking>("/ride-requests/" + id, true);
  return (
    <>
      <ReadState resource={resource} />
      {resource.data && (
        <BookingCard booking={resource.data} refresh={resource.refresh} />
      )}
      <Link to="/passenger">Back to your workspace</Link>
    </>
  );
}
function PoolCard({ pool, refresh }: { pool: Pool; refresh: () => void }) {
  const action = useAction(refresh);
  const labels: Record<string, string> = {
    arrive: "Mark arrival",
    start: "Start trip",
    complete: "Complete trip",
  };
  return (
    <article className={styles.card} aria-label="Trip">
      <h2>{statusLabel(pool.status)}</h2>
      <p>
        {pool.vehicle.name} · {pool.allocatedSeats} / {pool.capacitySnapshot}{" "}
        seats allocated
      </p>
      {pool.members.map((m) => (
        <section className={styles.member} key={m.id}>
          <h3>{m.passengerName}</h3>
          <RouteText route={m.route} seats={m.seats} />
          <p>{statusLabel(m.status)}</p>
          {m.allowedActions.includes("complete") && (
            <button
              disabled={action.pending}
              onClick={() =>
                void action.run(
                  "/driver/pools/" +
                    pool.id +
                    "/memberships/" +
                    m.id +
                    "/complete",
                )
              }
            >
              Mark {m.passengerName} dropped off
            </button>
          )}
        </section>
      ))}
      {pool.allowedActions.map((name) => (
        <button
          disabled={action.pending}
          key={name}
          onClick={() =>
            void action.run("/driver/pools/" + pool.id + "/" + name)
          }
        >
          {labels[name]}
        </button>
      ))}
      {action.pending && <p role="status">Updating trip...</p>}
      {action.error && (
        <p role="alert">{action.error} Refresh before trying again.</p>
      )}
      <p>
        <Link to={"/driver/trips/" + pool.id}>Trip details</Link>
      </p>
    </article>
  );
}
function DriverHome() {
  const profile = useResource<Profile>("/driver/profile", true);
  const active = useResource<Pool | null>("/driver/pools/active", true);
  const [cursor, setCursor] = useState("");
  const waiting = useResource<Page<Waiting>>(
    "/driver/ride-requests?limit=20" +
      (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
    true,
  );
  const recent = useResource<Page<Pool>>("/driver/pools?limit=1", true);
  const navigate = useNavigate();
  const refresh = () => {
    profile.refresh();
    active.refresh();
    waiting.refresh();
    recent.refresh();
  };
  const action = useAction(refresh);
  return (
    <>
      <ReadState resource={profile} />
      <ReadState resource={active} />
      {profile.data && (
        <section className={styles.card}>
          <h2>Driver availability</h2>
          <p>
            {profile.data.vehicle.name} · {profile.data.vehicle.capacity} seats
            · <strong>{profile.data.online ? "Online" : "Offline"}</strong>
          </p>
          <button
            disabled={
              action.pending ||
              active.loading ||
              !!active.error ||
              !!active.data
            }
            onClick={() =>
              void action.run(
                "/driver/availability",
                { online: !profile.data!.online },
                "PATCH",
              )
            }
          >
            {profile.data.online ? "Go offline" : "Go online"}
          </button>
          {!!active.data && (
            <p>Complete the active trip before going offline.</p>
          )}
        </section>
      )}
      {action.error && (
        <p role="alert">{action.error} Refresh the list before trying again.</p>
      )}
      {active.data && <PoolCard pool={active.data} refresh={refresh} />}
      {active.data === null && !active.error && (
        <>
          <section className={styles.card}>
            <h2>Waiting requests</h2>
            <ReadState resource={waiting} />
            {!profile.data?.online && <p>Go online to accept a request.</p>}
            {waiting.data?.items.length === 0 && <p>No waiting requests.</p>}
            {waiting.data?.items.map((r) => (
              <article className={styles.member} key={r.id}>
                <RouteText route={r.route} seats={r.seats} />
                <button
                  disabled={
                    action.pending || !profile.data?.online || !!waiting.error
                  }
                  onClick={async () => {
                    const pool = await action.run<Pool>(
                      "/driver/ride-requests/" + r.id + "/accept",
                    );
                    if (pool) navigate("/driver/trips/" + pool.id);
                  }}
                >
                  Accept request
                </button>
              </article>
            ))}
            {cursor && (
              <button onClick={() => setCursor("")}>Newest requests</button>
            )}
            {waiting.data?.nextCursor && (
              <button onClick={() => setCursor(waiting.data!.nextCursor!)}>
                Older requests
              </button>
            )}
          </section>
          {recent.data?.items[0] && (
            <section aria-label="Latest trip">
              <h2>Latest trip</h2>
              <PoolCard pool={recent.data.items[0]} refresh={refresh} />
            </section>
          )}
        </>
      )}
      <ReadState resource={recent} />
    </>
  );
}
function DriverDetail() {
  const { id } = useParams(),
    resource = useResource<Pool>("/driver/pools/" + id, true);
  return (
    <>
      <ReadState resource={resource} />
      {resource.data && (
        <PoolCard pool={resource.data} refresh={resource.refresh} />
      )}
      <Link to="/driver">Back to your workspace</Link>
    </>
  );
}
function History({ driver }: { driver: boolean }) {
  const [cursor, setCursor] = useState(""),
    [previous, setPrevious] = useState<string[]>([]);
  const path = driver ? "/driver/pools" : "/ride-requests";
  const resource = useResource<Page<Booking | Pool>>(
    path +
      "?limit=10" +
      (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
  );
  return (
    <section className={styles.card}>
      <h2>{driver ? "Trip history" : "Booking history"}</h2>
      <ReadState resource={resource} />
      {resource.data?.items.length === 0 && <p>No rides yet.</p>}
      {resource.data?.items.map((item) => (
        <article className={styles.member} key={item.id}>
          <h3>
            <Link
              to={
                driver
                  ? "/driver/trips/" + item.id
                  : "/passenger/bookings/" + item.id
              }
            >
              {statusLabel(item.status)}
            </Link>
          </h3>
          <p>{new Date(item.createdAt).toLocaleString()}</p>
          {"route" in item ? (
            <>
              <RouteText route={item.route} seats={item.seats} />
              <p>
                {item.status === "CANCELLED"
                  ? "No charge"
                  : money(
                      item.fare.finalFarePoisha ?? item.fare.soloMaximumPoisha,
                    )}
              </p>
            </>
          ) : (
            <p>
              {item.vehicle.name} · {item.members.length} bookings
            </p>
          )}
        </article>
      ))}
      {previous.length > 0 && (
        <button
          onClick={() => {
            setCursor(previous.at(-1)!);
            setPrevious((p) => p.slice(0, -1));
          }}
        >
          Newer rides
        </button>
      )}
      {resource.data?.nextCursor && (
        <button
          onClick={() => {
            setPrevious((p) => [...p, cursor]);
            setCursor(resource.data!.nextCursor!);
          }}
        >
          Older rides
        </button>
      )}
    </section>
  );
}
export function RideWorkspace({ driver }: { driver: boolean }) {
  const { pathname } = useLocation();
  const base = driver ? "/driver" : "/passenger";
  return (
    <div className={styles.workspace}>
      <nav aria-label="Ride navigation">
        <Link to={base}>Current ride</Link>
        <Link to={base + "/history"}>History</Link>
      </nav>
      {pathname === base + "/history" ? (
        <History driver={driver} />
      ) : pathname.startsWith(base + (driver ? "/trips/" : "/bookings/")) ? (
        driver ? (
          <DriverDetail />
        ) : (
          <PassengerDetail />
        )
      ) : driver ? (
        <DriverHome />
      ) : (
        <PassengerHome />
      )}
    </div>
  );
}
