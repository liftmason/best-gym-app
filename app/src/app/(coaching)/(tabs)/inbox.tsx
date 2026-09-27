import { CoachScreen } from '@/coaching/layout';
import { Text } from '@/ui';

/** Built in the next steps of S6. */
export default function Screen() {
  return (
    <CoachScreen title="Coming next">
      <Text tone="muted">This screen is built in the next step.</Text>
    </CoachScreen>
  );
}
