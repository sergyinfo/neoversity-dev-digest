const BASE = import.meta.env.VITE_API_BASE;

async function call<T>(pathname: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${pathname}`, {
    ...init,
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      'x-workspace-id': localStorage.getItem('workspaceId') ?? '',
      ...(init.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${init.method ?? 'GET'} ${pathname} failed (${res.status}): ${body.slice(0, 200)}`);
  }

  return (await res.json()) as T;
}

export const api = {
  get: <T>(p: string) => call<T>(p),
  post: <T>(p: string, body: unknown) => call<T>(p, { method: 'POST', body: JSON.stringify(body) }),
};
