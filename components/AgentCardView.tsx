import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useMemo, useState } from 'react';
import {
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  UIManager,
  View,
} from 'react-native';

import { Text } from '@/components/Themed';
import {
  parseAgentCard,
  type ParsedAgentCard,
  type ParsedAgentSkill,
} from '@/lib/a2a/parseAgentCard';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type Palette = {
  text: string;
  mutedText: string;
  tint: string;
  border: string;
  engagement: string;
};

type Props = {
  doc: unknown;
  /** Used when the card omits a canonical URL. */
  fallbackUrl?: string;
  colors: Palette;
};

function dash(v: string): string {
  return v.trim() ? v : '—';
}

function CapRow({
  label,
  on,
  colors,
}: {
  label: string;
  on: boolean | undefined;
  colors: Palette;
}) {
  const active = on === true;
  const inactive = on === false;
  return (
    <View style={styles.capRow}>
      <Text style={[styles.capLabel, { color: colors.mutedText }]}>{label}</Text>
      <Text
        style={[
          styles.capValue,
          { color: active ? colors.tint : inactive ? colors.mutedText : colors.mutedText },
        ]}>
        {on === undefined ? '—' : active ? 'Yes' : 'No'}
      </Text>
    </View>
  );
}

export function AgentCardView({ doc, fallbackUrl, colors }: Props) {
  const card: ParsedAgentCard = useMemo(() => parseAgentCard(doc, fallbackUrl), [doc, fallbackUrl]);

  return (
    <View style={styles.root}>
      <Text style={[styles.sectionTitle, { color: colors.mutedText }]}>Header</Text>
      <Field label="Agent name" value={dash(card.name)} colors={colors} />
      <Field label="Company" value={dash(card.organization)} colors={colors} />
      <Field label="Description" value={dash(card.description)} colors={colors} multiline />
      <Field label="URL" value={dash(card.url)} colors={colors} mono selectable />
      <Field label="Version" value={dash(card.version)} colors={colors} />

      <Text style={[styles.sectionTitle, { color: colors.mutedText, marginTop: 18 }]}>Capability flags</Text>
      <View style={[styles.capBlock, { borderColor: colors.border }]}>
        <CapRow label="Streaming" on={card.capabilities.streaming} colors={colors} />
        <CapRow label="Push notifications" on={card.capabilities.pushNotifications} colors={colors} />
        <CapRow label="State transition history" on={card.capabilities.stateTransitionHistory} colors={colors} />
      </View>

      <Text style={[styles.sectionTitle, { color: colors.mutedText, marginTop: 18 }]}>Skills</Text>
      {card.skills.length === 0 ? (
        <Text style={[styles.emptyLine, { color: colors.mutedText }]}>No skills listed.</Text>
      ) : (
        <SkillsAccordion skills={card.skills} colors={colors} />
      )}

      <Text style={[styles.sectionTitle, { color: colors.mutedText, marginTop: 18 }]}>Interfaces</Text>
      {card.interfaces.length === 0 ? (
        <Text style={[styles.emptyLine, { color: colors.mutedText }]}>No interfaces listed.</Text>
      ) : (
        card.interfaces.map((iface, i) => (
          <View
            key={`${iface.url}-${i}`}
            style={[styles.ifaceCard, { borderColor: colors.border, backgroundColor: colors.engagement }]}>
            <Field label="URL" value={dash(iface.url)} colors={colors} small mono selectable />
            <Field label="Protocol" value={dash(iface.protocolBinding)} colors={colors} small />
            <Field label="Version" value={dash(iface.protocolVersion)} colors={colors} small />
          </View>
        ))
      )}

      <Text style={[styles.sectionTitle, { color: colors.mutedText, marginTop: 18 }]}>Auth</Text>
      <Text style={[styles.footerAuth, { color: colors.text }]}>
        {card.securitySchemeKeys.length
          ? card.securitySchemeKeys.join(', ')
          : '—'}
      </Text>
      <Text style={[styles.footerHint, { color: colors.mutedText }]}>
        Keys from <Text style={{ fontFamily: 'monospace' }}>securitySchemes</Text>
      </Text>
    </View>
  );
}

function skillSummaryLabel(s: ParsedAgentSkill, index: number): string {
  const name = s.name.trim();
  const id = s.id.trim();
  if (name) return name;
  if (id) return id;
  return `Skill ${index + 1}`;
}

function SkillsAccordion({ skills, colors }: { skills: ParsedAgentSkill[]; colors: Palette }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <>
      {skills.map((s, i) => {
        const key = `${s.id || s.name || i}-${i}`;
        const expanded = openIndex === i;
        const summary = skillSummaryLabel(s, i);
        return (
          <View
            key={key}
            style={[
              styles.skillAccordion,
              { borderColor: colors.border, backgroundColor: colors.engagement },
            ]}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded }}
              accessibilityLabel={`${summary}. ${expanded ? 'Collapse' : 'Expand'} skill details.`}
              onPress={() => {
                LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                setOpenIndex((prev) => (prev === i ? null : i));
              }}
              style={({ pressed }) => [
                styles.skillAccordionHeader,
                pressed && { opacity: 0.75 },
              ]}>
              <Text style={[styles.skillAccordionTitle, { color: colors.text }]} numberOfLines={2}>
                {summary}
              </Text>
              <FontAwesome
                name={expanded ? 'chevron-up' : 'chevron-down'}
                size={14}
                color={colors.mutedText}
              />
            </Pressable>
            {expanded ? (
              <View style={styles.skillAccordionBody}>
                <Field label="Skill ID" value={dash(s.id)} colors={colors} small />
                <Field label="Skill name" value={dash(s.name)} colors={colors} small />
                <Field label="Description" value={dash(s.description)} colors={colors} small multiline />
                <Field
                  label="Tags"
                  value={s.tags.length ? s.tags.join(', ') : '—'}
                  colors={colors}
                  small
                />
                <Field label="Example" value={dash(s.example)} colors={colors} small multiline mono selectable />
              </View>
            ) : null}
          </View>
        );
      })}
    </>
  );
}

function Field({
  label,
  value,
  colors,
  multiline,
  mono,
  selectable,
  small,
}: {
  label: string;
  value: string;
  colors: Palette;
  multiline?: boolean;
  mono?: boolean;
  selectable?: boolean;
  small?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={[small ? styles.fieldLabelSmall : styles.fieldLabel, { color: colors.mutedText }]}>{label}</Text>
      <Text
        style={[
          small ? styles.fieldValueSmall : styles.fieldValue,
          { color: colors.text },
          mono ? styles.mono : null,
        ]}
        selectable={selectable}
        numberOfLines={multiline ? undefined : 4}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { paddingBottom: 8 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  field: { marginBottom: 12 },
  fieldLabel: { fontSize: 12, fontWeight: '600', marginBottom: 4 },
  fieldLabelSmall: { fontSize: 11, fontWeight: '600', marginBottom: 3 },
  fieldValue: { fontSize: 15, lineHeight: 22 },
  fieldValueSmall: { fontSize: 14, lineHeight: 20 },
  mono: { fontFamily: 'monospace', fontSize: 13, lineHeight: 19 },
  capBlock: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  capRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  capLabel: { fontSize: 13, flex: 1 },
  capValue: { fontSize: 13, fontWeight: '600' },
  skillAccordion: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    marginBottom: 10,
    overflow: 'hidden',
  },
  skillAccordionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  skillAccordionTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 21,
  },
  skillAccordionBody: {
    paddingHorizontal: 12,
    paddingBottom: 12,
    paddingTop: 0,
  },
  ifaceCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  emptyLine: { fontSize: 14, lineHeight: 20, marginBottom: 4 },
  footerAuth: { fontSize: 15, lineHeight: 22, fontWeight: '600' },
  footerHint: { fontSize: 12, marginTop: 6, lineHeight: 17 },
});
