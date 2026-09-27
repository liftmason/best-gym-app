/** The mockup's sparkline (sparkSVG): a line through the values, dots, a light area, and the top value. */
import { useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Path, Text as SvgText } from 'react-native-svg';

import { colors, fonts } from './theme';

type Props = { values: number[]; height?: number; label?: string; accessibilityLabel: string; colour?: string };

export function Sparkline({ values, height = 120, label, accessibilityLabel, colour = colors.brand }: Props) {
  const [width, setWidth] = useState(0);
  const pad = 12;
  const h = height - 10;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const step = (width - 2 * pad) / Math.max(1, values.length - 1);
  const points = values.map((v, i) => [pad + i * step, h - pad - ((v - lo) / span) * (h - 2 * pad)] as const);
  const line = points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel}>
      {width > 0 && values.length ? (
        <Svg width={width} height={height}>
          <Path d={`${line} L${points[points.length - 1][0]} ${h - 2} L${points[0][0]} ${h - 2} Z`} fill={colour} opacity={0.08} />
          <Path d={line} fill="none" stroke={colour} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
          {points.map(([x, y], i) => (
            <Circle key={i} cx={x} cy={y} r={i === points.length - 1 ? 3.5 : 2.2} fill={colour} />
          ))}
          {label ? (
            <SvgText x={8} y={14} fontSize={10} fill={colors.ink3} fontFamily={fonts.medium}>
              {label}
            </SvgText>
          ) : null}
        </Svg>
      ) : (
        <View style={{ height }} />
      )}
    </View>
  );
}
