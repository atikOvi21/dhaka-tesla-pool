import { useEffect, useState } from "react";

import { apiGet } from "./api";
import styles from "./page.module.css";

type Check = { state: "checking" | "ready" | "error"; message: string };
export function Foundation() {
  const [check, setCheck] = useState<Check>({
    state: "checking",
    message: "Checking API and database…",
  });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let active = true;
    setCheck({ state: "checking", message: "Checking API and database…" });
    apiGet<{ status: string }>("/health/ready", controller.signal)
      .then((data) => {
        if (data.status !== "ready")
          throw new Error("Unexpected readiness response.");
        if (active)
          setCheck({
            state: "ready",
            message: "Browser → API → PostgreSQL connected",
          });
      })
      .catch((error: unknown) => {
        if (active)
          setCheck({
            state: "error",
            message:
              error instanceof Error && error.name !== "AbortError"
                ? error.message
                : "Connection timed out. Please retry.",
          });
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [attempt]);
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span className={styles.brand}>DTP / DHAKA TESLA POOL</span>
        <span className={styles.tag}>Foundation · 01</span>
      </header>
      <section className={styles.hero}>
        <p className={styles.eyebrow}>BANANI, DHAKA · A SMALL START</p>
        <h1>
          Three seats.
          <br />
          One shared journey.
        </h1>
        <p className={styles.intro}>
          Meet Jashim and Bullet. We’re building a simple way for Nusrat, Rafiq,
          and Shirin to share compatible trips across Dhaka.
        </p>
      </section>
      <section className={styles.card} aria-labelledby="connection-heading">
        <div>
          <p className={styles.eyebrow}>SYSTEM CHECK</p>
          <h2 id="connection-heading">The foundation is taking shape.</h2>
        </div>
        <p role="status" aria-live="polite" className={styles[check.state]}>
          {check.message}
        </p>
        <button
          disabled={check.state === "checking"}
          onClick={() => setAttempt((value) => value + 1)}
        >
          Check connection again
        </button>
      </section>
      <section className={styles.scope}>
        <h2>What’s here today</h2>
        <p>
          A React frontend, an Express API, and a PostgreSQL database with the
          demo cast and routes. This page verifies their connection.
        </p>
        <h2>Shared rides are available</h2>
        <p>
          Compatible rides can share Bullet. Book from your account, see your
          own fare, and follow your trip through completion.
        </p>
      </section>
      <footer className={styles.footer}>
        Share a seat. Split the fare. Survive Dhaka traffic.
        <span>Demo routes use simplified geography.</span>
      </footer>
    </div>
  );
}
