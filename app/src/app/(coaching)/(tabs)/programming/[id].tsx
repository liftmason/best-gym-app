import { useLocalSearchParams } from 'expo-router';

import { useMe } from '@/auth/me';
import { CoachScreen, Loading } from '@/coaching/layout';
import { TemplateEditor } from '@/coaching/library/editor';
import { useTemplate } from '@/coaching/library/queries';

const UNTITLED = { program: 'Untitled template', week: 'Untitled week', session: 'Untitled session' } as Record<string, string>;
const CRUMB = { program: 'Template', week: 'Saved week', session: 'Saved session' } as Record<string, string>;

/** A template, saved week or saved session in the editor. */
export default function TemplateScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const template = useTemplate(id);
  const entitlements = useMe().data?.coach?.entitlements;
  const t = template.data;
  return (
    <CoachScreen title={t ? t.name || UNTITLED[t.kind] : 'Template'} subtitle={t ? CRUMB[t.kind] : undefined}>
      {t ? <TemplateEditor id={id} readOnly={entitlements ? !entitlements.programming : false} /> : <Loading error={template.error} retry={() => template.refetch()} />}
    </CoachScreen>
  );
}
