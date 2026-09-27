import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TrainingHeader } from '@/training/header';
import { Card, space, Text } from '@/ui';

/** Placeholder until S5b. */
export default function Screen() {
  return (
    <SafeAreaView style={styles.page} edges={['top']}>
      <TrainingHeader />
      <ScrollView contentContainerStyle={styles.body}>
        <Text variant="h3">Your progress</Text>
        <Card>
          <Text tone="muted">Charts of your lifts, your records and recent sessions arrive with the next part of this update.</Text>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  body: { padding: 18, gap: space.m },
});
