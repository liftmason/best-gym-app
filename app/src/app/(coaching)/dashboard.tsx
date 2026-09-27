import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AccountBar } from '@/auth/account-bar';
import { space, Text } from '@/ui';

/** Coaching mode's first screen: a placeholder until its sub-project. */
export default function CoachingHome() {
  return (
    <SafeAreaView style={styles.page}>
      <AccountBar mode="coaching" />
      <View style={styles.body}>
        <Text variant="h2">Coaching</Text>
        <Text tone="muted">The dashboard, roster and program board arrive in sub-projects 6 and 7.</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  body: { padding: space.xl, gap: space.s },
});
