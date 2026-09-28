/**
 * "Delete my account" (the stores require it; docs/plans/S8_LAUNCH.md, decisions A and B):
 * what goes, typing DELETE, then signing out. In the athlete's Profile, the coach's Account,
 * and at /delete-account on the web (the page Google Play links to).
 */
import { useState } from 'react';
import { View } from 'react-native';

import { api, ApiError, ok } from '@/api';
import { useMe } from '@/auth/me';
import { signOutNow } from '@/auth/sign-out';
import { Button, Card, Field, space, Text } from '@/ui';

export function DeleteAccount() {
  const me = useMe();
  const [open, setOpen] = useState(false);
  const [word, setWord] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const athlete = Boolean(me.data?.athlete);
  const coach = Boolean(me.data?.coach);

  async function remove() {
    setBusy(true);
    setProblem(null);
    try {
      await ok(api.client.POST('/api/v1/me/delete', { body: { confirm: word } }));
      await signOutNow();
    } catch (error) {
      setProblem(error instanceof ApiError ? (error.fields.confirm ?? error.message) : 'Something went wrong. Try again.');
      setBusy(false);
    }
  }

  if (!open) return <Button title="Delete my account" variant="danger" block onPress={() => setOpen(true)} />;
  return (
    <Card style={{ gap: space.m }}>
      <Text variant="h4">Delete your account?</Text>
      {athlete ? (
        <Text variant="small">
          Everything you&apos;ve recorded is deleted: sessions and sets, check-ins, form videos, messages, maxes, bodyweight and habits. Your coach is told you&apos;ve left.
        </Text>
      ) : null}
      {coach ? (
        <Text variant="small">
          Your name and email are removed and you can&apos;t sign in again. Your athletes lose you as their coach but keep their own training history, and messages you sent stay in their conversations, shown as from a former coach. If you&apos;re your gym&apos;s last coach, its templates and settings are deleted and any subscription is cancelled.
        </Text>
      ) : null}
      <Text variant="small" tone="bad">
        This can&apos;t be undone.
      </Text>
      <Field label="Type DELETE to confirm" value={word} onChangeText={setWord} autoCapitalize="characters" error={problem} />
      <View style={{ flexDirection: 'row', gap: space.s }}>
        <Button title="Cancel" variant="ghost" onPress={() => (setOpen(false), setWord(''), setProblem(null))} />
        <Button title="Delete my account" variant="danger" busy={busy} disabled={word.trim().toUpperCase() !== 'DELETE'} onPress={remove} />
      </View>
    </Card>
  );
}
