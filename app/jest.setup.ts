// jest-expo's mock of expo-crypto returns zeros; ids (src/domain/ids.ts) need real randomness,
// or two made in the same (frozen) millisecond are the same id.
jest.mock('expo-crypto', () => ({
  ...jest.requireActual('expo-crypto'),
  getRandomValues: <T extends ArrayBufferView>(bytes: T): T => require('node:crypto').webcrypto.getRandomValues(bytes),
}));

// expo-video's native player class doesn't exist under Jest: a stand-in view any screen can show.
jest.mock('expo-video', () => {
  const { createElement } = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  return { useVideoPlayer: () => ({}), VideoView: () => createElement(View, { accessibilityLabel: 'Video player' }) };
});
