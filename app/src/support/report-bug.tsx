/**
 * "Report a bug" (the old site's button, back): a few words about what went wrong, sent with
 * where it happened, the screen size, and the device and app version. Reports land in the
 * admin under Dashboard → Bug reports (docs/OPERATIONS.md). It needs a connection.
 */
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { usePathname } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, useWindowDimensions } from 'react-native';

import { api, ApiError, ok } from '@/api';
import { Button, colors, Field, Sheet, Text } from '@/ui';

type Side = 'coach' | 'athlete';

export function ReportBugSheet({ open, onClose, side }: { open: boolean; onClose: () => void; side: Side }) {
  const page = usePathname();
  const { width, height } = useWindowDimensions();
  const [description, setDescription] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const close = () => {
    setDescription('');
    setProblem(null);
    setSent(false);
    onClose();
  };

  async function send() {
    setBusy(true);
    setProblem(null);
    const app = Constants.expoConfig?.version;
    const device = [`${Platform.OS}${Platform.Version ? ` ${Platform.Version}` : ''}`, app ? `app ${app}` : ''].filter(Boolean).join(', ');
    try {
      await ok(
        api.client.POST('/api/v1/bug-reports', {
          body: { description, side, page: `${page} (${device})`, screen: `${Math.round(width)}x${Math.round(height)}` },
        }),
      );
      setSent(true);
    } catch (error) {
      setProblem(
        error instanceof ApiError
          ? error.offline
            ? "You're offline. Try again when you have a connection."
            : (error.fields.description ?? error.message)
          : 'Something went wrong. Try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={close}
      title="Report a bug"
      footer={
        sent ? (
          <Button size="sm" title="Done" onPress={close} />
        ) : (
          <>
            <Button size="sm" variant="ghost" title="Cancel" onPress={close} />
            <Button size="sm" title="Send" busy={busy} disabled={!description.trim()} onPress={send} />
          </>
        )
      }
    >
      {sent ? (
        <Text>Thanks, it&apos;s been sent. We read every report.</Text>
      ) : (
        <>
          <Field
            label="What went wrong?"
            value={description}
            onChangeText={setDescription}
            multiline
            maxLength={4000}
            placeholder="What you were doing, what you expected, and what happened instead."
            style={{ minHeight: 110, textAlignVertical: 'top' }}
            error={problem}
          />
          <Text variant="tiny" tone="muted">
            The screen you&apos;re on and your device type are sent with it.
          </Text>
        </>
      )}
    </Sheet>
  );
}

/** A round bug icon (the athlete's header) that opens the sheet. */
export function ReportBugIcon({ side }: { side: Side }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Report a bug"
        onPress={() => setOpen(true)}
        hitSlop={8}
        style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface2 }}
      >
        <Ionicons name="bug-outline" size={19} color={colors.ink2} />
      </Pressable>
      {open ? <ReportBugSheet open onClose={() => setOpen(false)} side={side} /> : null}
    </>
  );
}

/** A plain link-style button that opens the sheet (the coach's sidebar and Account). */
export function ReportBugLink({ side, block }: { side: Side; block?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {block ? (
        <Button title="Report a bug" variant="ghost" block onPress={() => setOpen(true)} />
      ) : (
        <Pressable accessibilityRole="button" onPress={() => setOpen(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8 }}>
          <Ionicons name="bug-outline" size={16} color={colors.ink3} />
          <Text variant="small" tone="muted">
            Report a bug
          </Text>
        </Pressable>
      )}
      {open ? <ReportBugSheet open onClose={() => setOpen(false)} side={side} /> : null}
    </>
  );
}
