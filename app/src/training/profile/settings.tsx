/** The athlete's settings that need the server: units, who sees earlier history, devices. */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';

import { api, ApiError, ok } from '@/api';
import { ME } from '@/auth/me';
import { Button, Card, colors, fonts, radius, space, Text } from '@/ui';

import { dayMonth } from '../format';

const failed = (error: unknown) =>
  error instanceof ApiError && error.offline ? 'This needs a connection.' : error instanceof ApiError ? error.message : "Couldn't save. Try again.";

export function Settings({ units, hideHistory, coachName }: { units: 'kg' | 'lb'; hideHistory: boolean; coachName: string | null }) {
  const queryClient = useQueryClient();
  const [problem, setProblem] = useState<string | null>(null);
  const devices = useQuery({ queryKey: ['devices'], queryFn: () => ok(api.client.GET('/api/v1/auth/devices')) });

  async function change(call: () => Promise<unknown>) {
    setProblem(null);
    try {
      await call();
      await queryClient.invalidateQueries({ queryKey: ME });
    } catch (error) {
      setProblem(failed(error));
    }
  }

  return (
    <Card style={{ gap: space.m }}>
      <Text variant="h4">Settings</Text>
      <View style={styles.row}>
        <Text variant="small" style={styles.grow}>
          Weights in
        </Text>
        {(['kg', 'lb'] as const).map((u) => (
          <Pressable
            key={u}
            accessibilityRole="radio"
            accessibilityState={{ checked: units === u }}
            accessibilityLabel={u === 'kg' ? 'Kilograms' : 'Pounds'}
            onPress={() => units !== u && change(() => ok(api.client.PUT('/api/v1/me/units', { body: { units: u } })))}
            style={[styles.unit, units === u && styles.unitOn]}
          >
            <Text style={[styles.unitText, units === u && { color: colors.white }]}>{u}</Text>
          </Pressable>
        ))}
      </View>
      {coachName ? (
        <View style={styles.row}>
          <Text variant="small" style={styles.grow}>
            Hide my history from before I joined {coachName}
          </Text>
          <Switch
            accessibilityLabel={`Hide my history from before I joined ${coachName}`}
            value={hideHistory}
            onValueChange={(hide) => change(() => ok(api.client.PUT('/api/v1/me/history-visibility', { body: { hide } })))}
          />
        </View>
      ) : null}
      <Text variant="label" tone="muted">
        Signed in on
      </Text>
      {devices.data?.map((d) => (
        <View key={d.id} style={styles.row}>
          <View style={styles.grow}>
            <Text variant="small" style={{ fontFamily: fonts.semibold }}>
              {d.label || 'A device'}
              {d.current ? ' (this one)' : ''}
            </Text>
            <Text variant="tiny" tone="muted">
              Last used {dayMonth(d.last_used_at.slice(0, 10))}
            </Text>
          </View>
          {d.current ? null : (
            <Button
              title="Sign out"
              variant="ghost"
              size="sm"
              onPress={() =>
                change(async () => {
                  await ok(api.client.POST('/api/v1/auth/devices/{device_id}/signout', { params: { path: { device_id: d.id } } }));
                  await devices.refetch();
                })
              }
            />
          )}
        </View>
      ))}
      {devices.isError ? (
        <Text variant="tiny" tone="muted">
          {failed(devices.error)}
        </Text>
      ) : null}
      {problem ? (
        <Text variant="small" tone="bad" accessibilityRole="alert">
          {problem}
        </Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  grow: { flex: 1 },
  unit: { borderWidth: 1.5, borderColor: colors.line, borderRadius: radius.m, paddingVertical: 6, paddingHorizontal: 14 },
  unitOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  unitText: { fontFamily: fonts.bold },
});
