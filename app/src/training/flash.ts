/** A one-off line for the next screen ("Session paused. Pick it up any time"). */
let pending: string | null = null;

export const flash = {
  set: (message: string) => {
    pending = message;
  },
  take: (): string | null => {
    const message = pending;
    pending = null;
    return message;
  },
};
