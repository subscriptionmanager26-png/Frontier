import { Linking, Pressable, StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import type { ProductCardProps } from '@/lib/agent/tools';

export function ProductCard(props: ProductCardProps) {
  const { name, brand, price, rating, inStock, url } = props;
  const colors = Colors[useColorScheme() ?? 'light'];
  const onOpen = async () => {
    if (url) await Linking.openURL(url);
  };
  return (
    <Pressable
      disabled={!url}
      onPress={onOpen}
      style={[styles.card, { borderColor: colors.border, opacity: inStock ? 1 : 0.8 }]}>
      <Text style={styles.name}>{name}</Text>
      <Text style={[styles.brand, { color: colors.mutedText }]}>{brand}</Text>
      <View style={styles.row}>
        <Text style={styles.price}>₹{price.toLocaleString('en-IN')}</Text>
        <Text style={[styles.stock, { color: inStock ? '#22c55e' : '#ef4444' }]}>
          {inStock ? 'In stock' : 'Out of stock'}
        </Text>
      </View>
      {typeof rating === 'number' ? <Text style={styles.rating}>Rating: {rating.toFixed(1)} / 5</Text> : null}
      {url ? (
        <View style={styles.footer}>
          <Text style={{ color: colors.tint, fontWeight: '600' }}>View product</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
  },
  name: { fontSize: 15, fontWeight: '700' },
  brand: { marginTop: 4, fontSize: 12 },
  row: { marginTop: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  price: { fontSize: 20, fontWeight: '700' },
  stock: { fontSize: 12, fontWeight: '700' },
  rating: { marginTop: 4, fontSize: 12 },
  footer: { marginTop: 10, alignItems: 'flex-start' },
});
