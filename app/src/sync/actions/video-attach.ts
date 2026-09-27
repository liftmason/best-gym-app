/**
 * `video.attach`: a form video finished uploading (src/videos). Nothing changes on the phone
 * until the server's row arrives with the next pull.
 */
import type { Action } from './types';

export type VideoAttach = { video_id: string };

export const videoAttach: Action<VideoAttach> = {
  name: 'video.attach',
  async apply() {},
};
