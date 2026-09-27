const mockUnsent = jest.fn();
const mockForget = jest.fn();
const mockConfirm = jest.fn();
const mockApiSignOut = jest.fn();

jest.mock('@/sync/session', () => ({ unsentActions: () => mockUnsent(), forgetDevice: () => mockForget() }));
jest.mock('@/ui/confirm', () => ({ confirm: (...args: unknown[]) => mockConfirm(...args) }));
jest.mock('@/api', () => ({ api: { signOut: () => mockApiSignOut() } }));
jest.mock('./mode', () => ({ rememberAthlete: async () => {} }));

// eslint-disable-next-line import/first
import { signOut } from './sign-out';

beforeEach(() => {
  jest.clearAllMocks();
  mockForget.mockResolvedValue(undefined);
});

test('nothing waiting: signs out and clears the device without asking', async () => {
  mockUnsent.mockResolvedValue(0);
  await signOut();
  expect(mockConfirm).not.toHaveBeenCalled();
  expect(mockForget).toHaveBeenCalled();
  expect(mockApiSignOut).toHaveBeenCalled();
});

test('changes not yet sent: asks first, and stays signed in on cancel', async () => {
  mockUnsent.mockResolvedValue(2);
  mockConfirm.mockResolvedValue(false);
  await signOut();
  expect(mockConfirm).toHaveBeenCalledWith('2 changes not sent yet', expect.stringContaining('loses 2 changes'), 'Sign out anyway');
  expect(mockForget).not.toHaveBeenCalled();
  expect(mockApiSignOut).not.toHaveBeenCalled();
  mockConfirm.mockResolvedValue(true);
  await signOut();
  expect(mockApiSignOut).toHaveBeenCalled();
});
