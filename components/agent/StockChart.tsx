import { StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import type { StockChartProps } from '@/lib/agent/tools';

export function StockChart(props: StockChartProps) {
  const { ticker, price, changePct, period, ohlcv = [] } = props;
  const colors = Colors[useColorScheme() ?? 'light'];
  const up = changePct >= 0;
  const priceText = Number.isFinite(price) ? price.toLocaleString('en-IN') : String(price);

  return (
    <View style={[styles.card, { borderColor: colors.border }]}>
      <View style={styles.row}>
        <Text style={styles.ticker}>{ticker}</Text>
        <Text style={[styles.delta, { color: up ? '#22c55e' : '#ef4444' }]}>
          {up ? '+' : ''}
          {changePct.toFixed(2)}%
        </Text>
      </View>
      <Text style={styles.price}>₹{priceText}</Text>
      <Text style={[styles.period, { color: colors.mutedText }]}>Period: {period}</Text>
      {ohlcv.length > 0 ? (
        <View style={[styles.table, { borderColor: colors.border }]}>
          {ohlcv.slice(0, 6).map((p) => (
            <View key={`${p.t}-${p.c}`} style={styles.tableRow}>
              <Text style={[styles.cell, { color: colors.mutedText }]}>{p.t}</Text>
              <Text style={styles.cell}>O:{p.o.toFixed(2)}</Text>
              <Text style={styles.cell}>H:{p.h.toFixed(2)}</Text>
              <Text style={styles.cell}>L:{p.l.toFixed(2)}</Text>
              <Text style={styles.cell}>C:{p.c.toFixed(2)}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  ticker: { fontSize: 16, fontWeight: '700' },
  delta: { fontSize: 14, fontWeight: '700' },
  price: { marginTop: 8, fontSize: 22, fontWeight: '700' },
  period: { marginTop: 4, fontSize: 12 },
  table: { marginTop: 10, borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, padding: 8 },
  tableRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4, gap: 6 },
  cell: { fontSize: 11 },
});
