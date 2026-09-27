import { fireEvent, render, screen } from '@testing-library/react-native';

import { api } from '@/api';

import { EmailCode } from './email-code';

jest.mock('expo-secure-store', () => {
  const saved = new Map<string, string>();
  return {
    getItemAsync: async (key: string) => saved.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => void saved.set(key, value),
    deleteItemAsync: async (key: string) => void saved.delete(key),
  };
});

/** The backend's answers by path; records what was sent. */
function backend(verify: { status: number; body: unknown }) {
  const sent: { path: string; body: unknown }[] = [];
  globalThis.fetch = jest.fn(async (request: Request) => {
    const path = new URL(request.url).pathname;
    sent.push({ path, body: await request.json() });
    if (path.endsWith('/email/start')) return new Response(null, { status: 202 });
    return new Response(JSON.stringify(verify.body), {
      status: verify.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  return sent;
}

async function enterEmailAndCode(code = '123456') {
  await fireEvent.changeText(screen.getByLabelText('Email'), ' dana@example.com ');
  await fireEvent.press(screen.getByRole('button', { name: 'Email me a code' }));
  await fireEvent.changeText(await screen.findByLabelText('Code'), code);
  await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
}

afterEach(() => api.signOut());

test('a known email signs in and keeps the tokens', async () => {
  const sent = backend({ status: 200, body: { signed_in: true, tokens: { access: 'a', refresh: 'r' }, ticket: null } });
  const signedIn = jest.fn();
  await render(<EmailCode onSignedIn={signedIn} onTicket={jest.fn()} />);
  await enterEmailAndCode();
  expect(sent[0]).toEqual({ path: '/api/v1/auth/email/start', body: { email: 'dana@example.com' } });
  expect(sent[1].body).toMatchObject({ email: 'dana@example.com', code: '123456' });
  expect(signedIn).toHaveBeenCalled();
  expect(api.state).toBe('signedIn');
});

test('a new email comes back with a sign-up ticket', async () => {
  backend({ status: 200, body: { signed_in: false, tokens: null, ticket: 't-1' } });
  const onTicket = jest.fn();
  await render(<EmailCode onTicket={onTicket} />);
  await enterEmailAndCode();
  expect(onTicket).toHaveBeenCalledWith('t-1', 'dana@example.com');
  expect(api.state).not.toBe('signedIn');
});

test("a wrong code shows the API's message", async () => {
  backend({ status: 400, body: { error: { code: 'wrong_code', message: "That code isn't right.", fields: {} } } });
  await render(<EmailCode onTicket={jest.fn()} />);
  await enterEmailAndCode();
  expect(await screen.findByRole('alert')).toHaveTextContent("That code isn't right.");
});

test('only digits go in the code, up to six', async () => {
  backend({ status: 200, body: {} });
  await render(<EmailCode onTicket={jest.fn()} />);
  await fireEvent.changeText(screen.getByLabelText('Email'), 'dana@example.com');
  await fireEvent.press(screen.getByRole('button', { name: 'Email me a code' }));
  await fireEvent.changeText(await screen.findByLabelText('Code'), '12 34-5678');
  expect(screen.getByLabelText('Code')).toHaveDisplayValue('123456');
});
