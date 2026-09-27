/** The frame of the session screens: a scrolling page under the safe area, no tabs. */
import type { ReactNode } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, space } from '@/ui';

export function SessionScreen({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <SafeAreaView style={styles.page} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function Loading() {
  return (
    <View style={[styles.page, { alignItems: 'center', justifyContent: 'center' }]}>
      <ActivityIndicator color={colors.brand} />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.surface },
  body: { padding: 18, paddingBottom: space.xxl, gap: space.m },
  footer: { paddingHorizontal: 18, paddingVertical: space.m, borderTopWidth: 1, borderTopColor: colors.line2, gap: space.s },
});
