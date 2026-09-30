/**
 * Keeping what you type above the keyboard. Android apps are drawn edge to edge now (Expo's
 * default, and required by Android 15+), so Android no longer shrinks the app for the
 * keyboard ("adjustResize"): the app must make room itself, as on iPhone. "padding" works on
 * both; on the web the browser does it. Put a ScrollView inside, so the field can scroll
 * into the space that's left.
 */
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, View, type StyleProp, type ViewStyle } from 'react-native';

export function AvoidKeyboard({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  if (Platform.OS === 'web') return <View style={style}>{children}</View>;
  return (
    <KeyboardAvoidingView style={style} behavior="padding">
      {children}
    </KeyboardAvoidingView>
  );
}
