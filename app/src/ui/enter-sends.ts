/**
 * For message boxes: on a desktop browser Enter sends and Shift+Enter starts a new line, as in
 * most chat apps. On phones and touch screens Enter stays a new line and the send button sends.
 * react-native-web calls onKeyPress before its own Enter handling and skips that when the
 * event is cancelled; its own "submit on Enter" for multi-line boxes would also take the
 * focus away after every message.
 */
import { Platform, type NativeSyntheticEvent, type TextInputKeyPressEventData } from 'react-native';

type KeyPress = NativeSyntheticEvent<TextInputKeyPressEventData & { shiftKey?: boolean; isComposing?: boolean }>;

function desktopBrowser(): boolean {
  return (
    Platform.OS === 'web' && typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches
  );
}

export function enterSends(send: () => void, desktop: boolean = desktopBrowser()) {
  return (event: KeyPress) => {
    const { key, shiftKey, isComposing } = event.nativeEvent;
    // isComposing: the Enter that finishes an accented or other composed character.
    if (!desktop || key !== 'Enter' || shiftKey || isComposing) return;
    event.preventDefault();
    send();
  };
}
