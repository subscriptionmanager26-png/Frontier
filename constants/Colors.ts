/** SaffronAI-inspired brand: primary orange reserved for CTAs, active states, and key highlights. */
const SAFFRON = '#FF7A00';

export default {
  light: {
    text: '#1A1A1A',
    /** Main canvas — guidelines: #F7F9FA */
    background: '#F7F9FA',
    /** Cards, sheets, nav surfaces */
    card: '#FFFFFF',
    tint: SAFFRON,
    tabIconDefault: '#CCCCCC',
    tabIconSelected: SAFFRON,
    border: '#E8ECEF',
    /** Guidelines: #666666 */
    mutedText: '#666666',
    /** Light saffron tint for chips, avatars, tinted rows */
    surfaceTint: '#FFF0E5',
    /** Secondary neutral blocks */
    engagement: '#F3F4F6',
    positive: '#5CB85C',
    negative: '#DC3545',
  },
  dark: {
    text: '#FFFFFF',
    background: '#121212',
    card: '#1C1C1E',
    tint: SAFFRON,
    tabIconDefault: '#666666',
    tabIconSelected: SAFFRON,
    border: '#38383A',
    mutedText: 'rgba(255,255,255,0.55)',
    surfaceTint: 'rgba(255, 122, 0, 0.18)',
    engagement: '#2C2C2E',
    positive: '#5CB85C',
    negative: '#DC3545',
  },
};
