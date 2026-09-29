/**
 * The sign-in card from the mockup (`.login-card`): the dark pitch panel beside the form on
 * wide screens, and the form alone under the logo on a phone.
 */
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radius, shadows, space, Text } from '@/ui';
import { APP_NAME } from '@/name';

const WIDE = 760;

function Logo({ onDark }: { onDark?: boolean }) {
  return (
    <View style={styles.logo}>
      <View style={styles.mark}>
        <Text variant="label" tone="white">
          {APP_NAME.charAt(0)}
        </Text>
      </View>
      <Text variant="h3" tone={onDark ? 'white' : 'ink'}>
        {APP_NAME}
      </Text>
    </View>
  );
}

export function SignInFrame({ children }: { children: ReactNode }) {
  const wide = useWindowDimensions().width >= WIDE;
  return (
    <SafeAreaView style={styles.page}>
      <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={[styles.card, wide && styles.cardWide]}>
            {wide ? (
              <View style={styles.left}>
                <Logo onDark />
                <Text variant="h1" tone="white" style={styles.pitch}>
                  See each athlete&apos;s lift history while you program.
                </Text>
                <Text variant="small" style={styles.pitchBody}>
                  Write each week here and it goes to your athletes&apos; phones. Their results come back as
                  they train.
                </Text>
              </View>
            ) : null}
            <View style={[styles.right, !wide && styles.rightNarrow]}>
              {wide ? null : <Logo />}
              {children}
            </View>
          </View>
          <View style={styles.legal}>
            <Pressable accessibilityRole="link" onPress={() => router.push('/privacy')}>
              <Text variant="tiny" tone="muted">
                Privacy
              </Text>
            </Pressable>
            <Text variant="tiny" tone="faint">
              ·
            </Text>
            <Pressable accessibilityRole="link" onPress={() => router.push('/terms')}>
              <Text variant="tiny" tone="muted">
                Terms
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  scroll: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: space.l },
  card: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.xl,
    overflow: 'hidden',
    ...shadows.s2,
  },
  cardWide: { maxWidth: 880, flexDirection: 'row' },
  left: { flex: 1, backgroundColor: colors.ink, paddingVertical: 44, paddingHorizontal: 40, gap: space.s },
  pitch: { marginTop: 26, fontSize: 32, lineHeight: 38 },
  pitchBody: { color: '#EDEFF2', opacity: 0.75, maxWidth: 380 },
  right: { flex: 1, paddingVertical: 44, paddingHorizontal: 40, gap: space.m, justifyContent: 'center' },
  rightNarrow: { paddingVertical: space.xxl, paddingHorizontal: space.xl },
  logo: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  legal: { flexDirection: 'row', gap: 8, marginTop: space.m },
  mark: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
