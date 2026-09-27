/**
 * The sign-in card from the mockup (`.login-card`): the dark pitch panel beside the form on
 * wide screens, and the form alone under the logo on a phone.
 */
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radius, shadows, space, Text } from '@/ui';

const WIDE = 760;

function Logo({ onDark }: { onDark?: boolean }) {
  return (
    <View style={styles.logo}>
      <View style={styles.mark}>
        <Text variant="label" tone="white">
          GT
        </Text>
      </View>
      <Text variant="h3" tone={onDark ? 'white' : 'ink'}>
        GymTrainer
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
                  Every athlete&apos;s training history, right where you program.
                </Text>
                <Text variant="small" style={styles.pitchBody}>
                  Build weekly programs, deliver sessions to your athletes&apos; phones, and review results as
                  they come in — with each athlete&apos;s complete lift history beside the editor.
                </Text>
              </View>
            ) : null}
            <View style={[styles.right, !wide && styles.rightNarrow]}>
              {wide ? null : <Logo />}
              {children}
            </View>
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
  mark: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
