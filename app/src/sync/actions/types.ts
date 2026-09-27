import type { Local } from '../local';

/** Where and when an action happened, for its local effect. */
export type ActionContext = {
  /** The action's id, also used for a row it creates when the server picks that row's id. */
  id: string;
  /** When the athlete did it (ISO 8601). */
  at: string;
  athleteId: string;
  userId: string;
};

/**
 * One push action (backend apps/sync/actions.py): its name, and its effect on the local
 * tables, which the screen shows until the server's answer arrives. The effect throws a
 * Refused for something the server would refuse, so nothing is queued.
 */
export type Action<P> = {
  name: string;
  apply(local: Local, payload: P, context: ActionContext): Promise<void>;
};

/** A local effect refusing: its message is for the athlete. */
export class Refused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Refused';
  }
}
