import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet, ApiError, apiMutation, errorMessage } from "../api";
import { useAuth } from "../auth/AuthContext";
export function useResource<T>(path: string, poll = false) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const { restore } = useAuth();
  const refresh = useCallback(() => setRevision((n) => n + 1), []);
  useEffect(() => {
    let stopped = false,
      timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    setData(undefined);
    setLoading(true);
    async function load() {
      try {
        const result = await apiGet<T>(path, controller.signal);
        if (!stopped) {
          setData(result);
          setError("");
        }
      } catch (failure) {
        if (!stopped) {
          setError(errorMessage(failure));
          if (failure instanceof ApiError && failure.status === 401)
            void restore();
        }
      } finally {
        if (!stopped) {
          setLoading(false);
          // Schedule after completion, so a slow read never overlaps its next poll.
          if (poll) timer = setTimeout(load, 5000);
        }
      }
    }
    void load();
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [path, revision, poll, restore]);
  return { data, error, loading, refresh };
}
export function useAction(onSuccess: () => void) {
  const [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const busy = useRef(false),
    mounted = useRef(true);
  const { restore } = useAuth();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function run<T>(
    path: string,
    body: unknown = {},
    method: "POST" | "PATCH" = "POST",
    headers?: Record<string, string>,
  ) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      const result = await apiMutation<T>(path, body, method, headers);
      if (mounted.current) onSuccess();
      return result;
    } catch (failure) {
      if (mounted.current) {
        setError(errorMessage(failure));
        if (failure instanceof ApiError && failure.status === 401)
          void restore();
      }
      return undefined;
    } finally {
      busy.current = false;
      if (mounted.current) setPending(false);
    }
  }
  return { run, pending, error };
}
