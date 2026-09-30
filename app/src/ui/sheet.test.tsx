/** A bottom sheet on an edge-to-edge phone stays clear of the navigation bar. */
import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Button } from './button';
import { Sheet } from './sheet';

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 40, left: 0, right: 0, bottom: 48 } };

test('on a phone the buttons sit above the navigation bar', async () => {
  // A phone: under 700 px the sheet rises from the bottom (Jest's default window is wider).
  jest.spyOn(jest.requireActual('react-native'), 'useWindowDimensions').mockReturnValue({ width: 390, height: 844, scale: 3, fontScale: 1 });
  await render(
    <SafeAreaProvider initialMetrics={metrics}>
      <Sheet open onClose={() => {}} title="Report a bug" footer={<Button title="Send" />}>
        {null}
      </Sheet>
    </SafeAreaProvider>,
  );
  const footer = screen.getByRole('button', { name: 'Send' }).parent!;
  expect(StyleSheet.flatten(footer.props.style).paddingBottom).toBe(14 + 48);
});
