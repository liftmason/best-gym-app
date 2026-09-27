import type { Local } from '../local';

/** Where and when an action happened, for its local effect. */
export type ActionContext = {
  /** The action's id, also used for a row it creates when the server picks that row's id. */
  id: string;
  /** When the athlete did it (ISO 8601). */
  at: string;
  athleteId: string;
  userId: string;
  /** The athlete's date when they did it (their time zone), for rules about "today". */
  day: string;
  /** auto: a session's PR becomes the working max at once; approve: the coach decides. */
  maxUpdates: string;
};

/**
 * One push action (backend apps/sync/actions.py): its name, and its effect on the local
 * tables, which the screen shows until the server's answer arrives. The effect throws a
 * Refused for something the server would refuse, so nothing is queued.
 */
export type Action<P> = {
  name: string;
  apply(local: Local, payload: P, context: ActionContext): Promise<void>;
  /**
   * {phone's id: server's id} from the server's answer, when the server kept ids of its own
   * (a session already started on another device). Waiting actions are rewritten to them.
   */
  adopt?(payload: P, result: Record<string, unknown>): Record<string, string>;
};

/** A local effect refusing: its message is for the athlete. */
export class Refused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Refused';
  }
}
