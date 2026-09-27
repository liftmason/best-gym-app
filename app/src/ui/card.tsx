import { View, type ViewProps } from 'react-native';

import { colors, radius, shadows, space } from './theme';

/** The mockup's .card: white, a hairline border, large corners, a soft shadow. */
export function Card({ style, padded = true, ...props }: ViewProps & { padded?: boolean }) {
  return (
    <View
      {...props}
      style={[
        {
          backgroundColor: colors.surface,
          borderColor: colors.line,
          borderWidth: 1,
          borderRadius: radius.l,
          padding: padded ? space.l : 0,
        },
        shadows.s1,
        style,
      ]}
    />
  );
}
