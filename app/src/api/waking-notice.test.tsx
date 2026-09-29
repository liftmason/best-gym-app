import { render, screen } from '@testing-library/react-native';

import { WakingNotice } from './waking-notice';

let mockWaking = false;
jest.mock('./index', () => ({ useWaking: () => mockWaking }));

test('says the server is starting only while a request waits for it', async () => {
  const view = await render(<WakingNotice />);
  expect(screen.queryByText(/Starting up/)).toBeNull();
  mockWaking = true;
  await view.rerender(<WakingNotice />);
  expect(screen.getByText('Starting up. This can take a minute…')).toBeTruthy();
});
