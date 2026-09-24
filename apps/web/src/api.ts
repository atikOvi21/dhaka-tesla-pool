// Status and code let the UI distinguish an expired session from an outage.
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      ...options,
      credentials: "same-origin",
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(10000)])
        : AbortSignal.timeout(10000),
    });
  } catch {
    throw new ApiError(
      0,
      "NETWORK_ERROR",
      "We couldn't confirm the request. Check your connection and try again.",
    );
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(
      response.status,
      body?.error?.code ?? "SERVER_ERROR",
      body?.error?.message ?? "The server is unavailable. Please try again.",
    );
  }
  if (!body || !("data" in body)) {
    throw new ApiError(
      502,
      "INVALID_RESPONSE",
      "The server returned an unexpected response. Please try again.",
    );
  }
  return body.data as T;
}

export function apiGet<T>(path: string, signal?: AbortSignal) {
  return request<T>(path, { signal });
}

export async function refreshCsrf() {
  const result = await apiGet<{ csrfToken: string }>("/auth/csrf");
  return result.csrfToken;
}

export function apiPost<T>(path: string, data: unknown = {}): Promise<T> {
  return apiMutation<T>(path, data);
}

export async function apiMutation<T>(
  path: string,
  data: unknown = {},
  method: "POST" | "PATCH" = "POST",
  headers: Record<string, string> = {},
): Promise<T> {
  // Fetch just before each user action: no stale token cache or browser storage.
  const csrfToken = await refreshCsrf();
  // Never automatically replay a mutation, even after a timeout or CSRF failure.
  return request<T>(path, {
    method,
    headers: {
      ...headers,
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken,
    },
    body: JSON.stringify(data),
  });
}

export function errorMessage(error: unknown) {
  if (error instanceof ApiError && error.code === "CSRF_INVALID") {
    return "Your security token changed. Please submit again to get a fresh token.";
  }
  if (
    error instanceof ApiError &&
    error.status === 401 &&
    error.code !== "INVALID_CREDENTIALS"
  ) {
    return "Your session expired. Please sign in again.";
  }
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
}
