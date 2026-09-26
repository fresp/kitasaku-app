// Kitasaku Design Tokens — mapped 1:1 from design/design.pen (Design System - Foundations)
export const Colors = {
  canvas: '#F8FAFC',
  surface: '#FFFFFF',
  subtle: '#F1F5F9',
  borderSubtle: '#E2E8F0',
  borderStrong: '#CBD5E1',
  textPrimary: '#0F172A',
  textSecondary: '#475569',
  textMuted: '#94A3B8',
  pendingBorder: '#DC2626',
  pendingBg: '#FEF2F2',
  pendingText: '#991B1B',
  paidText: '#059669',
  paidBg: '#ECFDF5',
  alertText: '#D97706',
  alertBg: '#FFFBEB',
  brandPrimary: '#0F172A',
  heroFooter: '#1E293B',
  white: '#FFFFFF',
} as const;

export const FontSize = {
  heroNumeral: 28,
  sectionTitle: 18,
  cardTitle: 15,
  currencyLarge: 16,
  body: 13,
  caption: 11,
} as const;

export const Radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;
