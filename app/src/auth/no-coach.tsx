/** Signed in with neither profile: no coach to train with, and not coaching yet. */
import { router } from 'expo-router';

import { SignInFrame } from '@/auth/frame';
import { signOut } from '@/auth/sign-out';
import { Button, Text } from '@/ui';

export function NoCoachYet({ email }: { email: string }) {
  return (
    <SignInFrame>
      <Text variant="h2">No coach yet</Text>
      <Text variant="small" tone="muted">
        Signed in as {email}. To train with a coach, open the invite link they sent you. To coach, set up your gym.
      </Text>
      <Button title="Start coaching" onPress={() => router.push('/start-coaching')} />
      <Button title="Sign out" variant="ghost" onPress={signOut} />
    </SignInFrame>
  );
}
