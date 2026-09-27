/** The real app state and network for the scheduler. */
import { addNetworkStateListener } from 'expo-network';
import { AppState } from 'react-native';

import type { Surroundings } from './scheduler';

export const surroundings: Surroundings = {
  onForeground(listener) {
    const subscription = AppState.addEventListener('change', (state) => listener(state === 'active'));
    return () => subscription.remove();
  },
  onNetwork(listener) {
    const subscription = addNetworkStateListener((state) => listener(state.isConnected !== false));
    return () => subscription.remove();
  },
};
