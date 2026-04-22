import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useEffect, useState } from 'react';
import {
  type StyleProp,
  Pressable,
  StyleSheet,
  TextInput,
  type TextInputProps,
  View,
  type ViewStyle,
} from 'react-native';

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';

type Props = Omit<TextInputProps, 'secureTextEntry'> & {
  borderColor: string;
  /** Overrides default (theme tint) when you need a custom color. */
  toggleIconColor?: string;
  containerStyle?: StyleProp<ViewStyle>;
};

/**
 * Single-line secret input with optional view/hide. Toggle only appears when the value is a real secret (not the
 * •••• placeholder for an already-stored key).
 */
export function SecureTextField({
  value,
  borderColor,
  toggleIconColor,
  containerStyle,
  style,
  ...rest
}: Props) {
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const eyeColor = toggleIconColor ?? theme.tint;

  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!value) setVisible(false);
  }, [value]);

  const isPlaceholderMask = typeof value === 'string' && value.startsWith('••');
  const showToggle = !!value && !isPlaceholderMask;
  const obscure = showToggle && !visible;

  return (
    <View style={[styles.wrap, containerStyle]}>
      <TextInput
        value={value}
        secureTextEntry={obscure}
        style={[styles.input, { borderColor }, style]}
        {...rest}
      />
      {showToggle ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={visible ? 'Hide secret' : 'Show secret'}
          hitSlop={8}
          onPress={() => setVisible((v) => !v)}
          style={styles.eye}>
          <FontAwesome name={visible ? 'eye-slash' : 'eye'} size={18} color={eyeColor} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'relative',
    marginBottom: 12,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    paddingRight: 48,
    fontSize: 16,
  },
  eye: {
    position: 'absolute',
    right: 10,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
});
