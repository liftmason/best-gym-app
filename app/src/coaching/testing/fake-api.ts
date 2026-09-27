/**
 * For screen tests: an openapi-fetch-like client that answers each "METHOD path" from a table,
 * with bodies typed by the generated schema (so a test can't send what the API wouldn't),
 * and records every call.
 */
import type { paths } from '@/api/schema';

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
type Json<P extends keyof paths, M extends Method> = paths[P][M] extends { responses: infer R }
  ? R extends Record<number, { content: { 'application/json': infer B } }>
    ? B
    : never
  : never;

export type Route = `${Uppercase<Method>} ${keyof paths & string}`;
export type Answer = { status?: number; body?: unknown };
export type Handler = (init: { params?: { path?: Record<string, string>; query?: Record<string, unknown> }; body?: unknown }) => Answer | Promise<Answer>;

/** A 200 answer with a body as the schema types it. */
export function body<P extends keyof paths, M extends Method>(_path: P, _method: M, value: Json<P, M>): Answer {
  return { status: 200, body: value };
}

export function fakeClient(routes: Partial<Record<Route, Handler>>) {
  const calls: { route: Route; init: unknown }[] = [];
  const call = (method: string) => async (path: string, init: Parameters<Handler>[0] = {}) => {
    const route = `${method} ${path}` as Route;
    calls.push({ route, init });
    const handler = routes[route];
    const answer: Answer = handler ? await handler(init) : { status: 404, body: { error: { code: 'not_found', message: 'Not found.', fields: {} } } };
    const status = answer.status ?? 200;
    const response = new Response(null, { status: status === 204 ? 204 : status });
    return status >= 400 ? { error: answer.body, response } : { data: answer.body, response };
  };
  return {
    client: { GET: call('GET'), POST: call('POST'), PUT: call('PUT'), PATCH: call('PATCH'), DELETE: call('DELETE') },
    calls,
  };
}

/** Points the app's API client (`api.client`) at a fake for the test; returns its calls. */
export function useFakeApi(routes: Partial<Record<Route, Handler>>) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { api } = require('@/api') as typeof import('@/api');
  const fake = fakeClient(routes);
  for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const) {
    jest.spyOn(api.client, method).mockImplementation(fake.client[method] as never);
  }
  return fake.calls;
}
