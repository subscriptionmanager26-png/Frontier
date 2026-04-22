import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Pressable, StyleSheet } from 'react-native';

type Props = {
  onPress: () => void;
  color: string;
  icon?: 'chevron-left' | 'times';
  accessibilityLabel?: string;
};

export function HeaderIconButton({
  onPress,
  color,
  icon = 'chevron-left',
  accessibilityLabel = icon === 'times' ? 'Close' : 'Back',
}: Props) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={12}
      style={styles.button}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}>
      <FontAwesome name={icon} size={18} color={color} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { paddingHorizontal: 8, paddingVertical: 4 },
});
