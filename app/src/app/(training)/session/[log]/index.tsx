import { Redirect, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { resumePoint } from '@/domain/player';
import { useLog } from '@/training/session/use-log';
import { colors, Text } from '@/ui';

/** Opens a session where it picks up: the check-in, the player, or the finish (a review opens the player). */
export default function Session() {
  const { review } = useLocalSearchParams<{ review?: string }>();
  const { world, log, logId } = useLog();
  if (!world) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }
  if (!log) {
    return (
      <View style={styles.centre}>
        <Text tone="muted">That session isn&apos;t on this device.</Text>
      </View>
    );
  }
  if (review) return <Redirect href={{ pathname: '/session/[log]/player', params: { log: logId, n: '1' } }} />;
  const [where, n] = resumePoint(world, log);
  if (where === 'checkin') return <Redirect href={{ pathname: '/session/[log]/checkin', params: { log: logId, n: String(n) } }} />;
  if (where === 'checkin_summary') return <Redirect href={{ pathname: '/session/[log]/summary', params: { log: logId } }} />;
  if (where === 'player') return <Redirect href={{ pathname: '/session/[log]/player', params: { log: logId, n: String(n) } }} />;
  return <Redirect href={{ pathname: '/session/[log]/finish', params: { log: logId } }} />;
}

const styles = StyleSheet.create({ centre: { flex: 1, alignItems: 'center', justifyContent: 'center' } });
