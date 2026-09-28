import { LegalPage } from '@/legal/page';
import { PRIVACY } from '@/legal/texts';

export default function Privacy() {
  return <LegalPage title="Privacy policy" sections={PRIVACY} />;
}
