/**
 * Form videos for one exercise in the player: the ones sent (and what the coach did with
 * them), the ones waiting to upload, and adding one (recorded or picked). Adding works
 * offline on a phone; the upload waits for a connection (src/videos/queue).
 */
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { api, ApiError, ok } from '@/api';
import { ago } from '@/domain/history';
import { localDate } from '@/domain/dates';
import type { SessionExerciseRow, World } from '@/domain/world';
import { useSync } from '@/sync/provider';
import { useUploads } from '@/videos/use-uploads';
import { Button, colors, fonts, radius, Sheet, space, Text } from '@/ui';
import { confirm } from '@/ui/confirm';

export const MAX_PER_EXERCISE = 3; // backend form_videos.MAX_PER_EXERCISE

function Row({ title, detail, tone, children, onRemove }: { title: string; detail: string; tone?: 'bad'; children?: React.ReactNode; onRemove?: () => void }) {
  return (
    <View style={styles.row}>
      <View style={styles.icon}>
        <Text style={{ color: colors.white, fontSize: 11 }}>▶</Text>
      </View>
      <View style={styles.text}>
        <Text variant="small" style={styles.bold}>
          {title}
        </Text>
        <Text variant="tiny" tone={tone ?? 'muted'}>
          {detail}
        </Text>
        {children}
      </View>
      {onRemove ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Remove this video" onPress={onRemove} hitSlop={8}>
          <Text tone="muted">✕</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function FormVideos({ world, se, coach, editable }: { world: World; se: SessionExerciseRow; coach: string; editable: boolean }) {
  const { videos, profile } = useSync();
  const uploads = useUploads(se.id);
  const [choosing, setChoosing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const sent = (world.videosOf.get(se.id) ?? []).filter((v) => v.uploaded_at !== null);
  const room = MAX_PER_EXERCISE - sent.filter((v) => !v.deleted_at).length - uploads.filter((u) => u.state !== 'refused').length;
  const today = world.today;

  async function pick(camera: boolean) {
    setChoosing(false);
    setProblem(null);
    try {
      if (camera) {
        const { granted } = await ImagePicker.requestCameraPermissionsAsync();
        if (!granted) {
          setProblem('The camera needs your permission (in Settings).');
          return;
        }
      }
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['videos'], videoMaxDuration: 180 };
      const result = camera ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
      const asset = result.canceled ? null : result.assets[0];
      if (!asset) return;
      await videos.add(se.session_log_id, se.id, asset.uri, asset.mimeType ?? 'video/mp4');
    } catch {
      setProblem("Couldn't add that video. Try again.");
    }
  }

  async function note(videoId: string, text: string) {
    try {
      await ok(api.client.PATCH('/api/v1/me/videos/{video_id}', { params: { path: { video_id: videoId } }, body: { note: text } }));
    } catch (error) {
      setProblem(error instanceof ApiError && error.offline ? 'Notes on sent videos need a connection.' : "Couldn't save the note.");
    }
  }

  async function removeSent(videoId: string) {
    if (!(await confirm('Remove this video?', `${coach} won't see it.`, 'Remove'))) return;
    try {
      await ok(api.client.DELETE('/api/v1/me/videos/{video_id}', { params: { path: { video_id: videoId } } }));
    } catch (error) {
      setProblem(error instanceof ApiError && error.offline ? 'Removing a sent video needs a connection.' : error instanceof ApiError ? error.message : "Couldn't remove it.");
    }
  }

  return (
    <View style={styles.list}>
      {sent.map((v) => (
        <Row
          key={v.id}
          title={`Form video${v.reviewed_at ? ` · reviewed by ${coach}` : ''}`}
          detail={
            v.deleted_at
              ? 'Removed after 90 days'
              : v.reviewed_at
                ? `${coach}'s feedback is in your messages`
                : `Sent ${ago(localDate(v.uploaded_at!, profile.timezone), today)}. ${coach} will review it`
          }
          onRemove={!v.reviewed_at && !v.deleted_at && editable ? () => removeSent(v.id) : undefined}
        >
          {!v.reviewed_at && editable ? (
            <TextInput
              accessibilityLabel={`Note for ${coach}`}
              defaultValue={v.note}
              placeholder={`What should ${coach} look at?`}
              placeholderTextColor={colors.ink4}
              maxLength={300}
              onEndEditing={(e) => e.nativeEvent.text !== v.note && note(v.id, e.nativeEvent.text)}
              style={styles.note}
            />
          ) : v.note ? (
            <Text variant="tiny">“{v.note}”</Text>
          ) : null}
        </Row>
      ))}
      {uploads.map((u) => (
        <Row
          key={u.id}
          title="Form video"
          tone={u.state === 'refused' ? 'bad' : undefined}
          detail={u.state === 'refused' ? (u.error ?? "It couldn't be sent.") : u.state === 'uploading' ? 'Uploading…' : "Waiting to upload. It goes when you're online"}
          onRemove={() => videos.remove(u.id)}
        >
          {u.state !== 'refused' ? (
            <TextInput
              accessibilityLabel={`Note for ${coach}`}
              defaultValue={u.note}
              placeholder={`What should ${coach} look at?`}
              placeholderTextColor={colors.ink4}
              maxLength={300}
              onEndEditing={(e) => videos.setNote(u.id, e.nativeEvent.text)}
              style={styles.note}
            />
          ) : null}
        </Row>
      ))}
      {editable && room > 0 ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`Add a form video for ${coach}`} onPress={() => setChoosing(true)} style={styles.row}>
          <View style={styles.icon}>
            <Text style={{ color: colors.white, fontSize: 11 }}>▶</Text>
          </View>
          <View style={styles.text}>
            <Text variant="small" style={styles.bold}>
              Add a form video for {coach}
            </Text>
            <Text variant="tiny" tone="muted">
              Record or upload, for review between sessions
            </Text>
          </View>
          <Text tone="muted">+</Text>
        </Pressable>
      ) : null}
      {problem ? (
        <Text variant="tiny" tone="bad" accessibilityRole="alert">
          {problem}
        </Text>
      ) : null}
      <Sheet open={choosing} onClose={() => setChoosing(false)} title="Form video">
        <View style={{ gap: space.s }}>
          {Platform.OS !== 'web' ? <Button title="Record a video" block onPress={() => pick(true)} /> : null}
          <Button title={Platform.OS === 'web' ? 'Choose a video' : 'Choose from your library'} variant="ghost" block onPress={() => pick(false)} />
          {!videos.lasting ? (
            <Text variant="tiny" tone="muted">
              On the web a video uploads straight away, so it needs a connection.
            </Text>
          ) : null}
        </View>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.m, borderWidth: 1, borderColor: colors.line, borderRadius: radius.m, padding: space.m },
  icon: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#7B4FD8', alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, minWidth: 0, gap: 2 },
  bold: { fontFamily: fonts.bold },
  note: { marginTop: 4, borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, fontSize: 12.5, color: colors.ink, fontFamily: fonts.regular },
});
