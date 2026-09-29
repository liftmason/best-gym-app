/** "Starting up": shown while a request waits for a sleeping server to wake (src/api/client.ts). */
import { StyleSheet, View } from 'react-native';

import { colors, radius, space, Text } from '@/ui';

import { useWaking } from './index';

export function WakingNotice() {
  if (!useWaking()) return null;
  return (
    <View style={styles.notice} pointerEvents="none" accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Text variant="small">Starting up. This can take a minute…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    position: 'absolute',
    top: space.m,
    alignSelf: 'center',
    backgroundColor: colors.warnLight,
    borderRadius: radius.pill,
    paddingHorizontal: space.l,
    paddingVertical: space.s,
  },
});
