import { Stack } from 'expo-router';

/** The app's root: signing in, the athlete's training (offline-first) and coaching (online). */
export default function RootLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(training)" />
      <Stack.Screen name="(coaching)" />
    </Stack>
  );
}
