export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/v1${path}`, { credentials: 'same-origin', signal });
  const body = await response.json() as { data?: T; error?: { message: string } };
  if (!response.ok) throw new Error(body.error?.message ?? `Request failed (${response.status}).`);
  if (!('data' in body)) throw new Error('Unexpected API response.');
  return body.data as T;
}
