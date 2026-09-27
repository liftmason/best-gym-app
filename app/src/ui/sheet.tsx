import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';

import { Text } from './text';
import { colors, radius, shadows, space } from './theme';

type Props = { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode };

/**
 * The mockup's .modal: on a phone it rises from the bottom as a sheet; on a wide screen it
 * sits in the middle, up to 560 px wide. Tapping the scrim closes it.
 */
export function Sheet({ open, onClose, title, children, footer }: Props) {
  const { width } = useWindowDimensions();
  const wide = width >= 700;
  return (
    <Modal visible={open} transparent animationType={wide ? 'fade' : 'slide'} onRequestClose={onClose}>
      <View style={[styles.scrimArea, wide ? styles.centre : styles.bottom]}>
        <Pressable accessibilityLabel="Close" style={StyleSheet.absoluteFill} onPress={onClose}>
          <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]} />
        </Pressable>
        <View style={[styles.panel, shadows.s3, wide ? styles.panelWide : styles.panelSheet]}>
          <View style={styles.head}>
            <Text variant="h3">{title}</Text>
          </View>
          <ScrollView contentContainerStyle={styles.body}>{children}</ScrollView>
          {footer ? <View style={styles.foot}>{footer}</View> : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrimArea: { flex: 1 },
  centre: { alignItems: 'center', justifyContent: 'center' },
  bottom: { justifyContent: 'flex-end' },
  panel: { backgroundColor: colors.surface, overflow: 'hidden', maxHeight: '88%' },
  panelWide: { width: 560, maxWidth: '94%', borderRadius: radius.xl },
  panelSheet: { width: '100%', borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl },
  head: { paddingVertical: 18, paddingHorizontal: space.xl, borderBottomWidth: 1, borderBottomColor: colors.line },
  body: { padding: space.xl, gap: 14 },
  foot: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: space.xl,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.surface2,
  },
});
