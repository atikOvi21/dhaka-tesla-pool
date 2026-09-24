import { RideWorkspace } from "../rides/RideWorkspace";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Link, Navigate } from "react-router";
import { ApiError, errorMessage } from "../api";
import { homeFor, useAuth, type User } from "./AuthContext";
import styles from "./auth.module.css";

export function SessionGate({ children }: { children: ReactNode }) {
  const auth = useAuth();
  let notice: ReactNode = null;
  if (auth.status === "loading")
    notice = (
      <section className={styles.panel}>
        <h1>Checking your session</h1>
        <p role="status">Please wait while we reconnect your account…</p>
      </section>
    );
  if (auth.status === "error")
    notice = (
      <section className={styles.panel}>
        <h1>We couldn't check your session</h1>
        <p role="alert">{auth.message}</p>
        <button onClick={() => void auth.restore()}>Retry connection</button>
        <p>Your sign-in status has not been discarded.</p>
      </section>
    );
  return (
    <>
      {notice}
      <div hidden={!!notice}>{children}</div>
    </>
  );
}

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const auth = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const registration = mode === "register";
  useEffect(() => {
    form.current
      ?.querySelector<HTMLInputElement>('[aria-invalid="true"]')
      ?.focus();
  }, [fields]);
  if (auth.status === "authenticated" && auth.user)
    return <Navigate to={homeFor(auth.user)} replace />;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const invalid: Record<string, string> = {};
    if (registration && (!name.trim() || name.trim().length > 100))
      invalid.name = "Enter your name (1–100 characters).";
    if (
      email.trim().length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
    )
      invalid.email = "Enter a valid email address.";
    if (password.length < 12 || password.length > 128)
      invalid.password =
        "Use 12–128 characters. Spaces count and are preserved.";
    setFields(invalid);
    setError("");
    if (Object.keys(invalid).length) return;
    submitting.current = true;
    setPending(true);
    try {
      await auth.authenticate(mode, {
        email,
        password,
        ...(registration ? { name } : {}),
      });
    } catch (failure) {
      setError(errorMessage(failure));
      if (failure instanceof ApiError && failure.code === "EMAIL_UNAVAILABLE")
        setFields({
          email: "This email already has an account. Try signing in.",
        });
    } finally {
      setPassword("");
      setPending(false);
      submitting.current = false;
    }
  }

  return (
    <div className={styles.authGrid}>
      <section className={styles.story}>
        <p className={styles.eyebrow}>DHAKA, ONE SHARED JOURNEY</p>
        <h1>
          {registration ? "Your seat starts here." : "Good to see you again."}
        </h1>
        <p>
          One account. Your own journey.
          <br />A simpler way to share the road is coming.
        </p>
        <div className={styles.route}>
          <span>Banani</span>
          <span aria-hidden="true">→</span>
          <span>Mohakhali</span>
        </div>
        <p className={styles.caption}>
          Inspired by Nusrat, Rafiq, Shirin — and Jashim's three-seat Bullet.
        </p>
      </section>
      <section className={styles.panel} aria-labelledby="form-heading">
        <p className={styles.eyebrow}>
          {registration ? "PASSENGER ACCOUNT" : "PASSENGERS & DRIVERS"}
        </p>
        <h2 id="form-heading">
          {registration ? "Create your account" : "Sign in"}
        </h2>
        <p>
          {registration
            ? "Registration creates a passenger account. Drivers use their assigned accounts."
            : "Use your email and password to continue."}
        </p>
        {auth.message && (
          <p role="status" className={styles.notice}>
            {auth.message}
          </p>
        )}
        {error && (
          <div role="alert" className={styles.error}>
            <p>{error}</p>
            <p>No request has been automatically resubmitted.</p>
            <button
              type="button"
              className={styles.secondary}
              onClick={() => void auth.restore()}
            >
              Check session
            </button>
          </div>
        )}
        <form ref={form} noValidate onSubmit={submit} aria-busy={pending}>
          <fieldset disabled={pending}>
            {registration && (
              <div className={styles.field}>
                <label htmlFor="name">Name</label>
                <input
                  id="name"
                  name="name"
                  autoComplete="name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={100}
                  aria-invalid={!!fields.name}
                  aria-describedby={fields.name ? "name-error" : undefined}
                />
                {fields.name && (
                  <span id="name-error" className={styles.fieldError}>
                    {fields.name}
                  </span>
                )}
              </div>
            )}
            <div className={styles.field}>
              <label htmlFor="email">Email</label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                autoCapitalize="none"
                spellCheck={false}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                maxLength={254}
                aria-invalid={!!fields.email}
                aria-describedby={fields.email ? "email-error" : undefined}
              />
              {fields.email && (
                <span id="email-error" className={styles.fieldError}>
                  {fields.email}
                </span>
              )}
            </div>
            <div className={styles.field}>
              <label htmlFor="password">Password</label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete={
                  registration ? "new-password" : "current-password"
                }
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                maxLength={128}
                aria-invalid={!!fields.password}
                aria-describedby={
                  fields.password ? "password-error" : "password-help"
                }
              />
              <span id="password-help" className={styles.caption}>
                12–128 characters. Your spaces are preserved.
              </span>
              {fields.password && (
                <span id="password-error" className={styles.fieldError}>
                  {fields.password}
                </span>
              )}
            </div>
            <button className={styles.submit} type="submit" disabled={pending}>
              {pending
                ? "Please wait…"
                : registration
                  ? "Create account"
                  : "Sign in"}
            </button>
          </fieldset>
          {pending && (
            <p role="status">
              Securely{" "}
              {registration ? "creating your account" : "signing you in"}…
            </p>
          )}
        </form>
        <p className={styles.switch}>
          {registration
            ? "Already have an account? "
            : "New to Dhaka Tesla Pool? "}
          <Link to={registration ? "/login" : "/register"}>
            {registration ? "Sign in" : "Create a passenger account"}
          </Link>
        </p>
      </section>
    </div>
  );
}

export function ProtectedLanding({ role }: { role: User["role"] }) {
  const auth = useAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const busy = useRef(false);
  if (auth.status === "loading" || auth.status === "error") return null;
  if (!auth.user) return <Navigate to="/login" replace />;
  if (auth.user.role !== role)
    return (
      <section className={styles.panel}>
        <h1>This page is for {role === "DRIVER" ? "drivers" : "passengers"}</h1>
        <p>Your account cannot access this workspace.</p>
        <Link to={homeFor(auth.user)}>Go to your workspace</Link>
      </section>
    );
  async function signOut() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      await auth.logout();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  const driver = role === "DRIVER";
  return (
    <section className={styles.landing}>
      <p className={styles.eyebrow}>
        {driver ? "DRIVER WORKSPACE" : "PASSENGER WORKSPACE"}
      </p>
      <h1>Welcome, {auth.user.name}.</h1>
      <p className={styles.lead}>
        You're signed in as a {driver ? "driver" : "passenger"}.
      </p>
      <div className={styles.account}>
        <div>
          <strong>{auth.user.email}</strong>
          <p>Your session is stored securely on the server.</p>
        </div>
        <button onClick={() => void signOut()} disabled={pending}>
          {pending ? "Signing out…" : "Sign out"}
        </button>
      </div>
      {error && (
        <div role="alert" className={styles.error}>
          <p>{error}</p>
          <p>
            We could not confirm sign-out. You can retry or check your session.
          </p>
          <button onClick={() => void auth.restore()}>Check session</button>
        </div>
      )}
      <RideWorkspace driver={driver} />
      <Link to="/foundation">Check the system connection</Link>
    </section>
  );
}
