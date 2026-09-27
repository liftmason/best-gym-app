import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { OTHER_OPTION } from '@/domain/checkins';
import { uuid7 } from '@/domain/ids';
import { checkinAnswer, checkinFinish, Refused } from '@/sync/actions';
import { Loading, SessionScreen } from '@/training/session/screen';
import { useLog } from '@/training/session/use-log';
import { Button, colors, Field, FlowHead, fonts, radius, Scale, space, Text } from '@/ui';

/** One check-in question (the mockup's #m-checkin): a scale, a choice with "Other", or a few words. */
export default function Checkin() {
  const { world, log, logId, n, engine, coach } = useLog();
  const questions = world?.questions ?? [];
  const question = questions[n - 1];
  const answer = log && question ? (world!.answersOf.get(log.id) ?? []).find((a) => a.question_id === question.id) : undefined;
  const [value, setValue] = useState<string | null>(null);
  const [other, setOther] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  if (!world) return <Loading />;
  if (!log || log.finished_at) return <Redirect href={{ pathname: '/session/[log]/player', params: { log: logId, n: '1' } }} />;
  if (!question) return <Redirect href={{ pathname: '/session/[log]/summary', params: { log: logId } }} />;

  const chosen = value ?? answer?.value ?? '';
  const details = other ?? answer?.other_text ?? '';
  const total = questions.length + 1;

  async function next() {
    setProblem(null);
    try {
      await engine.enqueue(checkinAnswer, {
        answer_id: answer?.id ?? uuid7(),
        session_log_id: logId,
        question_id: question.id,
        value: chosen,
        other: details,
      });
    } catch (error) {
      setProblem(error instanceof Refused ? error.message : "Couldn't save that. Try again.");
      return;
    }
    setValue(null);
    setOther(null);
    if (n < questions.length) router.replace({ pathname: '/session/[log]/checkin', params: { log: logId, n: String(n + 1) } });
    else router.replace({ pathname: '/session/[log]/summary', params: { log: logId } });
  }

  async function skip() {
    await engine.enqueue(checkinFinish, { session_log_id: logId, skip: true });
    router.replace({ pathname: '/session/[log]/player', params: { log: logId, n: '1' } });
  }

  return (
    <SessionScreen
      footer={
        <>
          <Button title="Continue" size="lg" block disabled={question.type !== 'text' && !chosen} onPress={next} />
          <Button title="Skip check-in this time" variant="ghost" size="sm" onPress={skip} />
        </>
      }
    >
      <FlowHead
        icon="arrow-left"
        label="Back"
        onBack={() =>
          n > 1 ? router.replace({ pathname: '/session/[log]/checkin', params: { log: logId, n: String(n - 1) } }) : router.back()
        }
        progress={(n / total) * 100}
        step={`${n} of ${total}`}
      />
      <Text variant="h3">{question.text}</Text>
      {question.type === 'scale' ? (
        <>
          <Text variant="tiny" tone="muted">
            Shared with {coach} before your session.
          </Text>
          <Scale value={chosen} onPick={setValue} spoken={(i) => `${i} of 10`} />
          <View style={styles.ends}>
            <Text variant="tiny" tone="faint">
              1 · {question.low_label || 'low'}
            </Text>
            <Text variant="tiny" tone="faint">
              10 · {question.high_label || 'high'}
            </Text>
          </View>
          {question.detail_label ? (
            <Field label={`${question.detail_label} (optional)`} value={details} onChangeText={setOther} maxLength={300} />
          ) : null}
        </>
      ) : question.type === 'text' ? (
        <>
          <Text variant="tiny" tone="muted">
            A few words for {coach} — or leave it empty.
          </Text>
          <Field label={question.text} value={chosen} onChangeText={setValue} multiline maxLength={200} />
        </>
      ) : (
        <>
          <Text variant="tiny" tone="muted">
            Pick one — or add your own details.
          </Text>
          <View style={styles.options}>
            {[...question.options, OTHER_OPTION].map((option) => {
              const on = chosen === option;
              return (
                <Pressable
                  key={option}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  onPress={() => setValue(option)}
                  style={[styles.option, on && styles.optionOn]}
                >
                  <Text style={[styles.optionText, on && { color: colors.brand }]}>
                    {option === OTHER_OPTION ? 'Other — add details' : option}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {chosen === OTHER_OPTION ? (
            <Field label={`Details for ${coach}`} value={details} onChangeText={setOther} multiline maxLength={300} />
          ) : null}
        </>
      )}
      {problem ? (
        <Text variant="small" tone="bad" accessibilityRole="alert">
          {problem}
        </Text>
      ) : null}
    </SessionScreen>
  );
}

const styles = StyleSheet.create({
  ends: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -6 },
  options: { gap: 8, marginTop: space.s },
  option: { borderWidth: 1.5, borderColor: colors.line, borderRadius: radius.m, paddingVertical: 13, paddingHorizontal: 14 },
  optionOn: { borderColor: colors.brand, backgroundColor: colors.brandLight },
  optionText: { fontFamily: fonts.bold, fontSize: 14 },
});
