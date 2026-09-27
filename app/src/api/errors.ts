/**
 * The API's errors (`{"error": {"code", "message", "fields"}}`, see backend apps/core/errors.py)
 * as one exception for screens to show. No connection is status 0, code "offline".
 */
import { APP_NAME } from '@/name';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get offline(): boolean {
    return this.status === 0;
  }

  static offline(): ApiError {
    return new ApiError(0, 'offline', `Can't reach ${APP_NAME}. Check your connection.`);
  }

  /** From an error body, or a status alone when the body isn't the API's shape. */
  static from(status: number, body: unknown): ApiError {
    const error = (body as { error?: { code?: unknown; message?: unknown; fields?: unknown } } | null)?.error;
    if (error && typeof error.code === 'string') {
      const fields = error.fields && typeof error.fields === 'object' ? (error.fields as Record<string, string>) : {};
      return new ApiError(status, error.code, typeof error.message === 'string' ? error.message : '', fields);
    }
    return new ApiError(status, `http_${status}`, 'Something went wrong. Try again.');
  }
}

/** openapi-fetch's answer, or an ApiError: `const me = await ok(api.GET('/api/v1/me'))`. */
export async function ok<T>(call: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
  let result;
  try {
    result = await call;
  } catch (e) {
    throw e instanceof ApiError ? e : ApiError.offline();
  }
  if (!result.response.ok) throw ApiError.from(result.response.status, result.error);
  return result.data as T;
}
