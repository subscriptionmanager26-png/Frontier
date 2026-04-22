import { StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import type { WeatherForecastProps } from '@/lib/agent/tools';

export function WeatherForecast(props: WeatherForecastProps) {
  const { location, currentTempC, condition, forecast } = props;
  const colors = Colors[useColorScheme() ?? 'light'];
  return (
    <View style={[styles.card, { borderColor: colors.border }]}>
      <Text style={styles.location}>{location}</Text>
      <Text style={styles.current}>{Math.round(currentTempC)}°C</Text>
      <Text style={[styles.cond, { color: colors.mutedText }]}>{condition}</Text>
      <View style={styles.days}>
        {forecast.slice(0, 5).map((d) => (
          <View key={`${d.day}-${d.condition}`} style={[styles.day, { borderColor: colors.border }]}>
            <Text style={styles.dayName}>{d.day}</Text>
            <Text style={styles.dayCond}>{d.condition}</Text>
            <Text style={styles.dayTemp}>
              {Math.round(d.highC)}° / {Math.round(d.lowC)}°
            </Text>
            <Text style={[styles.dayRain, { color: colors.mutedText }]}>
              Rain: {Math.round(d.rainChancePct ?? 0)}%
            </Text>
          </View>
        ))}
      </View>
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
  location: { fontSize: 16, fontWeight: '700' },
  current: { marginTop: 6, fontSize: 28, fontWeight: '700' },
  cond: { marginTop: 2, fontSize: 13 },
  days: { marginTop: 10, gap: 8 },
  day: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    padding: 8,
  },
  dayName: { fontSize: 13, fontWeight: '700' },
  dayCond: { marginTop: 2, fontSize: 12 },
  dayTemp: { marginTop: 2, fontSize: 12, fontWeight: '600' },
  dayRain: { marginTop: 2, fontSize: 11 },
});
