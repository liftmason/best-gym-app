/** Links to the privacy policy and terms, under an account's settings. */
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';

import { Text } from '@/ui';

export function LegalLinks() {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 14, paddingVertical: 4 }}>
      <Pressable accessibilityRole="link" onPress={() => router.push('/privacy')}>
        <Text variant="small" tone="muted">
          Privacy policy
        </Text>
      </Pressable>
      <Pressable accessibilityRole="link" onPress={() => router.push('/terms')}>
        <Text variant="small" tone="muted">
          Terms of use
        </Text>
      </Pressable>
    </View>
  );
}
