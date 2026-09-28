/**
 * The mockup's toasts (`toast(msg, kind)`): a short line at the bottom that confirms what just
 * happened, or says why it didn't. Screens call `useToast()`; outside a `ToastProvider` it
 * does nothing.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from './text';
import { colors, fonts, radius, shadows } from './theme';

type Kind = 'good' | 'bad' | 'plain';
type Toast = (message: string, kind?: Kind) => void;

const ToastContext = createContext<Toast>(() => {});

export function useToast(): Toast {
  return useContext(ToastContext);
}

const SHOWN_MS = 3400;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState<{ message: string; kind: Kind; n: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toast = useCallback<Toast>((message, kind = 'plain') => {
    setShown((s) => ({ message, kind, n: (s?.n ?? 0) + 1 }));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setShown(null), SHOWN_MS);
  }, []);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  return (
    <ToastContext.Provider value={toast}>
      {children}
      {shown ? (
        <View pointerEvents="none" style={styles.area}>
          <View key={shown.n} accessibilityRole={shown.kind === 'bad' ? 'alert' : 'text'} accessibilityLiveRegion="polite" style={[styles.toast, shadows.s2]}>
            {shown.kind !== 'plain' ? <View style={[styles.dot, { backgroundColor: shown.kind === 'good' ? colors.good : colors.bad }]} /> : null}
            <Text style={styles.text}>{shown.message}</Text>
          </View>
        </View>
      ) : null}
    </ToastContext.Provider>
  );
}

const styles = StyleSheet.create({
  area: { position: 'absolute', left: 0, right: 0, bottom: 28, alignItems: 'center', paddingHorizontal: 16 },
  toast: { flexDirection: 'row', alignItems: 'center', gap: 10, maxWidth: 560, backgroundColor: colors.ink, borderRadius: radius.m, paddingVertical: 11, paddingHorizontal: 16 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  text: { color: colors.white, fontFamily: fonts.medium, fontSize: 13.5, flexShrink: 1 },
});
