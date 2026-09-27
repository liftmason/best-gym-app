// jest-expo's mock of expo-crypto returns zeros; ids (src/domain/ids.ts) need real randomness,
// or two made in the same (frozen) millisecond are the same id.
jest.mock('expo-crypto', () => ({
  ...jest.requireActual('expo-crypto'),
  getRandomValues: <T extends ArrayBufferView>(bytes: T): T => require('node:crypto').webcrypto.getRandomValues(bytes),
}));
