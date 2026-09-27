import { router } from 'expo-router';

import { EmailCode } from '@/auth/email-code';
import { SignInFrame } from '@/auth/frame';
import { signUp } from '@/auth/pending';
import { Text } from '@/ui';

/** Sign in with an email code. A new email goes on to set up a gym as a new coach. */
export default function SignIn() {
  return (
    <SignInFrame>
      <Text variant="h2">Sign in</Text>
      <Text variant="small" tone="muted">
        No password: we&apos;ll email you a code.
      </Text>
      <EmailCode
        onTicket={(ticket, email) => {
          signUp.set(ticket, email);
          router.push('/new-coach');
        }}
      />
      <Text variant="tiny" tone="faint">
        Joining a coach? Open the invite link they sent you.
      </Text>
    </SignInFrame>
  );
}
