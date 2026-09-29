/**
 * Check-in questions (the old _question_builder.html): the gym's defaults under Programming,
 * and each athlete's own copy on their Metrics tab. 1–10 scales (with their end labels and
 * an optional "also ask"), multiple choice (2 to 12 options) and short answers.
 */
import { Feather } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { api, ok } from '@/api';
import { Button, Card, Chip, colors, fonts, Text, useToast } from '@/ui';
import { confirm } from '@/ui/confirm';

import { useChange } from '../change';
import { libraryKeys, useQuestions, type Question } from './queries';

const TYPES: Record<string, string> = { scale: '1–10 scale', choice: 'multiple choice', text: 'short answer' };

type Wording = { text?: string; low_label?: string; high_label?: string; detail_label?: string };

/** The same editor for the defaults (no athlete) and one athlete's copy. */
function useQuestionCalls(athlete: string | null) {
  const a = athlete ? { athlete_id: athlete } : null;
  return {
    add: (type: string) =>
      a ? ok(api.client.POST('/api/v1/athletes/{athlete_id}/questions', { params: { path: a }, body: { type } })) : ok(api.client.POST('/api/v1/default-questions', { body: { type } })),
    word: (id: string, body: Wording) =>
      a
        ? ok(api.client.PATCH('/api/v1/athletes/{athlete_id}/questions/{question_id}', { params: { path: { ...a, question_id: id } }, body }))
        : ok(api.client.PATCH('/api/v1/default-questions/{default_question_id}', { params: { path: { default_question_id: id } }, body })),
    remove: (id: string) =>
      a
        ? ok(api.client.POST('/api/v1/athletes/{athlete_id}/questions/{question_id}/archive', { params: { path: { ...a, question_id: id } } }))
        : ok(api.client.POST('/api/v1/default-questions/{default_question_id}/archive', { params: { path: { default_question_id: id } } })),
    move: (id: string, direction: 'up' | 'down') =>
      a
        ? ok(api.client.POST('/api/v1/athletes/{athlete_id}/questions/{question_id}/move', { params: { path: { ...a, question_id: id } }, body: { direction } }))
        : ok(api.client.POST('/api/v1/default-questions/{default_question_id}/move', { params: { path: { default_question_id: id } }, body: { direction } })),
    addOption: (id: string, option: string) =>
      a
        ? ok(api.client.POST('/api/v1/athletes/{athlete_id}/questions/{question_id}/options', { params: { path: { ...a, question_id: id } }, body: { option } }))
        : ok(api.client.POST('/api/v1/default-questions/{default_question_id}/options', { params: { path: { default_question_id: id } }, body: { option } })),
    removeOption: (id: string, index: number) =>
      a
        ? ok(api.client.DELETE('/api/v1/athletes/{athlete_id}/questions/{question_id}/options/{index}', { params: { path: { ...a, question_id: id, index } } }))
        : ok(api.client.DELETE('/api/v1/default-questions/{default_question_id}/options/{index}', { params: { path: { default_question_id: id, index } } })),
  };
}

export function QuestionsEditor({ athlete, first, readOnly = false }: { athlete: string | null; first?: string; readOnly?: boolean }) {
  const questions = useQuestions(athlete);
  const calls = useQuestionCalls(athlete);
  const change = useChange();
  const refresh = [libraryKeys.questions(athlete)];
  const updated = athlete ? `Updated. Live from ${first}'s next session` : 'Defaults updated. New athletes get these; push them to update existing athletes';

  async function push() {
    if (!(await confirm('Replace the check-in questions of all your athletes with these defaults?', 'Their past answers are kept.', 'Push defaults'))) return;
    await change(() => ok(api.client.POST('/api/v1/push-default-questions')), {
      said: (r) => `Default questions pushed to ${r.athletes} athlete${r.athletes === 1 ? '' : 's'}`,
      refresh: [['coach', 'questions']],
    });
  }

  async function reset() {
    if (!athlete || !(await confirm(`Replace ${first}'s questions with your gym's defaults?`, 'Their past answers are kept.', 'Reset'))) return;
    await change(() => ok(api.client.POST('/api/v1/athletes/{athlete_id}/reset-questions', { params: { path: { athlete_id: athlete } } })), { said: 'Reset to the default questions', refresh });
  }

  const list = questions.data ?? [];
  return (
    <Card style={{ gap: 12 }}>
      <View style={styles.head}>
        <View style={{ flex: 1, minWidth: 240, gap: 4 }}>
          <Text variant="h4">{athlete ? `Check-in questions for ${first}` : 'Default check-in questions'}</Text>
          <Text variant="small" tone="muted">
            {athlete
              ? "This athlete's own copy. Changes are live from their next session. The defaults live under Programming › Check-in questions."
              : "The default pre-session check-in. Every athlete gets their own copy of these when they join, which you can adjust from their Metrics tab. Changing the defaults here doesn't touch existing athletes unless you push them."}
          </Text>
        </View>
        {athlete ? (
          <Button title="Reset to defaults" size="sm" variant="ghost" disabled={readOnly} onPress={reset} />
        ) : (
          <Button title="Push defaults to all my athletes" size="sm" variant="ghost" disabled={readOnly} onPress={push} />
        )}
      </View>
      {questions.data && !list.length ? (
        <Text variant="small" tone="muted">
          No questions. Athletes go straight into the session.
        </Text>
      ) : null}
      {list.map((q, i) => (
        <QuestionRow
          key={`${q.id}:${q.text}:${q.low_label}:${q.high_label}:${q.detail_label}`}
          question={q}
          first={i === 0}
          last={i === list.length - 1}
          readOnly={readOnly}
          onWord={(body) => change(() => calls.word(q.id, body), { said: updated, refresh })}
          onMove={(direction) => change(() => calls.move(q.id, direction), { refresh })}
          onRemove={async () => {
            if (await confirm('Remove this question?', 'Past answers keep it.', 'Remove')) change(() => calls.remove(q.id), { said: 'Question removed', refresh });
          }}
          onAddOption={(option) => change(() => calls.addOption(q.id, option), { said: updated, refresh })}
          onRemoveOption={(index) => change(() => calls.removeOption(q.id, index), { said: updated, refresh })}
        />
      ))}
      {!readOnly ? (
        <View style={styles.adds}>
          {Object.entries(TYPES).map(([type, label]) => (
            <Button key={type} size="sm" variant="soft" title={`+ ${label === '1–10 scale' ? '1–10 scale' : label} question`} onPress={() => change(() => calls.add(type), { said: 'Question added. Edit its wording below', refresh })} />
          ))}
        </View>
      ) : null}
    </Card>
  );
}

function QuestionRow({
  question: q,
  first,
  last,
  readOnly,
  onWord,
  onMove,
  onRemove,
  onAddOption,
  onRemoveOption,
}: {
  question: Question;
  first: boolean;
  last: boolean;
  readOnly: boolean;
  onWord: (body: Wording) => void;
  onMove: (direction: 'up' | 'down') => void;
  onRemove: () => void;
  onAddOption: (option: string) => void;
  onRemoveOption: (index: number) => void;
}) {
  const toast = useToast();
  const [text, setText] = useState(q.text);
  const [low, setLow] = useState(q.low_label);
  const [high, setHigh] = useState(q.high_label);
  const [detail, setDetail] = useState(q.detail_label);
  const [option, setOption] = useState('');
  const save = (field: keyof Wording, value: string, saved: string) => {
    if (value.trim() !== saved) onWord({ [field]: value.trim() });
  };
  function addOption() {
    if (!option.trim()) return toast('Type the option first', 'bad');
    onAddOption(option.trim());
    setOption('');
  }
  return (
    <View style={styles.question}>
      <View style={styles.qTop}>
        <Chip label={TYPES[q.type] ?? q.type} />
        <TextInput
          accessibilityLabel="Question wording"
          editable={!readOnly}
          value={text}
          onChangeText={setText}
          onBlur={() => save('text', text, q.text)}
          maxLength={200}
          style={[styles.input, { flex: 1, fontFamily: fonts.semibold }]}
        />
        <Pressable accessibilityRole="button" accessibilityLabel="Move question up" disabled={first || readOnly} onPress={() => onMove('up')}>
          <Feather name="arrow-up" size={15} color={first ? colors.line : colors.ink3} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Move question down" disabled={last || readOnly} onPress={() => onMove('down')}>
          <Feather name="arrow-down" size={15} color={last ? colors.line : colors.ink3} />
        </Pressable>
        {!readOnly ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Delete question" onPress={onRemove}>
            <Feather name="trash-2" size={15} color={colors.ink4} />
          </Pressable>
        ) : null}
      </View>
      {q.type === 'scale' ? (
        <View style={styles.wrap}>
          <Text variant="tiny" tone="muted">
            1 =
          </Text>
          <TextInput accessibilityLabel="Label for 1" editable={!readOnly} value={low} onChangeText={setLow} onBlur={() => save('low_label', low, q.low_label)} maxLength={60} style={[styles.input, styles.small]} />
          <Text variant="tiny" tone="muted">
            10 =
          </Text>
          <TextInput accessibilityLabel="Label for 10" editable={!readOnly} value={high} onChangeText={setHigh} onBlur={() => save('high_label', high, q.high_label)} maxLength={60} style={[styles.input, styles.small]} />
          <Text variant="tiny" tone="muted">
            Also ask
          </Text>
          <TextInput
            accessibilityLabel="Also ask"
            editable={!readOnly}
            value={detail}
            onChangeText={setDetail}
            onBlur={() => save('detail_label', detail, q.detail_label)}
            placeholder="e.g. Where? (leave empty for none)"
            placeholderTextColor={colors.ink4}
            maxLength={60}
            style={[styles.input, styles.small, { flexGrow: 1 }]}
          />
        </View>
      ) : null}
      {q.type === 'choice' ? (
        <View style={styles.wrap}>
          {q.options.map((o, i) => (
            <View key={`${o}-${i}`} style={styles.option}>
              <Text variant="small">{o}</Text>
              {!readOnly ? (
                <Pressable accessibilityRole="button" accessibilityLabel={`Remove option ${o}`} onPress={() => onRemoveOption(i)} hitSlop={6}>
                  <Feather name="x" size={12} color={colors.ink3} />
                </Pressable>
              ) : null}
            </View>
          ))}
          {!readOnly && q.options.length < 12 ? (
            <>
              <TextInput accessibilityLabel="New option" value={option} onChangeText={setOption} onSubmitEditing={addOption} placeholder="New option" placeholderTextColor={colors.ink4} maxLength={60} style={[styles.input, styles.small]} />
              <Button size="sm" variant="ghost" title="+ option" onPress={addOption} />
            </>
          ) : null}
        </View>
      ) : null}
      {q.type === 'text' ? (
        <Text variant="tiny" tone="muted">
          Athletes type a few words; they can leave it empty.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: 12 },
  question: { gap: 8, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.line2 },
  qTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, paddingLeft: 4 },
  input: { borderWidth: 1.5, borderColor: colors.line, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10, fontSize: 13.5, fontFamily: fonts.regular, color: colors.ink, backgroundColor: colors.surface },
  small: { minWidth: 140 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.surface2, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
  adds: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
