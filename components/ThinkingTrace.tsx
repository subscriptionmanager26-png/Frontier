import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useCallback, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { TraceStep } from '@/lib/assistantTrace';

type AppColors = {
  text: string;
  tint: string;
  border: string;
  card: string;
  background: string;
};

type Props = {
  steps: TraceStep[];
  colors: AppColors;
  isDark: boolean;
  /** When true, the thinking panel starts expanded (e.g. live stream). */
  defaultOpen?: boolean;
};

const mono = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
});

function stepIcon(kind: TraceStep['kind']): keyof typeof FontAwesome.glyphMap {
  switch (kind) {
    case 'tool':
      return 'wrench';
    case 'model_note':
      return 'lightbulb-o';
    default:
      return 'cog';
  }
}

export function ThinkingTrace({ steps, colors, isDark, defaultOpen = false }: Props) {
  const [panelOpen, setPanelOpen] = useState(defaultOpen);
  const [fullOutputOpen, setFullOutputOpen] = useState<Record<string, boolean>>({});

  const toggleFull = useCallback((id: string) => {
    setFullOutputOpen((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  if (!steps.length) return null;

  const surface = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';
  const monoSurface = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';

  return (
    <View style={[styles.wrap, { borderColor: colors.border, backgroundColor: surface, width: '100%' }]}>
      <Pressable
        onPress={() => setPanelOpen((o) => !o)}
        style={styles.header}
        accessibilityRole="button"
        accessibilityLabel={panelOpen ? 'Collapse thinking' : 'Expand thinking'}>
        <FontAwesome name="lightbulb-o" size={14} color={colors.tint} style={styles.headerIcon} />
        <Text style={[styles.headerTitle, { color: colors.text }]}>Thinking</Text>
        <Text style={[styles.headerMeta, { color: colors.text }]}>{steps.length} steps</Text>
        <FontAwesome
          name={panelOpen ? 'chevron-up' : 'chevron-down'}
          size={12}
          color={colors.text}
          style={{ opacity: 0.5 }}
        />
      </Pressable>

      {panelOpen ? (
        <View style={styles.steps}>
          {steps.map((s) => (
            <View key={s.id} style={styles.step}>
              <View style={styles.stepHead}>
                <FontAwesome
                  name={stepIcon(s.kind)}
                  size={12}
                  color={colors.tint}
                  style={{ marginTop: 2, marginRight: 8, opacity: 0.85 }}
                />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.stepTitle, { color: colors.text }]}>{s.title}</Text>
                  {s.subtitle ? (
                    <Text style={[styles.stepSub, { color: colors.text }]} numberOfLines={4}>
                      {s.subtitle}
                    </Text>
                  ) : null}
                  {s.detail ? (
                    <Text style={[styles.stepDetail, { color: colors.text }]} selectable>
                      {s.detail}
                    </Text>
                  ) : null}
                  {s.outputPreview ? (
                    <View style={[styles.outputBox, { backgroundColor: monoSurface, borderColor: colors.border }]}>
                      {fullOutputOpen[s.id] && s.outputFull ? (
                        <ScrollView
                          style={styles.outputScroll}
                          nestedScrollEnabled
                          keyboardShouldPersistTaps="handled">
                          <Text style={[styles.outputText, { color: colors.text }]} selectable>
                            {s.outputFull}
                          </Text>
                        </ScrollView>
                      ) : (
                        <Text
                          style={[styles.outputText, { color: colors.text }]}
                          selectable
                          numberOfLines={s.outputFull ? 6 : undefined}>
                          {s.outputPreview}
                        </Text>
                      )}
                      {s.outputFull ? (
                        <Pressable onPress={() => toggleFull(s.id)} style={styles.expandBtn}>
                          <Text style={{ color: colors.tint, fontSize: 13, fontWeight: '600' }}>
                            {fullOutputOpen[s.id] ? 'Show less' : 'Show full output'}
                          </Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ) : null}
                </View>
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    marginBottom: 10,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 8,
  },
  headerIcon: { marginRight: 2 },
  headerTitle: { flex: 1, fontSize: 13, fontWeight: '700' },
  headerMeta: { fontSize: 12, opacity: 0.5, marginRight: 4 },
  steps: { paddingHorizontal: 12, paddingBottom: 10, gap: 10 },
  step: { marginBottom: 4 },
  stepHead: { flexDirection: 'row', alignItems: 'flex-start' },
  stepTitle: { fontSize: 13, fontWeight: '600' },
  stepSub: { fontSize: 12, opacity: 0.75, marginTop: 2 },
  stepDetail: { fontSize: 12, opacity: 0.85, marginTop: 4, lineHeight: 18 },
  outputBox: {
    marginTop: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    padding: 8,
    maxHeight: 320,
  },
  outputScroll: { maxHeight: 260 },
  outputText: { fontSize: 11, fontFamily: mono, lineHeight: 16 },
  expandBtn: { marginTop: 8, paddingVertical: 4 },
});
