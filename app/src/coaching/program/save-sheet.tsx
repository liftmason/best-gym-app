/** Saving part of the board to the library: a week, a session or the whole program (the old _save_modal.html). */
import { useState } from 'react';

import { Button, Field, Sheet, Text } from '@/ui';

export type SaveWhat = { kind: 'week' | 'session' | 'program'; save: (name: string, description: string) => Promise<unknown> };

const TITLES = { week: 'Save week to library', session: 'Save session to library', program: 'Save as a program template' };

export function SaveSheet({ what, onClose }: { what: SaveWhat | null; onClose: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const close = () => {
    setName('');
    setDescription('');
    onClose();
  };

  async function save() {
    if (!what) return;
    setBusy(true);
    const saved = await what.save(name.trim(), description.trim());
    setBusy(false);
    if (saved !== undefined) close();
  }

  return (
    <Sheet
      open={Boolean(what)}
      onClose={close}
      title={what ? TITLES[what.kind] : ''}
      footer={
        <>
          <Button size="sm" variant="ghost" title="Cancel" onPress={close} />
          <Button size="sm" title={what?.kind === 'program' ? 'Save template' : what?.kind === 'session' ? 'Save session' : 'Save week'} busy={busy} onPress={save} />
        </>
      }
    >
      <Field label="Name" value={name} onChangeText={setName} placeholder="Leave empty for a suggested name" maxLength={80} onSubmitEditing={save} />
      <Field label="Description (optional)" value={description} onChangeText={setDescription} placeholder="What this is for" maxLength={300} />
      <Text variant="tiny" tone="muted">
        Library items are copies. Editing one later does not change templates or programs that already use it.
      </Text>
    </Sheet>
  );
}
