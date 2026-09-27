import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { InviteSheet, PendingInvites } from '@/coaching/invite';
import { CoachScreen } from '@/coaching/layout';
import { Roster } from '@/coaching/roster';
import { Button } from '@/ui';

/** The roster (the mockup's #panel-clients), and inviting athletes. */
export default function Athletes() {
  const { invite } = useLocalSearchParams<{ invite?: string }>();
  const [inviting, setInviting] = useState(invite === '1');
  return (
    <CoachScreen title="Athletes" actions={<Button title="+ Invite athlete" size="sm" onPress={() => setInviting(true)} />}>
      <Roster title={false} />
      <PendingInvites />
      <InviteSheet
        open={inviting}
        onClose={() => {
          setInviting(false);
          if (invite) router.setParams({ invite: undefined });
        }}
      />
    </CoachScreen>
  );
}
