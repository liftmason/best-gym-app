/** Inviting an athlete (the old invite modal): by email, or a link to share; with a starting template. */
import { useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Pressable, Share, StyleSheet, View } from 'react-native';

import { api, ApiError, ok, type components } from '@/api';
import { dayMonth } from '@/training/format';
import { Button, colors, Field, fonts, radius, Sheet, space, Text } from '@/ui';

import { useInvites, useInviteTemplates } from './queries';
import { APP_NAME } from '@/name';

type Created = components['schemas']['InviteCreated'];

async function share(link: string) {
  try {
    await Share.share({ message: `Join me on ${APP_NAME}: ${link}` });
  } catch {
    await Clipboard.setStringAsync(link);
  }
}

export function InviteSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const templates = useInviteTemplates();
  const [email, setEmail] = useState('');
  const [template, setTemplate] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  function reset() {
    setEmail('');
    setTemplate(null);
    setCreated(null);
    setProblem(null);
    setCopied(false);
  }

  async function create() {
    setBusy(true);
    setProblem(null);
    try {
      const invite = await ok(api.client.POST('/api/v1/invites', { body: { email: email.trim(), starting_template_id: template } }));
      setCreated(invite);
      await queryClient.invalidateQueries({ queryKey: ['coach', 'invites'] });
    } catch (error) {
      setProblem(error instanceof ApiError ? (Object.values(error.fields)[0] ?? error.message) : "Couldn't create the invite.");
    } finally {
      setBusy(false);
    }
  }

  const close = () => {
    reset();
    onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={close}
      title="Invite an athlete"
      footer={
        created ? (
          <View style={styles.foot}>
            <Button title="Invite another" variant="ghost" onPress={reset} />
            <Button title="Done" onPress={close} />
          </View>
        ) : (
          <View style={styles.foot}>
            <Button title="Cancel" variant="ghost" onPress={close} />
            <Button title="Create invite" busy={busy} onPress={create} />
          </View>
        )
      }
    >
      {created ? (
        <View style={{ gap: space.m }}>
          <Text variant="small" tone="muted">
            {created.email && created.email_sent
              ? `We emailed ${created.email} a link. You can also share it yourself:`
              : created.email
                ? `The email to ${created.email} didn't go — share the link yourself, or resend it later.`
                : `Share this link with your athlete. It works once and expires ${dayMonth(created.expires_at.slice(0, 10))}.`}
          </Text>
          <Text selectable style={styles.link}>
            {created.link}
          </Text>
          <View style={styles.foot}>
            <Button
              title={copied ? 'Copied' : 'Copy'}
              variant="ghost"
              onPress={async () => {
                await Clipboard.setStringAsync(created.link);
                setCopied(true);
              }}
            />
            <Button title="Share…" variant="soft" onPress={() => share(created.link)} />
          </View>
        </View>
      ) : (
        <View style={{ gap: space.m }}>
          <Text variant="small" tone="muted">
            They&apos;ll get a link to create an account, enter their metrics (skippable), and land on the week you assign.
          </Text>
          <Field label="Athlete email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" error={problem} />
          <Text variant="tiny" tone="muted">
            Leave the email blank to just get a link you can text them.
          </Text>
          <Text variant="label" tone="muted">
            Starting program
          </Text>
          {[{ id: null, name: 'None — build from scratch' }, ...(templates.data ?? [])].map((t) => (
            <Pressable
              key={t.id ?? 'none'}
              accessibilityRole="radio"
              accessibilityState={{ checked: template === t.id }}
              onPress={() => setTemplate(t.id)}
              style={[styles.choice, template === t.id && styles.choiceOn]}
            >
              <Text variant="small" style={{ fontFamily: fonts.semibold }}>
                {t.name}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </Sheet>
  );
}

/** Invites not used yet: resend (with an email), share, or revoke. */
export function PendingInvites() {
  const invites = useInvites();
  const queryClient = useQueryClient();
  const [problem, setProblem] = useState<string | null>(null);
  if (!invites.data?.length) return null;
  const act = async (call: () => Promise<unknown>) => {
    setProblem(null);
    try {
      await call();
      await queryClient.invalidateQueries({ queryKey: ['coach', 'invites'] });
    } catch (error) {
      setProblem(error instanceof ApiError ? error.message : "Couldn't do that.");
    }
  };
  return (
    <View style={{ gap: space.s }}>
      <Text variant="h4">Invites not used yet</Text>
      {invites.data.map((i) => (
        <View key={i.id} style={styles.invite}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="small" style={{ fontFamily: fonts.semibold }} numberOfLines={1}>
              {i.email || 'Link only'}
            </Text>
            <Text variant="tiny" tone="muted">
              Expires {dayMonth(i.expires_at.slice(0, 10))}
              {i.starting_template ? ` · starts on ${i.starting_template}` : ''}
            </Text>
          </View>
          {i.email ? (
            <Button title="Resend" size="sm" variant="ghost" onPress={() => act(() => ok(api.client.POST('/api/v1/invites/{invite_id}/resend', { params: { path: { invite_id: i.id } } })))} />
          ) : (
            <Button title="Share" size="sm" variant="ghost" onPress={() => share(i.link)} />
          )}
          <Button title="Revoke" size="sm" variant="danger" onPress={() => act(() => ok(api.client.POST('/api/v1/invites/{invite_id}/revoke', { params: { path: { invite_id: i.id } } })))} />
        </View>
      ))}
      {problem ? (
        <Text variant="tiny" tone="bad">
          {problem}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  foot: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.s },
  link: { fontFamily: fonts.medium, fontSize: 13, backgroundColor: colors.surface2, borderRadius: radius.m, padding: space.m },
  choice: { borderWidth: 1.5, borderColor: colors.line, borderRadius: radius.m, padding: 12 },
  choiceOn: { borderColor: colors.brand, backgroundColor: colors.brandLight },
  invite: { flexDirection: 'row', alignItems: 'center', gap: space.s, paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.line2 },
});
