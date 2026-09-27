/**
 * A verified new email waiting for its sign-up form. Kept in memory, not in the URL: the
 * ticket is a credential for 30 minutes. A reload on the web starts sign-in again.
 */
let pending: { ticket: string; email: string } | null = null;

export const signUp = {
  get: () => pending,
  set: (ticket: string, email: string) => {
    pending = { ticket, email };
  },
  clear: () => {
    pending = null;
  },
};
