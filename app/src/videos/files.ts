/**
 * Form video files on a phone: kept in the app's own storage until they're uploaded (a
 * picked or recorded file may be a temporary one), then deleted.
 */
import { Directory, File, Paths, UploadType } from 'expo-file-system';

export type VideoFiles = {
  /** Whether a kept file survives the app closing (phones: yes; the web: no). */
  lasting: boolean;
  keep(uri: string, id: string, contentType: string): Promise<{ uri: string; size: number }>;
  /** PUTs the file's bytes to a signed URL; the HTTP status. */
  put(uri: string, url: string, contentType: string): Promise<number>;
  drop(uri: string): void;
};

const EXTENSIONS: Record<string, string> = { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' };

export const videoFiles: VideoFiles = {
  lasting: true,
  async keep(uri, id, contentType) {
    const folder = new Directory(Paths.document, 'form-videos');
    folder.create({ intermediates: true, idempotent: true });
    const kept = new File(folder, `${id}.${EXTENSIONS[contentType] ?? 'mp4'}`);
    new File(uri).copy(kept);
    return { uri: kept.uri, size: kept.size };
  },
  async put(uri, url, contentType) {
    const result = await new File(uri).upload(url, {
      httpMethod: 'PUT',
      uploadType: UploadType.BINARY_CONTENT,
      headers: { 'Content-Type': contentType },
    });
    return result.status;
  },
  drop(uri) {
    try {
      const file = new File(uri);
      if (file.exists) file.delete();
    } catch {
      // Gone already.
    }
  },
};
