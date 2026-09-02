import { request } from 'undici';

import { logger } from './logging.js';

export class ApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string
  ) {}

  private async call<T>(method: string, pathname: string, body?: unknown): Promise<T> {
    const res = await request(`${this.baseUrl}${pathname}`, {
      method: method as 'GET' | 'POST',
      headers: {
        authorization: `Bearer ${this.token}`,
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (res.statusCode >= 400) {
      logger.error('api call failed', { method, pathname, status: res.statusCode });
      throw new Error(`${method} ${pathname} -> ${res.statusCode}`);
    }

    return (await res.body.json()) as T;
  }

  get<T>(pathname: string): Promise<T> {
    return this.call<T>('GET', pathname);
  }

  post<T>(pathname: string, body: unknown): Promise<T> {
    return this.call<T>('POST', pathname, body);
  }
}
