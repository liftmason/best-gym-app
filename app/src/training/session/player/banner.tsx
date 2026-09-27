import { StyleSheet, View } from 'react-native';

import type { Banner } from '@/domain/player';
import { colors, fonts, radius, Text } from '@/ui';

/** The mockup's dark .rx-banner: sets × reps, the load (and RIR), and where the load comes from. */
export function RxBanner({ banner }: { banner: Banner }) {
  return (
    <View style={styles.banner} accessibilityLabel={`${banner.sets} by ${banner.reps}, ${banner.load || 'no load'}${banner.rir ? `, RIR ${banner.rir}` : ''}. ${banner.hint}`}>
      <Text style={styles.big}>
        {banner.sets} × {banner.reps}
      </Text>
      <View style={styles.right}>
        <Text style={styles.big}>
          {banner.load || '—'}
          {banner.rir ? <Text style={styles.rir}> RIR {banner.rir}</Text> : null}
        </Text>
        {banner.hint ? <Text style={styles.hint}>{banner.hint}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.ink,
    borderRadius: radius.l,
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
  },
  big: { color: colors.white, fontFamily: fonts.extrabold, fontSize: 22 },
  rir: { color: colors.white, fontFamily: fonts.semibold, fontSize: 13, opacity: 0.85 },
  right: { marginLeft: 'auto', alignItems: 'flex-end', flexShrink: 1 },
  hint: { color: colors.white, opacity: 0.7, fontSize: 11.5, textAlign: 'right' },
});
