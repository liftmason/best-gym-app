import { Redirect } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { Button, Card, Chip, Field, SetRow, Sheet, Text, WeekPill, WeekStrip, colors, type SetValues } from '@/ui';

/**
 * Every component of the kit, for comparing with the mockup on a phone and on the web.
 * Development builds only (/kit); a release redirects home.
 */
export default function Kit() {
  const [sheet, setSheet] = useState(false);
  const [set, setSet] = useState<SetValues>({ load: '80', reps: '2', time: '', rir: '2' });
  const [done, setDone] = useState(false);
  if (!__DEV__) return <Redirect href="/" />;
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 18, backgroundColor: colors.bg }}>
      <Text variant="h1" tone="ink">
        Component kit
      </Text>
      <Text variant="h2">Headings and text</Text>
      <Text variant="h3">Section title</Text>
      <Text variant="h4">Card title</Text>
      <Text>Body text in Inter at 15 px, as the mockup sets it.</Text>
      <Text variant="small" tone="muted">
        Small and muted.
      </Text>

      <Text variant="h2">Buttons</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Button title="Start session" />
        <Button title="Ghost" variant="ghost" />
        <Button title="Soft" variant="soft" />
        <Button title="Finish" variant="good" />
        <Button title="Delete" variant="danger" />
        <Button title="Small" size="sm" />
        <Button title="Saving" busy />
        <Button title="Disabled" disabled />
      </View>
      <Button title="Large block" size="lg" block />

      <Text variant="h2">Chips and week types</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Chip label="Plain" />
        <Chip label="New" tone="brand" />
        <Chip label="Done" tone="good" />
        <Chip label="Due" tone="warn" />
        <Chip label="Missed" tone="bad" />
        <WeekPill name="Accumulation" colour="#2E9E5B" />
        <WeekPill name="Deload" colour="#8A63D2" />
      </View>

      <Text variant="h2">Card and field</Text>
      <Card style={{ gap: 12 }}>
        <Text variant="h4">Sign in</Text>
        <Field label="Email" placeholder="you@example.com" autoCapitalize="none" keyboardType="email-address" />
        <Field label="Code" error="That code isn't right." value="123" />
      </Card>

      <Text variant="h2">Week strip</Text>
      <WeekStrip
        days={[
          { date: '2026-09-21', weekday: 'Mon', state: 'done', mark: '✓' },
          { date: '2026-09-22', weekday: 'Tue', state: 'rest' },
          { date: '2026-09-23', weekday: 'Wed', state: 'missed', mark: 'missed' },
          { date: '2026-09-24', weekday: 'Thu', state: 'planned', mark: '4 ex', today: true },
          { date: '2026-09-25', weekday: 'Fri', state: 'rest' },
          { date: '2026-09-26', weekday: 'Sat', state: 'planned', mark: '5 ex' },
          { date: '2026-09-27', weekday: 'Sun', state: 'rest' },
        ]}
      />

      <Text variant="h2">Set row</Text>
      <SetRow
        number={1}
        unit="kg"
        measure="reps"
        timeUnit="s"
        values={set}
        placeholder="2"
        done={done}
        editable
        onChange={setSet}
        onCommit={(values, next) => {
          setSet(values);
          setDone(next);
        }}
      />

      <Text variant="h2">Sheet</Text>
      <Button title="Open a sheet" variant="ghost" onPress={() => setSheet(true)} />
      <Sheet
        open={sheet}
        onClose={() => setSheet(false)}
        title="Report an issue"
        footer={<Button title="Send" onPress={() => setSheet(false)} />}
      >
        <Text>Sheets rise from the bottom on a phone and sit in the middle on a wide screen.</Text>
      </Sheet>
    </ScrollView>
  );
}
