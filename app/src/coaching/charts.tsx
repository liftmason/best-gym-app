/**
 * The coach's charts (the mockup's drawE1RM and drawVol), drawn from the API's numbers
 * (already in the gym's unit): e1RM with the training phases behind it and bodyweight
 * dashed; weekly volume as bars with compliance as a line.
 */
import { useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import type { components } from '@/api';
import { colors, fonts, Text, weekTypeColours } from '@/ui';

type Chart = components['schemas']['Chart'];
type Week = components['schemas']['WeekRow'];

function useWidth(): [number, (w: number) => void] {
  return useState(0);
}

export function E1rmChart({ chart, unit }: { chart: Chart; unit: string }) {
  const [width, setWidth] = useWidth();
  const height = 190;
  const pad = { left: 44, right: 12, top: 18, bottom: 30 };
  const points = chart.points;
  const label = chart.lift ? `${chart.lift.name} progress chart` : 'Progress chart';
  if (points.length < 2) {
    return (
      <View style={{ height: 80, justifyContent: 'center' }}>
        <Text variant="small" tone="muted">
          Not enough logged data for this lift yet
        </Text>
      </View>
    );
  }
  const values = points.map((p) => p.e1rm);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const w = Math.max(1, width - pad.left - pad.right);
  const h = height - pad.top - pad.bottom;
  const x = (i: number) => pad.left + (i / (points.length - 1)) * w;
  const y = (v: number) => pad.top + h - ((v - lo) / span) * h;
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.e1rm).toFixed(1)}`).join(' ');
  const bws = points.map((p) => p.bodyweight).filter((b): b is number => b !== null);
  const bwLo = Math.min(...bws);
  const bwSpan = Math.max(...bws) - bwLo || 1;
  const bwY = (v: number) => pad.top + h - ((v - bwLo) / bwSpan) * h * 0.6 - h * 0.2;
  const bwLine = points
    .map((p, i) => (p.bodyweight === null ? null : `${x(i).toFixed(1)} ${bwY(p.bodyweight).toFixed(1)}`))
    .filter(Boolean)
    .map((xy, i) => `${i ? 'L' : 'M'}${xy}`)
    .join(' ');
  const step = w / (points.length - 1);
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} accessible accessibilityRole="image" accessibilityLabel={label}>
      {width ? (
        <Svg width={width} height={height}>
          {chart.bands.map((b, i) => {
            const left = Math.max(pad.left, x(b.first) - step / 2);
            const right = Math.min(pad.left + w, x(b.last) + step / 2);
            const colour = b.week_type.colour;
            return (
              <G key={i}>
                <Rect x={left} y={pad.top} width={right - left} height={h} fill={colour} opacity={0.09} />
                <SvgText x={(left + right) / 2} y={height - 8} fontSize={9} fill={colour} fontFamily={fonts.bold} textAnchor="middle">
                  {b.week_type.name.toUpperCase()}
                </SvgText>
              </G>
            );
          })}
          <Line x1={pad.left} x2={pad.left + w} y1={pad.top + h} y2={pad.top + h} stroke={colors.line} />
          <SvgText x={4} y={pad.top + 4} fontSize={10} fill={colors.ink3} fontFamily={fonts.medium}>
            {`${Math.round(hi)} ${unit}`}
          </SvgText>
          <SvgText x={4} y={pad.top + h} fontSize={10} fill={colors.ink3} fontFamily={fonts.medium}>
            {`${Math.round(lo)} ${unit}`}
          </SvgText>
          {bws.length > 1 ? <Path d={bwLine} fill="none" stroke={colors.ink4} strokeWidth={1.5} strokeDasharray="4 4" /> : null}
          {bws.length ? (
            <SvgText x={width - pad.right} y={12} fontSize={10} fill={colors.ink3} textAnchor="end" fontFamily={fonts.medium}>
              {`bw ${Math.round(bws[bws.length - 1])} ${unit}`}
            </SvgText>
          ) : null}
          <Path d={`${line} L${x(points.length - 1)} ${pad.top + h} L${x(0)} ${pad.top + h} Z`} fill={colors.brand} opacity={0.08} />
          <Path d={line} fill="none" stroke={colors.brand} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
          {points.map((p, i) => (
            <Circle key={i} cx={x(i)} cy={y(p.e1rm)} r={i === points.length - 1 ? 4 : 2.5} fill={colors.brand} />
          ))}
        </Svg>
      ) : (
        <View style={{ height }} />
      )}
    </View>
  );
}

export function VolumeChart({ weeks, unit }: { weeks: Week[]; unit: string }) {
  const [width, setWidth] = useWidth();
  const height = 150;
  const pad = { left: 8, right: 8, top: 14, bottom: 22 };
  if (!weeks.length) return null;
  const w = Math.max(1, width - pad.left - pad.right);
  const h = height - pad.top - pad.bottom;
  const most = Math.max(...weeks.map((wk) => wk.volume), 1);
  const slot = w / weeks.length;
  const bar = slot * 0.55;
  const cx = (i: number) => pad.left + slot * i + slot / 2;
  const compliance = weeks
    .map((wk, i) => (wk.compliance === null ? null : `${cx(i).toFixed(1)} ${(pad.top + h - (wk.compliance / 100) * h).toFixed(1)}`))
    .filter(Boolean)
    .map((xy, i) => `${i ? 'L' : 'M'}${xy}`)
    .join(' ');
  const tint = weekTypeColours(colors.good).light;
  return (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Weekly volume and compliance, last ${weeks.length} weeks`}
    >
      {width ? (
        <Svg width={width} height={height}>
          {weeks.map((wk, i) => {
            const bh = (wk.volume / most) * h;
            return (
              <G key={wk.week_start}>
                <Rect x={cx(i) - bar / 2} y={pad.top + h - bh} width={bar} height={bh} rx={3} fill={tint} stroke={colors.good} strokeWidth={1} />
                <SvgText x={cx(i)} y={height - 6} fontSize={9} fill={colors.ink4} textAnchor="middle" fontFamily={fonts.medium}>
                  {`w${i + 1}`}
                </SvgText>
              </G>
            );
          })}
          {compliance ? <Path d={compliance} fill="none" stroke={colors.brand} strokeWidth={2} /> : null}
          <SvgText x={pad.left} y={10} fontSize={9} fill={colors.ink3} fontFamily={fonts.medium}>
            {`volume (k·${unit}) · compliance %`}
          </SvgText>
        </Svg>
      ) : (
        <View style={{ height }} />
      )}
    </View>
  );
}
