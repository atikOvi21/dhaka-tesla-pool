import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { apiGet, apiPost, ApiError, errorMessage, refreshCsrf } from "../api";

export type User = {
  id: string;
  name: string;
  email: string;
  role: "PASSENGER" | "DRIVER";
};
type Session = {
  status: "loading" | "authenticated" | "anonymous" | "error";
  user: User | null;
  message: string;
};
type Credentials = { email: string; password: string; name?: string };
type AuthContextValue = Session & {
  restore: (background?: boolean) => Promise<void>;
  authenticate: (
    mode: "login" | "register",
    values: Credentials,
  ) => Promise<void>;
  logout: () => Promise<void>;
};
const AuthContext = createContext<AuthContextValue | null>(null);
export const homeFor = (user: User) =>
  user.role === "DRIVER" ? "/driver" : "/passenger";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session>({
    status: "loading",
    user: null,
    message: "",
  });
  const currentUser = useRef<User | null>(null);
  // Ignore stale checks that finish after a newer login/logout.
  const version = useRef(0);
  const changingSession = useRef(false);

  const restore = useCallback(async (background = false) => {
    if (changingSession.current) return;
    const requestVersion = ++version.current;
    if (!background)
      setSession((previous) => ({ ...previous, status: "loading" }));
    try {
      const user = await apiGet<User>("/auth/me");
      if (!background) await refreshCsrf();
      if (requestVersion !== version.current) return;
      currentUser.current = user;
      setSession({ status: "authenticated", user, message: "" });
    } catch (error) {
      if (requestVersion !== version.current) return;
      if (error instanceof ApiError && error.status === 401) {
        const message = currentUser.current
          ? "Your session expired or ended in another tab. Please sign in again."
          : "";
        currentUser.current = null;
        setSession({ status: "anonymous", user: null, message });
      } else {
        setSession({
          status: "error",
          user: currentUser.current,
          message: errorMessage(error),
        });
      }
    }
  }, []);

  useEffect(() => {
    void restore();
    return () => {
      version.current++;
    };
  }, [restore]);

  useEffect(() => {
    if (session.status !== "authenticated") return;
    const check = () => {
      if (document.visibilityState === "visible") void restore(true);
    };
    const timer = window.setInterval(check, 60000);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [session.status, restore]);

  async function authenticate(mode: "login" | "register", values: Credentials) {
    if (changingSession.current) return;
    changingSession.current = true;
    version.current++;
    try {
      const user = await apiPost<User>(`/auth/${mode}`, values);
      currentUser.current = user;
      // Authentication already succeeded; a token-refresh failure must not replay it.
      try {
        await refreshCsrf();
        setSession({ status: "authenticated", user, message: "" });
      } catch (error) {
        setSession({
          status: "error",
          user,
          message:
            "Sign-in succeeded, but we couldn't refresh your session. " +
            errorMessage(error),
        });
      }
    } finally {
      changingSession.current = false;
    }
  }

  async function logout() {
    if (changingSession.current) return;
    changingSession.current = true;
    version.current++;
    try {
      await apiPost<null>("/auth/logout");
      currentUser.current = null;
      setSession({
        status: "anonymous",
        user: null,
        message: "You have signed out.",
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        currentUser.current = null;
        setSession({
          status: "anonymous",
          user: null,
          message: "Your session expired. Please sign in again.",
        });
      } else {
        throw error; // An outage is not proof that the server logged the user out.
      }
    } finally {
      changingSession.current = false;
    }
  }

  return (
    <AuthContext.Provider value={{ ...session, restore, authenticate, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be inside AuthProvider");
  return context;
}
