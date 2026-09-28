import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { useFakeApi } from '@/coaching/testing/fake-api';

import { DeleteAccount } from './delete-account';

jest.mock('@/auth/me', () => ({ useMe: () => ({ data: { athlete: { id: 'a' }, coach: null } }) }));
jest.mock('@/auth/sign-out', () => ({ signOutNow: jest.fn(async () => {}) }));
const mockSignOut = jest.requireMock('@/auth/sign-out').signOutNow as jest.Mock;
const fakeApi = useFakeApi; // not a React hook, despite its name

test('deleting needs the word, then signs out', async () => {
  const calls = fakeApi({ 'POST /api/v1/me/delete': () => ({ status: 204 }) });
  await render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } })}>
      <DeleteAccount />
    </QueryClientProvider>,
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Delete my account' }));
  expect(screen.getByText(/Everything you've recorded is deleted/)).toBeTruthy();
  const confirmButton = screen.getAllByRole('button', { name: 'Delete my account' }).at(-1)!;
  expect(confirmButton.props.accessibilityState).toMatchObject({ disabled: true });
  await fireEvent.changeText(screen.getByLabelText('Type DELETE to confirm'), 'delete');
  await fireEvent.press(screen.getAllByRole('button', { name: 'Delete my account' }).at(-1)!);
  await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
  expect((calls[0].init as { body: unknown }).body).toEqual({ confirm: 'delete' });
});
