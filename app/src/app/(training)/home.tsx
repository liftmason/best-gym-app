import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AccountBar } from '@/auth/account-bar';
import { space, Text } from '@/ui';

/** Training mode's first screen: a placeholder until its sub-project. */
export default function TrainingHome() {
  return (
    <SafeAreaView style={styles.page}>
      <AccountBar mode="training" />
      <View style={styles.body}>
        <Text variant="h2">Training</Text>
        <Text tone="muted">Your week, sessions and progress arrive in sub-project 5.</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  body: { padding: space.xl, gap: space.s },
});
