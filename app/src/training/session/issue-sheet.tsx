/** Report an issue or pain (the mockup's #issueModal): sent with issue.report, offline too. */
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { uuid7 } from '@/domain/ids';
import { ISSUE_KINDS, issueReport, Refused } from '@/sync/actions';
import type { SyncEngine } from '@/sync/engine';
import { Button, colors, Field, fonts, radius, Sheet, space, Text } from '@/ui';

export function IssueSheet({
  open,
  onClose,
  logId,
  coach,
  engine,
}: {
  open: boolean;
  onClose: () => void;
  logId: string;
  coach: string;
  engine: SyncEngine;
}) {
  const [kind, setKind] = useState<string>('pain');
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  async function send() {
    setProblem(null);
    try {
      await engine.enqueue(issueReport, { issue_id: uuid7(), session_log_id: logId, kind, text });
      setText('');
      onClose();
    } catch (error) {
      setProblem(error instanceof Refused ? error.message : "Couldn't send that. Try again.");
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Report an issue"
      footer={
        <View style={styles.foot}>
          <Button title="Cancel" variant="ghost" onPress={onClose} />
          <Button title={`Send to ${coach}`} variant="danger" onPress={send} />
        </View>
      }
    >
      <Text variant="label" tone="muted">
        What kind of issue?
      </Text>
      <View style={styles.kinds}>
        {Object.entries(ISSUE_KINDS).map(([value, label]) => (
          <Pressable
            key={value}
            accessibilityRole="radio"
            accessibilityState={{ checked: kind === value }}
            onPress={() => setKind(value)}
            style={[styles.kind, kind === value && styles.kindOn]}
          >
            <Text style={[styles.kindText, kind === value && { color: colors.bad }]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <Field
        label="Where / what?"
        value={text}
        onChangeText={setText}
        multiline
        maxLength={2000}
        placeholder="e.g. sharp pinch in left wrist at jerk lockout, ~120kg"
        error={problem}
      />
      <Text variant="tiny" tone="muted">
        {coach} is notified on the dashboard straight away.
      </Text>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  foot: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.s },
  kinds: { gap: 6, marginBottom: space.m },
  kind: { borderWidth: 1.5, borderColor: colors.line, borderRadius: radius.m, paddingVertical: 11, paddingHorizontal: 12 },
  kindOn: { borderColor: colors.bad, backgroundColor: colors.badLight },
  kindText: { fontFamily: fonts.semibold, fontSize: 13.5 },
});
