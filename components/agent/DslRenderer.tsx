import { memo, useState, type ReactElement } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { parseDsl, type ParsedDsl } from '@/lib/dslUi';

type Value = string | number | boolean | null | { __ref: string } | Value[];

function isRef(v: Value): v is { __ref: string } {
  return !!v && typeof v === 'object' && !Array.isArray(v) && '__ref' in v;
}

function asArray(v: Value | undefined): Value[] {
  return Array.isArray(v) ? v : [];
}

function DslRendererImpl({ dsl }: { dsl: string }) {
  const scheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const [tabState, setTabState] = useState<Record<string, number>>({});
  const palette = {
    bg: colors.background,
    fg: colors.text,
    muted: colors.mutedText,
    border: colors.border,
    surface: scheme === 'dark' ? '#171717' : '#ffffff',
    surfaceAlt: scheme === 'dark' ? '#111827' : '#F8FAFC',
    primary: colors.tint,
    success: '#16A34A',
    danger: '#DC2626',
    info: '#2563EB',
  };
  const parsed = parseDsl(dsl);
  if (!parsed) {
    return <Text style={{ color: colors.mutedText }}>Invalid UI payload. Showing text fallback.</Text>;
  }

  const renderRef = (ref: string, p: ParsedDsl): ReactElement | null => {
    const node = p.nodes[ref];
    if (!node) return null;
    const resolve = (v: Value): Value => {
      if (isRef(v) && p.vars[v.__ref] !== undefined) return p.vars[v.__ref]!;
      return v;
    };
    const args = node.args.map(resolve);
    const childrenFromRefs = (v: Value | undefined) =>
      asArray(v).map((x, i) => {
        if (isRef(x)) return <View key={`${ref}-${i}`}>{renderRef(x.__ref, p)}</View>;
        return <Text key={`${ref}-${i}`}>{String(x ?? '')}</Text>;
      });

    const variant = String(args[1] ?? '').toLowerCase();

    switch (node.component) {
      case 'Stack':
        return <View style={styles.stack}>{childrenFromRefs(args[0])}</View>;
      case 'Card': {
        const childRefs = asArray(args[0]).filter(isRef);
        const headerRefs: string[] = [];
        const bodyRefs: string[] = [];
        const footerRefs: string[] = [];
        for (const r of childRefs) {
          const n = p.nodes[r.__ref];
          if (!n) continue;
          if (n.component === 'Card.Title') headerRefs.push(r.__ref);
          else if (n.component === 'Card.Footer') footerRefs.push(r.__ref);
          else bodyRefs.push(r.__ref);
        }
        const v =
          variant === 'secondary'
            ? 'secondary'
            : variant === 'tertiary'
              ? 'tertiary'
              : variant === 'outline'
                ? 'outline'
                : variant === 'transparent'
                  ? 'transparent'
                  : 'default';
        const cardSurface =
          v === 'secondary'
            ? palette.surfaceAlt
            : v === 'tertiary'
              ? scheme === 'dark'
                ? '#0f172a'
                : '#F1F5F9'
              : v === 'outline' || v === 'transparent'
                ? 'transparent'
                : palette.surface;
        const cardBorder =
          v === 'transparent' ? 'transparent' : v === 'outline' ? palette.border : palette.border;
        const cardBorderWidth = v === 'transparent' ? 0 : 1;
        const shadowStyle = v === 'transparent' || v === 'outline' ? styles.cardShadowNone : styles.cardShadowSm;
        return (
          <View
            style={[
              styles.cardBase,
              shadowStyle,
              {
                borderColor: cardBorder,
                borderWidth: cardBorderWidth,
                backgroundColor: cardSurface,
              },
            ]}>
            {headerRefs.length > 0 ? (
              <View style={styles.cardHeader}>{headerRefs.map((id) => <View key={id}>{renderRef(id, p)}</View>)}</View>
            ) : null}
            {bodyRefs.length > 0 ? (
              <View style={styles.cardBody}>{bodyRefs.map((id) => <View key={id}>{renderRef(id, p)}</View>)}</View>
            ) : null}
            {footerRefs.length > 0 ? (
              <View style={styles.cardFooter}>{footerRefs.map((id) => <View key={id}>{renderRef(id, p)}</View>)}</View>
            ) : null}
          </View>
        );
      }
      case 'Card.Title':
        return <Text style={[styles.cardTitle, styles.fontSemi, { color: palette.fg }]}>{String(args[0] ?? '')}</Text>;
      case 'Card.Description':
        return <Text style={[styles.cardDesc, styles.fontRegular, { color: palette.muted }]}>{String(args[0] ?? '')}</Text>;
      case 'Card.Footer':
        return <View style={styles.cardFooterInner}>{childrenFromRefs(args[0])}</View>;
      case 'Button':
        {
          const buttonVariant = String(args[1] ?? 'primary').toLowerCase();
          const btnStyle =
            buttonVariant === 'secondary'
              ? [styles.btn, { backgroundColor: palette.surfaceAlt, borderWidth: 1, borderColor: palette.border }]
              : buttonVariant === 'ghost'
                ? [styles.btn, { backgroundColor: 'transparent', borderWidth: 1, borderColor: palette.border }]
                : buttonVariant === 'danger'
                  ? [styles.btn, { backgroundColor: palette.danger }]
                  : [styles.btn, { backgroundColor: palette.primary }];
          const textColor = buttonVariant === 'secondary' || buttonVariant === 'ghost' ? palette.fg : '#fff';
          return (
            <Pressable style={btnStyle}>
              <Text style={[styles.btnText, styles.fontSemi, { color: textColor }]}>{String(args[0] ?? 'Action')}</Text>
            </Pressable>
          );
        }
      case 'Alert': {
        const alertVariant = String(args[2] ?? 'info').toLowerCase();
        const tone =
          alertVariant === 'success'
            ? palette.success
            : alertVariant === 'danger'
              ? palette.danger
              : palette.info;
        return (
          <View style={[styles.alert, { borderColor: tone, backgroundColor: palette.surface }]}>
            <View style={[styles.alertPill, { backgroundColor: tone }]} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.cardTitle, styles.fontSemi, { color: palette.fg }]}>{String(args[0] ?? 'Alert')}</Text>
              <Text style={[styles.cardDesc, styles.fontRegular, { color: palette.muted }]}>{String(args[1] ?? '')}</Text>
            </View>
          </View>
        );
      }
      case 'Chip':
        {
          const chipColor = String(args[1] ?? 'default').toLowerCase();
          const tone = chipColor === 'success' ? palette.success : chipColor === 'danger' ? palette.danger : palette.border;
          return (
            <View style={[styles.chip, { borderColor: tone, backgroundColor: palette.surfaceAlt }]}>
              <Text style={[styles.fontSemi, { color: palette.fg, fontSize: 12 }]}>{String(args[0] ?? '')}</Text>
            </View>
          );
        }
      case 'Badge': {
        const toneName = String(args[1] ?? 'neutral').toLowerCase();
        const tone =
          toneName === 'success'
            ? palette.success
            : toneName === 'danger'
              ? palette.danger
              : toneName === 'info'
                ? palette.info
                : toneName === 'warning'
                  ? '#D97706'
                  : palette.border;
        return (
          <View style={[styles.badge, { borderColor: tone, backgroundColor: palette.surfaceAlt }]}>
            <Text style={{ color: palette.fg, fontSize: 11, fontWeight: '700' }}>{String(args[0] ?? '')}</Text>
          </View>
        );
      }
      case 'Stat': {
        return (
          <View style={[styles.stat, { borderColor: palette.border, backgroundColor: palette.surfaceAlt }]}>
            <Text style={[styles.fontRegular, { color: palette.muted, fontSize: 12 }]}>{String(args[0] ?? '')}</Text>
            <Text style={[styles.fontBold, { color: palette.fg, fontSize: 18, marginTop: 2 }]}>{String(args[1] ?? '')}</Text>
            {args[2] ? <Text style={[styles.fontRegular, { color: palette.success, fontSize: 12, marginTop: 2 }]}>{String(args[2])}</Text> : null}
          </View>
        );
      }
      case 'Progress': {
        const pct = Math.max(0, Math.min(100, Number(args[1] ?? 0)));
        return (
          <View style={[styles.card, { borderColor: palette.border, backgroundColor: palette.surface }]}>
            <Text style={[styles.fontSemi, { color: palette.fg, fontSize: 13 }]}>{String(args[0] ?? 'Progress')}</Text>
            <View style={[styles.progressTrack, { backgroundColor: palette.surfaceAlt, borderColor: palette.border }]}>
              <View style={[styles.progressFill, { width: `${pct}%`, backgroundColor: palette.primary }]} />
            </View>
            <Text style={[styles.fontRegular, { color: palette.muted, fontSize: 12, marginTop: 4 }]}>{pct}%</Text>
          </View>
        );
      }
      case 'List': {
        const items = asArray(args[0]).map((x) => String(x ?? ''));
        return (
          <View style={[styles.card, { borderColor: palette.border, backgroundColor: palette.surface }]}>
            {items.map((it, idx) => (
              <View key={`${ref}-li-${idx}`} style={styles.listRow}>
                <Text style={{ color: palette.primary, marginTop: 1 }}>•</Text>
                <Text style={[styles.fontRegular, { color: palette.fg, fontSize: 13, lineHeight: 19, flex: 1 }]}>{it}</Text>
              </View>
            ))}
          </View>
        );
      }
      case 'Grid': {
        const refs = asArray(args[0]);
        const cols = Math.max(1, Math.min(4, Number(args[1] ?? 2)));
        return (
          <View style={styles.gridWrap}>
            {refs.map((x, i) => {
              const width = `${100 / cols}%` as const;
              if (!isRef(x)) return null;
              return (
                <View key={`${ref}-g-${i}`} style={{ width, padding: 4 }}>
                  {renderRef(x.__ref, p)}
                </View>
              );
            })}
          </View>
        );
      }
      case 'Divider':
        return <View style={[styles.divider, { backgroundColor: palette.border }]} />;
      case 'Avatar': {
        const name = String(args[0] ?? '');
        const subtitle = String(args[1] ?? '');
        const initial = name ? name.charAt(0).toUpperCase() : '?';
        return (
          <View style={[styles.avatarRow, { borderColor: palette.border, backgroundColor: palette.surfaceAlt }]}>
            <View style={[styles.avatarCircle, { backgroundColor: palette.primary }]}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>{initial}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: palette.fg, fontWeight: '700' }}>{name}</Text>
              {subtitle ? <Text style={{ color: palette.muted, fontSize: 12 }}>{subtitle}</Text> : null}
            </View>
          </View>
        );
      }
      case 'KeyValue': {
        const pairs = asArray(args[0]);
        return (
          <View style={[styles.card, { borderColor: palette.border, backgroundColor: palette.surface }]}>
            {pairs.map((p2, i) => {
              const pair = asArray(p2);
              return (
                <View key={`${ref}-kv-${i}`} style={[styles.kvRow, { borderBottomColor: palette.border }]}>
                  <Text style={{ color: palette.muted, fontSize: 12 }}>{String(pair[0] ?? '')}</Text>
                  <Text style={{ color: palette.fg, fontSize: 12, fontWeight: '600' }}>{String(pair[1] ?? '')}</Text>
                </View>
              );
            })}
          </View>
        );
      }
      case 'Timeline': {
        const events = asArray(args[0]);
        return (
          <View style={[styles.card, { borderColor: palette.border, backgroundColor: palette.surface }]}>
            {events.map((ev, i) => {
              const pair = asArray(ev);
              return (
                <View key={`${ref}-tl-${i}`} style={styles.timelineRow}>
                  <View style={[styles.timelineDot, { backgroundColor: palette.primary }]} />
                  <View style={{ flex: 1 }}>
              <Text style={[styles.fontRegular, { color: palette.muted, fontSize: 11 }]}>{String(pair[0] ?? '')}</Text>
              <Text style={[styles.fontRegular, { color: palette.fg, fontSize: 13 }]}>{String(pair[1] ?? '')}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        );
      }
      case 'Chart': {
        const title = String(args[0] ?? 'Chart');
        const points = asArray(args[1]).map((p2) => asArray(p2));
        const values = points.map((p2) => Number(p2[1] ?? 0));
        const max = Math.max(1, ...values);
        return (
          <View style={[styles.card, { borderColor: palette.border, backgroundColor: palette.surface }]}>
            <Text style={[styles.fontBold, { color: palette.fg, marginBottom: 8 }]}>{title}</Text>
            {points.map((p2, i) => {
              const label = String(p2[0] ?? '');
              const value = Number(p2[1] ?? 0);
              const widthPct = Math.max(4, Math.round((value / max) * 100));
              return (
                <View key={`${ref}-ch-${i}`} style={styles.chartRow}>
                  <Text style={[styles.fontRegular, { color: palette.muted, width: 40, fontSize: 11 }]}>{label}</Text>
                  <View style={[styles.chartTrack, { backgroundColor: palette.surfaceAlt }]}>
                    <View style={[styles.chartFill, { width: `${widthPct}%`, backgroundColor: palette.primary }]} />
                  </View>
                  <Text style={[styles.fontRegular, { color: palette.fg, width: 48, textAlign: 'right', fontSize: 11 }]}>{String(value)}</Text>
                </View>
              );
            })}
          </View>
        );
      }
      case 'Form': {
        const title = String(args[0] ?? 'Form');
        const fields = asArray(args[1]).map((x) => String(x ?? ''));
        const submit = String(args[2] ?? 'Submit');
        return (
          <View style={[styles.card, { borderColor: palette.border, backgroundColor: palette.surface }]}>
            <Text style={[styles.cardTitle, styles.fontSemi, { color: palette.fg }]}>{title}</Text>
            {fields.map((f, i) => (
              <View key={`${ref}-f-${i}`} style={[styles.formField, { borderColor: palette.border, backgroundColor: palette.surfaceAlt }]}>
                <Text style={[styles.fontRegular, { color: palette.muted, fontSize: 12 }]}>{f}</Text>
              </View>
            ))}
            <Pressable style={[styles.btn, { backgroundColor: palette.primary }]}>
              <Text style={[styles.btnText, styles.fontSemi, { color: '#fff' }]}>{submit}</Text>
            </Pressable>
          </View>
        );
      }
      case 'Modal': {
        const actions = asArray(args[2]).map((x) => String(x ?? ''));
        return (
          <View style={[styles.modalWrap, { backgroundColor: '#00000033' }]}>
            <View style={[styles.modalCard, { borderColor: palette.border, backgroundColor: palette.surface }]}>
              <Text style={[styles.cardTitle, styles.fontSemi, { color: palette.fg }]}>{String(args[0] ?? 'Modal')}</Text>
              <Text style={[styles.cardDesc, styles.fontRegular, { color: palette.muted }]}>{String(args[1] ?? '')}</Text>
              <View style={styles.modalActions}>
                {actions.map((a, i) => (
                  <View key={`${ref}-ma-${i}`} style={[styles.chipBtnGhost, { borderColor: palette.border }]}>
                    <Text style={[styles.fontRegular, { color: palette.fg, fontSize: 12 }]}>{a}</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
        );
      }
      case 'EmptyState': {
        const action = String(args[2] ?? '');
        return (
          <View style={[styles.card, styles.emptyState, { borderColor: palette.border, backgroundColor: palette.surfaceAlt }]}>
            <Text style={[styles.fontBold, { color: palette.fg, fontSize: 15 }]}>{String(args[0] ?? 'No data')}</Text>
            <Text style={[styles.fontRegular, { color: palette.muted, marginTop: 4, textAlign: 'center' }]}>{String(args[1] ?? '')}</Text>
            {action ? (
              <View style={[styles.chipBtnGhost, { borderColor: palette.border, marginTop: 8 }]}>
                <Text style={[styles.fontRegular, { color: palette.fg, fontSize: 12 }]}>{action}</Text>
              </View>
            ) : null}
          </View>
        );
      }
      case 'KpiStrip': {
        const items = asArray(args[0]).map((p2) => asArray(p2));
        return (
          <ScrollView horizontal style={[styles.card, { borderColor: palette.border, backgroundColor: palette.surface }]}>
            <View style={styles.kpiRow}>
              {items.map((it, i) => (
                <View key={`${ref}-kpi-${i}`} style={[styles.kpiCard, { borderColor: palette.border, backgroundColor: palette.surfaceAlt }]}>
                  <Text style={[styles.fontRegular, { color: palette.muted, fontSize: 11 }]}>{String(it[0] ?? '')}</Text>
                  <Text style={[styles.fontBold, { color: palette.fg, marginTop: 2 }]}>{String(it[1] ?? '')}</Text>
                </View>
              ))}
            </View>
          </ScrollView>
        );
      }
      case 'Accordion': {
        const items = asArray(args[0]).map((p2) => asArray(p2));
        return (
          <View style={[styles.card, { borderColor: palette.border, backgroundColor: palette.surface }]}>
            {items.map((it, i) => (
              <View key={`${ref}-acc-${i}`} style={[styles.accItem, { borderBottomColor: palette.border }]}>
                <Text style={[styles.fontSemi, { color: palette.fg, fontSize: 13 }]}>{String(it[0] ?? '')}</Text>
                <Text style={[styles.fontRegular, { color: palette.muted, fontSize: 12, marginTop: 2 }]}>{String(it[1] ?? '')}</Text>
              </View>
            ))}
          </View>
        );
      }
      case 'Stepper': {
        const steps = asArray(args[0]).map((x) => String(x ?? ''));
        const activeIndex = Math.max(0, Number(args[1] ?? 0));
        return (
          <View style={[styles.card, { borderColor: palette.border, backgroundColor: palette.surface }]}>
            {steps.map((step, i) => (
              <View key={`${ref}-st-${i}`} style={styles.stepRow}>
                <View
                  style={[
                    styles.stepDot,
                    { backgroundColor: i <= activeIndex ? palette.primary : palette.surfaceAlt, borderColor: palette.border },
                  ]}
                />
                <Text style={[styles.fontRegular, { color: i <= activeIndex ? palette.fg : palette.muted, fontSize: 12 }]}>{step}</Text>
              </View>
            ))}
          </View>
        );
      }
      case 'Toast': {
        const variant = String(args[1] ?? 'info').toLowerCase();
        const tone = variant === 'success' ? palette.success : variant === 'danger' ? palette.danger : palette.info;
        return (
          <View style={[styles.toast, { borderColor: tone, backgroundColor: palette.surface }]}>
            <Text style={[styles.fontSemi, { color: palette.fg }]}>{String(args[0] ?? '')}</Text>
          </View>
        );
      }
      case 'TagCloud': {
        const tags = asArray(args[0]).map((x) => String(x ?? ''));
        return (
          <View style={[styles.card, { borderColor: palette.border, backgroundColor: palette.surface }]}>
            <View style={styles.tagsWrap}>
              {tags.map((tag, i) => (
                <View key={`${ref}-tag-${i}`} style={[styles.badge, { borderColor: palette.border, backgroundColor: palette.surfaceAlt }]}>
                  <Text style={[styles.fontRegular, { color: palette.fg, fontSize: 11 }]}>{tag}</Text>
                </View>
              ))}
            </View>
          </View>
        );
      }
      case 'HorizontalGrid': {
        const refs = asArray(args[0]);
        const rows = Math.max(1, Math.min(4, Number(args[1] ?? 2)));
        const itemWidth = Math.max(140, Number(args[2] ?? 220));
        const columns: Value[][] = [];
        for (let i = 0; i < refs.length; i += rows) columns.push(refs.slice(i, i + rows));
        return (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.hGrid}>
              {columns.map((col, i) => (
                <View key={`${ref}-hg-col-${i}`} style={{ width: itemWidth, gap: 8 }}>
                  {col.map((child, j) => (isRef(child) ? <View key={`${ref}-hg-${i}-${j}`}>{renderRef(child.__ref, p)}</View> : null))}
                </View>
              ))}
            </View>
          </ScrollView>
        );
      }
      case 'OfferCard': {
        const title = String(args[0] ?? '');
        const subtitle = String(args[1] ?? '');
        const price = String(args[2] ?? '');
        const cta = String(args[3] ?? 'Select');
        return (
          <View style={[styles.card, { borderColor: palette.border, backgroundColor: palette.surface }]}>
            <Text style={[styles.fontBold, { color: palette.fg, fontSize: 15 }]}>{title}</Text>
            <Text style={[styles.fontRegular, { color: palette.muted, fontSize: 12, marginTop: 4 }]}>{subtitle}</Text>
            {price ? <Text style={[styles.fontSemi, { color: palette.fg, fontSize: 13, marginTop: 8 }]}>{price}</Text> : null}
            <View style={[styles.chipBtnGhost, { borderColor: palette.border, marginTop: 8 }]}>
              <Text style={[styles.fontRegular, { color: palette.fg, fontSize: 12 }]}>{cta}</Text>
            </View>
          </View>
        );
      }
      case 'PriceTag': {
        const current = String(args[0] ?? '');
        const prev = String(args[1] ?? '');
        return (
          <View style={styles.priceRow}>
            <Text style={[styles.fontBold, { color: palette.fg }]}>{current}</Text>
            {prev ? <Text style={[styles.fontRegular, { color: palette.muted, textDecorationLine: 'line-through', fontSize: 12 }]}>{prev}</Text> : null}
          </View>
        );
      }
      case 'Rating': {
        const value = Math.max(0, Math.min(5, Number(args[0] ?? 0)));
        const max = Math.max(1, Math.min(10, Number(args[1] ?? 5)));
        const stars = Array.from({ length: max }, (_, i) => (i < value ? '★' : '☆')).join('');
        return <Text style={[styles.fontRegular, { color: '#F59E0B', fontSize: 12 }]}>{stars}</Text>;
      }
      case 'Tabs': {
        const items = asArray(args[0]).map((x) => String(x ?? ''));
        const panels = asArray(args[1]);
        const active = tabState[ref] ?? 0;
        return (
          <View style={[styles.card, { borderColor: palette.border, backgroundColor: palette.surface }]}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsRow}>
              {items.map((label, i) => (
                <Pressable
                  key={`${ref}-tab-${i}`}
                  onPress={() => setTabState((prev) => ({ ...prev, [ref]: i }))}
                  style={[styles.tab, { borderColor: palette.border, backgroundColor: i === active ? palette.primary : palette.surfaceAlt }]}>
                  <Text style={[styles.fontSemi, { color: i === active ? '#fff' : palette.fg }]}>{label}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <View style={{ marginTop: 10 }}>{isRef(panels[active] as Value) ? renderRef((panels[active] as { __ref: string }).__ref, p) : null}</View>
          </View>
        );
      }
      case 'Table': {
        const cols = asArray(args[0]).map((x) => String(x ?? ''));
        const rows = asArray(args[1]);
        const colCount = Math.max(1, cols.length);
        const colWidth = 140;
        const tableWidth = colCount * colWidth;
        return (
          <ScrollView horizontal style={[styles.card, { borderColor: palette.border, backgroundColor: palette.surface }]}>
            <View style={{ width: tableWidth }}>
              <View style={[styles.tableRow, styles.tableHeader, { borderColor: palette.border, backgroundColor: palette.surfaceAlt }]}>
                {Array.from({ length: colCount }).map((_, i) => (
                  <View key={`${ref}-h-${i}`} style={[styles.tableCell, styles.tableHeaderCell, { borderRightColor: palette.border, width: colWidth }]}>
                    <Text style={[styles.tableHeaderText, { color: palette.fg }]}>{cols[i] ?? ''}</Text>
                  </View>
                ))}
              </View>
              {rows.map((r, i) => (
                <View key={`${ref}-r-${i}`} style={[styles.tableRow, { borderColor: palette.border }]}>
                  {Array.from({ length: colCount }).map((_, j) => (
                    <View key={`${ref}-c-${i}-${j}`} style={[styles.tableCell, { borderRightColor: palette.border, width: colWidth }]}>
                    <Text style={[styles.tableCellText, styles.fontRegular, { color: palette.muted }]}>{String(asArray(r)[j] ?? '')}</Text>
                    </View>
                  ))}
                </View>
              ))}
            </View>
          </ScrollView>
        );
      }
      case 'Spinner':
      case 'Skeleton':
        return <ActivityIndicator color={palette.primary} />;
      default:
        return (
          <View style={[styles.card, { borderColor: palette.border, backgroundColor: palette.surface }]}>
            <Text style={{ color: palette.muted }}>Unsupported component: {node.component}</Text>
          </View>
        );
    }
  };

  return <View>{renderRef(parsed.rootId, parsed)}</View>;
}

export const DslRenderer = memo(DslRendererImpl);

const styles = StyleSheet.create({
  stack: { gap: 10 },
  card: { borderWidth: 1, borderRadius: 14, padding: 12, marginTop: 6 },
  cardBase: {
    borderRadius: 16,
    overflow: 'hidden',
    flexDirection: 'column',
    alignSelf: 'stretch',
  },
  cardShadowSm: Platform.select({
    ios: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.07,
      shadowRadius: 6,
    },
    android: { elevation: 3 },
    default: {},
  }),
  cardShadowNone: Platform.select({
    ios: {
      shadowColor: 'transparent',
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0,
      shadowRadius: 0,
    },
    android: { elevation: 0 },
    default: {},
  }),
  cardHeader: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 0,
    gap: 6,
    flexDirection: 'column',
  },
  cardBody: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
    flexDirection: 'column',
  },
  cardFooter: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
    gap: 8,
    flexDirection: 'column',
  },
  cardFooterInner: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
  },
  fontRegular: { fontFamily: 'Inter_400Regular' },
  fontSemi: { fontFamily: 'Inter_600SemiBold' },
  fontBold: { fontFamily: 'Inter_700Bold' },
  cardTitle: { fontSize: 16, lineHeight: 24 },
  cardDesc: { fontSize: 14, lineHeight: 22 },
  btn: { alignSelf: 'flex-start', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9, marginTop: 8 },
  btnText: {},
  chip: { alignSelf: 'flex-start', borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  badge: { alignSelf: 'flex-start', borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  stat: { borderWidth: 1, borderRadius: 12, padding: 10 },
  progressTrack: { height: 10, borderWidth: 1, borderRadius: 999, marginTop: 8, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 999 },
  listRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginBottom: 6 },
  gridWrap: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 },
  timelineRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginBottom: 8 },
  timelineDot: { width: 8, height: 8, borderRadius: 4, marginTop: 4 },
  chartRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  chartTrack: { flex: 1, height: 8, borderRadius: 999, overflow: 'hidden' },
  chartFill: { height: '100%', borderRadius: 999 },
  formField: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10, marginTop: 8 },
  modalWrap: { borderRadius: 12, padding: 8 },
  modalCard: { borderWidth: 1, borderRadius: 12, padding: 10 },
  modalActions: { flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' },
  chipBtnGhost: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, alignSelf: 'flex-start' },
  emptyState: { alignItems: 'center', justifyContent: 'center' },
  kpiRow: { flexDirection: 'row', gap: 8 },
  kpiCard: { borderWidth: 1, borderRadius: 10, padding: 8, minWidth: 110 },
  accItem: { borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 8 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  stepDot: { width: 10, height: 10, borderRadius: 5, borderWidth: 1 },
  toast: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  tagsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  hGrid: { flexDirection: 'row', gap: 10, paddingVertical: 2 },
  priceRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 8 },
  avatarRow: { borderWidth: 1, borderRadius: 12, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatarCircle: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  kvRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  alert: { borderWidth: 1, borderRadius: 12, padding: 12, flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  alertPill: { width: 6, borderRadius: 6, alignSelf: 'stretch' },
  tabsRow: { gap: 8, paddingBottom: 2 },
  tab: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  tableHeader: { borderWidth: 1 },
  tableRow: { flexDirection: 'row', borderBottomWidth: 1 },
  tableCell: { borderRightWidth: StyleSheet.hairlineWidth, paddingHorizontal: 10, paddingVertical: 8, justifyContent: 'center' },
  tableHeaderCell: { borderBottomWidth: StyleSheet.hairlineWidth },
  tableHeaderText: { fontSize: 12, lineHeight: 16, fontFamily: 'Inter_600SemiBold' },
  tableCellText: { fontSize: 12, lineHeight: 16, flexShrink: 1, flexWrap: 'wrap' },
});
