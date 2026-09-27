/**
 * Form video files on the web: the browser has nowhere lasting to keep them, so a video is
 * held in memory and uploaded while the page is open (it needs a connection).
 */
import type { VideoFiles } from './files';

const held = new Map<string, Blob>();

export const videoFiles: VideoFiles = {
  lasting: false,
  async keep(uri, id) {
    const blob = await (await fetch(uri)).blob();
    held.set(id, blob);
    return { uri: `memory:${id}`, size: blob.size };
  },
  async put(uri, url, contentType) {
    const blob = held.get(uri.replace(/^memory:/, ''));
    if (!blob) return 410; // the page was reloaded: the file is gone
    const response = await fetch(url, { method: 'PUT', body: blob, headers: { 'Content-Type': contentType } });
    return response.status;
  },
  drop(uri) {
    held.delete(uri.replace(/^memory:/, ''));
  },
};

export type { VideoFiles };
