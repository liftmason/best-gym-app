import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/ui';

/** Opens a session where it picks up (check-in, player or finish): step 4. */
export default function Session() {
  const { log } = useLocalSearchParams<{ log: string }>();
  return (
    <View style={styles.centre}>
      <Text>Session {log}</Text>
    </View>
  );
}

const styles = StyleSheet.create({ centre: { flex: 1, alignItems: 'center', justifyContent: 'center' } });
