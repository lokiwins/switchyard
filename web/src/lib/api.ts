/* switchyard's JSON API: every answer is { success, data } or { success: false, error }. */

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function unwrap<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => null)) as { success?: boolean; data?: T; error?: string } | null;
  if (!body?.success) throw new ApiError(body?.error ?? `HTTP ${res.status}`, res.status);
  return body.data as T;
}

export async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  return unwrap<T>(await fetch(url, { signal, cache: 'no-store' }));
}

export async function post<T = unknown>(url: string, body: unknown): Promise<T> {
  return unwrap<T>(await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
}
