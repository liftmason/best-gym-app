import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { useFakeApi } from '@/coaching/testing/fake-api';
import { api } from '@/api';

import { ReportBugIcon } from './report-bug';

jest.mock('expo-router', () => ({ usePathname: () => '/home' }));
const fakeApi = useFakeApi; // not a React hook, despite its name

test('a report says where it came from, and thanks you', async () => {
  const calls = fakeApi({ 'POST /api/v1/bug-reports': () => ({ status: 201 }) });
  await render(<ReportBugIcon side="athlete" />);
  await fireEvent.press(screen.getByRole('button', { name: 'Report a bug' }));
  expect(screen.getByRole('button', { name: 'Send' }).props.accessibilityState).toMatchObject({ disabled: true });
  await fireEvent.changeText(screen.getByLabelText('What went wrong?'), 'The timer froze');
  await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
  expect(await screen.findByText(/it's been sent/)).toBeTruthy();
  const body = (calls[0].init as { body: { description: string; side: string; page: string; screen: string } }).body;
  expect(body).toMatchObject({ description: 'The timer froze', side: 'athlete' });
  expect(body.page).toMatch(/^\/home \(ios[^)]*\)$/); // the screen, then the device (and app version on a real build)
  expect(body.screen).toMatch(/^\d+x\d+$/);
});

test('offline, it says so', async () => {
  jest.spyOn(api.client, 'POST').mockRejectedValue(new TypeError('Network request failed'));
  await render(<ReportBugIcon side="coach" />);
  await fireEvent.press(screen.getByRole('button', { name: 'Report a bug' }));
  await fireEvent.changeText(screen.getByLabelText('What went wrong?'), 'Board is blank');
  await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(screen.getByText("You're offline. Try again when you have a connection.")).toBeTruthy());
});
