import { Link, Navigate, Route, Routes } from "react-router";
import { AuthProvider, homeFor, useAuth } from "./auth/AuthContext";
import { AuthForm, ProtectedLanding, SessionGate } from "./auth/AuthPages";
import { Foundation } from "./Foundation";
import styles from "./auth/auth.module.css";

function Home() {
  const auth = useAuth();
  if (auth.status === "loading" || auth.status === "error") return null;
  return <Navigate to={auth.user ? homeFor(auth.user) : "/login"} replace />;
}
export function App() {
  return (
    <AuthProvider>
      <div className={styles.shell}>
        <a className={styles.skip} href="#main-content">
          Skip to content
        </a>
        <header className={styles.header}>
          <Link className={styles.brand} to="/">
            DTP <span>/ DHAKA TESLA POOL</span>
          </Link>
          <nav aria-label="Main navigation">
            <Link to="/foundation">System status</Link>
            <Link to="/">My account</Link>
          </nav>
        </header>
        <main id="main-content" className={styles.main}>
          <Routes>
            <Route path="/foundation" element={<Foundation />} />
            <Route
              path="/"
              element={
                <SessionGate>
                  <Home />
                </SessionGate>
              }
            />
            <Route
              path="/login"
              element={
                <SessionGate>
                  <AuthForm key="login" mode="login" />
                </SessionGate>
              }
            />
            <Route
              path="/register"
              element={
                <SessionGate>
                  <AuthForm key="register" mode="register" />
                </SessionGate>
              }
            />
            {[
              "/passenger",
              "/passenger/history",
              "/passenger/bookings/:id",
            ].map((path) => (
              <Route
                key={path}
                path={path}
                element={
                  <SessionGate>
                    <ProtectedLanding role="PASSENGER" />
                  </SessionGate>
                }
              />
            ))}
            {["/driver", "/driver/history", "/driver/trips/:id"].map((path) => (
              <Route
                key={path}
                path={path}
                element={
                  <SessionGate>
                    <ProtectedLanding role="DRIVER" />
                  </SessionGate>
                }
              />
            ))}
            <Route
              path="*"
              element={
                <section className={styles.panel}>
                  <h1>Page not found</h1>
                  <Link to="/">Go to your account</Link>
                </section>
              }
            />
          </Routes>
        </main>
        <footer className={styles.footer}>
          <span>Share a seat. Split the fare. Survive Dhaka traffic.</span>
          <span>Single-booking rides · Demo only</span>
        </footer>
      </div>
    </AuthProvider>
  );
}
