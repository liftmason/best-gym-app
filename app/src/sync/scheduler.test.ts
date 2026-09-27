import { AFTER_ACTION_MS, EVERY_MS, startScheduler } from './scheduler';

function setUp() {
  const queued = new Set<() => void>();
  const engine = {
    sync: jest.fn(async () => {}),
    onQueued: (listener: () => void) => {
      queued.add(listener);
      return () => void queued.delete(listener);
    },
  };
  let foreground: (active: boolean) => void = () => {};
  let network: (connected: boolean) => void = () => {};
  const stop = startScheduler(engine, {
    onForeground: (listener) => ((foreground = listener), () => {}),
    onNetwork: (listener) => ((network = listener), () => {}),
  });
  const queue = () => queued.forEach((listener) => listener());
  return { engine, stop, queue, foreground: (a: boolean) => foreground(a), network: (c: boolean) => network(c) };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('syncs on start and every minute while in the foreground', () => {
  const { engine, foreground, stop } = setUp();
  expect(engine.sync).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(EVERY_MS);
  expect(engine.sync).toHaveBeenCalledTimes(2);
  foreground(false);
  jest.advanceTimersByTime(EVERY_MS);
  expect(engine.sync).toHaveBeenCalledTimes(2);
  foreground(true); // back: straight away
  expect(engine.sync).toHaveBeenCalledTimes(3);
  stop();
});

test('a few seconds after the last of several actions, once', () => {
  const { engine, queue, stop } = setUp();
  queue();
  jest.advanceTimersByTime(AFTER_ACTION_MS - 100);
  queue();
  jest.advanceTimersByTime(AFTER_ACTION_MS - 100);
  expect(engine.sync).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(200);
  expect(engine.sync).toHaveBeenCalledTimes(2);
  stop();
});

test('when the connection comes back', () => {
  const { engine, network, stop } = setUp();
  network(false);
  network(true);
  network(true);
  expect(engine.sync).toHaveBeenCalledTimes(2);
  stop();
  jest.advanceTimersByTime(EVERY_MS * 3);
  expect(engine.sync).toHaveBeenCalledTimes(2);
});
