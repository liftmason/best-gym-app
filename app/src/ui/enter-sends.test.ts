import { enterSends } from './enter-sends';

/** A key press as react-native-web passes it: the DOM keyboard event is `nativeEvent`. */
function press(key: string, extra: { shiftKey?: boolean; isComposing?: boolean } = {}) {
  const event = { nativeEvent: { key, shiftKey: false, isComposing: false, ...extra }, preventDefault: jest.fn() };
  return event;
}

test('on a desktop browser, Enter sends instead of starting a new line', () => {
  const send = jest.fn();
  const event = press('Enter');
  enterSends(send, true)(event as never);
  expect(send).toHaveBeenCalledTimes(1);
  expect(event.preventDefault).toHaveBeenCalled();
});

test('Shift+Enter, other keys, and typing an accent (composition) are left alone', () => {
  const send = jest.fn();
  for (const event of [press('Enter', { shiftKey: true }), press('a'), press('Enter', { isComposing: true })]) {
    enterSends(send, true)(event as never);
    expect(event.preventDefault).not.toHaveBeenCalled();
  }
  expect(send).not.toHaveBeenCalled();
});

test('on phones and touch screens Enter stays a new line; the send button sends', () => {
  const send = jest.fn();
  const event = press('Enter');
  enterSends(send, false)(event as never);
  expect(send).not.toHaveBeenCalled();
  expect(event.preventDefault).not.toHaveBeenCalled();
});
