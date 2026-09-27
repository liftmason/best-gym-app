/** A one-off line for the next screen ("Session paused — pick it up any time"). */
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
