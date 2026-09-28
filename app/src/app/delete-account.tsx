/**
 * Deleting an account on the web (the page Google Play links to): sign in with a code, then
 * the same steps as in the app. Open whether signed in or not, like invite links.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { useAuth } from '@/api';
import { DeleteAccount } from '@/auth/delete-account';
import { EmailCode } from '@/auth/email-code';
import { SignInFrame } from '@/auth/frame';
import { ME } from '@/auth/me';
import { Text } from '@/ui';
import { APP_NAME } from '@/name';

export default function DeleteAccountPage() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [noAccount, setNoAccount] = useState(false);
  return (
    <SignInFrame>
      <Text variant="h2">Delete your {APP_NAME} account</Text>
      {auth === 'signedIn' ? (
        <DeleteAccount />
      ) : (
        <>
          <Text variant="small" tone="muted">
            Sign in with the email you use for {APP_NAME}, and you&apos;ll see what deleting removes before anything happens.
          </Text>
          <EmailCode onSignedIn={() => queryClient.invalidateQueries({ queryKey: ME })} onTicket={() => setNoAccount(true)} />
          {noAccount ? (
            <Text variant="small" tone="bad">
              There&apos;s no account with that email, so there&apos;s nothing to delete.
            </Text>
          ) : null}
        </>
      )}
    </SignInFrame>
  );
}
