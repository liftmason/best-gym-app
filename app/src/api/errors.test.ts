import { ApiError, ok } from './errors';

test("an answer the app can't read is 'something went wrong', not 'no connection'", async () => {
  // Render's edge once sent an empty answer marked one byte long; parsing it threw, and the
  // app told people to check their connection while the server was fine.
  const error: ApiError = await ok(Promise.reject(new SyntaxError('Unexpected end of JSON input'))).catch((e) => e);
  expect(error).toBeInstanceOf(ApiError);
  expect(error.offline).toBe(false);
  expect(error.message).toBe('Something went wrong. Try again.');
});

test('no connection is still an offline error', async () => {
  const error: ApiError = await ok(Promise.reject(ApiError.offline())).catch((e) => e);
  expect(error.offline).toBe(true);
});
