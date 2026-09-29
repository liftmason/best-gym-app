/** A legal document as a readable page (/privacy, /terms), open whether signed in or not. */
import { router } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Card, colors, space, Text } from '@/ui';

import { DRAFT, UPDATED, type Section } from './texts';

export function LegalPage({ title, sections }: { title: string; sections: Section[] }) {
  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.body}>
        <View style={{ alignSelf: 'flex-start' }}>
          <Button title="← Back" size="sm" variant="ghost" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
        </View>
        <Text variant="h1">{title}</Text>
        {DRAFT ? (
          <Card style={styles.draft}>
            <Text variant="small" tone="warn">
              Draft, not yet in force. The parts in [brackets] are still to be written.
            </Text>
          </Card>
        ) : null}
        {sections.map((s) => (
          <View key={s.heading} style={{ gap: space.s }}>
            <Text variant="h3">{s.heading}</Text>
            {s.paragraphs.map((p, i) => (
              <Text key={i}>{p}</Text>
            ))}
          </View>
        ))}
        <Text variant="small" tone="muted">
          Last updated: {UPDATED}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  body: { padding: 22, gap: space.l, maxWidth: 760, width: '100%', alignSelf: 'center' },
  draft: { backgroundColor: colors.warnLight, borderColor: colors.warnLight },
});
