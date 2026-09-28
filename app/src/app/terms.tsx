import { LegalPage } from '@/legal/page';
import { TERMS } from '@/legal/texts';

export default function Terms() {
  return <LegalPage title="Terms of use" sections={TERMS} />;
}
