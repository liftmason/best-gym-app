/** Watching a form video and marking it reviewed, with feedback that reaches the athlete as a message (decision F). */
import { useQuery } from '@tanstack/react-query';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useState } from 'react';
import { View } from 'react-native';

import { api, ApiError, ok, type components } from '@/api';
import { Button, Field, Sheet, space, Text } from '@/ui';

type Video = components['schemas']['Video'];

function Player({ url }: { url: string }) {
  const player = useVideoPlayer(url, (p) => {
    p.loop = false;
  });
  return <VideoView player={player} style={{ width: '100%', aspectRatio: 9 / 16, maxHeight: 420, backgroundColor: '#000', borderRadius: 12 }} nativeControls contentFit="contain" />;
}

export function VideoSheet({
  athleteId,
  video,
  first,
  onClose,
  onReviewed,
}: {
  athleteId: string;
  video: Video | null;
  first: string;
  onClose: () => void;
  onReviewed: () => void;
}) {
  const [feedback, setFeedback] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const url = useQuery({
    queryKey: ['coach', 'video', video?.id],
    queryFn: () => ok(api.client.GET('/api/v1/athletes/{athlete_id}/videos/{video_id}', { params: { path: { athlete_id: athleteId, video_id: video!.id } } })),
    enabled: Boolean(video?.available),
    staleTime: 5 * 60_000, // signed links last a while; fetch a fresh one each time the sheet opens after that
  });
  if (!video) return null;

  async function review() {
    setBusy(true);
    setProblem(null);
    try {
      await ok(
        api.client.POST('/api/v1/athletes/{athlete_id}/videos/{video_id}/review', {
          params: { path: { athlete_id: athleteId, video_id: video!.id } },
          body: { feedback: feedback.trim() },
        }),
      );
      setFeedback('');
      onReviewed();
      onClose();
    } catch (error) {
      setProblem(error instanceof ApiError ? error.message : "Couldn't save the review.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={`Form video · ${video.exercise}`}
      footer={video.reviewed ? undefined : <Button title="Mark reviewed" block busy={busy} onPress={review} />}
    >
      <View style={{ gap: space.m }}>
        {video.available ? (
          url.data ? (
            <Player url={url.data.url} />
          ) : (
            <Text variant="small" tone="muted">
              {url.error ? "Couldn't load the video." : 'Loading the video…'}
            </Text>
          )
        ) : (
          <Text variant="small" tone="muted">
            Removed after 90 days.
          </Text>
        )}
        {video.note ? <Text variant="small">“{video.note}”</Text> : null}
        {video.reviewed ? (
          <Text variant="small" tone="muted">
            Reviewed{video.feedback ? `: ${video.feedback}` : '.'}
          </Text>
        ) : (
          <Field
            label={`Feedback for ${first} (optional)`}
            value={feedback}
            onChangeText={setFeedback}
            multiline
            maxLength={4000}
            placeholder="It goes to them as a message."
            error={problem}
          />
        )}
      </View>
    </Sheet>
  );
}
