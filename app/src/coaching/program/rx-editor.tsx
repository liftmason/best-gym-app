/**
 * Editing one exercise on the board (the old _rx_modal.html): its dose, with the suggested
 * weight when the load is a percentage; swapping it for a similar exercise (the dose carries
 * over); removing it.
 */
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ApiError } from '@/api';
import { dayMonth } from '@/training/format';
import { Button, colors, fonts, Sheet, Text } from '@/ui';

import type { ProgramCommands } from './commands';
import { DoseFields, fitRows } from './dose-form';
import { usePrescription, type Dose, type Item, type Prescription } from './queries';

type Props = { athleteId: string; item: Item | null; date: string; unit: string; readOnly: boolean; commands: ProgramCommands; onClose: () => void };

export function RxEditor(props: Props) {
  const rx = usePrescription(props.athleteId, props.item?.id ?? null);
  // Keyed on what was loaded, so the form starts from the saved dose each time.
  return <RxSheet key={`${props.item?.id ?? ''}:${rx.dataUpdatedAt}`} {...props} loaded={rx.data} />;
}

function RxSheet({ item, date, unit, readOnly, commands, onClose, loaded }: Props & { loaded: Prescription | undefined }) {
  const [dose, setDose] = useState<Dose | null>(loaded?.dose ?? null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [swapping, setSwapping] = useState(false);
  const [busy, setBusy] = useState(false);
  const rx = { data: loaded };

  const name = rx.data?.exercise.name ?? item?.exercise.name ?? '';

  async function save() {
    if (!dose || !rx.data) return;
    setBusy(true);
    try {
      await commands.edit(rx.data, { ...dose, set_rows: dose.vary ? fitRows(dose, dose.sets) : [] });
      onClose();
    } catch (error) {
      if (error instanceof ApiError) setErrors(Object.keys(error.fields).length ? error.fields : { '': error.message });
      else setErrors({ '': 'Something went wrong. Try again.' });
    } finally {
      setBusy(false);
    }
  }

  async function swap(to: { id: string; name: string }) {
    if (!rx.data) return;
    if (await commands.swap(rx.data, to)) onClose();
  }

  async function remove() {
    if (!item) return;
    if ((await commands.remove(item, date)) !== undefined) onClose();
  }

  return (
    <Sheet
      open={Boolean(item)}
      onClose={onClose}
      title={item ? `${name} — ${date ? dayMonth(date) : ''}` : ''}
      footer={
        swapping ? (
          <Button size="sm" variant="ghost" title="← Back" onPress={() => setSwapping(false)} />
        ) : (
          <>
            <Button size="sm" variant="danger" title="Remove from day" disabled={readOnly} onPress={remove} />
            <Button size="sm" variant="ghost" title="Swap exercise" disabled={readOnly || !rx.data} onPress={() => setSwapping(true)} />
            <View style={{ flex: 1 }} />
            <Button size="sm" variant="ghost" title="Cancel" onPress={onClose} />
            <Button size="sm" title="Save" busy={busy} disabled={readOnly || !dose} onPress={save} />
          </>
        )
      }
    >
      {!rx.data || !dose ? (
        <ActivityIndicator color={colors.brand} />
      ) : swapping ? (
        <View style={{ gap: 10 }}>
          <Text variant="small" tone="muted">
            {item?.tag_slot ? 'Exercises carrying every tag of this slot.' : 'Same category or a shared tag, most recently done first.'} The dose carries over.
          </Text>
          {rx.data.swaps.length ? (
            rx.data.swaps.map((e) => (
              <Pressable key={e.id} accessibilityRole="button" accessibilityLabel={`Use ${e.name}`} onPress={() => swap(e)} style={styles.swap}>
                <Text style={{ fontFamily: fonts.semibold, flex: 1 }}>{e.name}</Text>
                <Text variant="small" tone="brand" style={{ fontFamily: fonts.semibold }}>
                  Use
                </Text>
              </Pressable>
            ))
          ) : (
            <Text variant="small" tone="muted">
              No alternatives in the library share its category or tags.
            </Text>
          )}
        </View>
      ) : (
        <>
          {rx.data.suggested ? (
            <View style={styles.hint}>
              <Text variant="small" tone="brand">
                {rx.data.suggested}
              </Text>
            </View>
          ) : null}
          <DoseFields dose={dose} onChange={setDose} errors={errors} unit={unit} />
        </>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  hint: { backgroundColor: colors.brandLight, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12 },
  swap: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.line },
});
