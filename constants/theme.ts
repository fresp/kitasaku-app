// Kitasaku Design Tokens — mapped 1:1 from design/design.pen (Design System - Foundations)
//
// Phase 3 added the financing/loan states, the chart ramp, and the overlay
// alphas that the zero-based allocation hero needs. Values are copied verbatim
// from the `variables` block of design.pen; do not "round" them to a nicer
// colour, the design file is the source of truth.

export const Colors = {
  // Surfaces
  canvas: '#F8FAFC',
  surface: '#FFFFFF',
  subtle: '#F1F5F9',

  // Borders
  borderSubtle: '#E2E8F0',
  borderStrong: '#CBD5E1',

  // Text
  textPrimary: '#0F172A',
  textSecondary: '#475569',
  textMuted: '#94A3B8',

  // State: pending / overdue
  pendingBorder: '#DC2626',
  pendingBg: '#FEF2F2',
  pendingText: '#991B1B',

  // State: paid / complete
  paidText: '#059669',
  paidBg: '#ECFDF5',

  // State: needs attention (warning, not error)
  alertText: '#D97706',
  alertBg: '#FFFBEB',

  // State: financing inflow (money received that is not income)
  financingBg: '#FEF3C7',
  financingText: '#B45309',
  financingBorder: '#FCD34D',

  // State: loan / debt paydown
  loanBg: '#FFF7ED',
  loanText: '#C2410C',
  loanBorder: '#EA580C',

  // Brand
  brandPrimary: '#0F172A',
  heroFooter: '#1E293B',
  white: '#FFFFFF',

  // Chart ramp — one colour per money category, used by every chart so a
  // series keeps its identity across screens.
  chartIncome: '#059669',
  chartFinancing: '#D97706',
  chartExpense: '#DC2626',
  chartLiability: '#EA580C',
  chartNetCashflow: '#0F172A',
  chartAsset: '#334155',
  chartInvestment: '#475569',
  chartPlan: '#CBD5E1',
  chartGrid: '#E2E8F0',
  chartAxis: '#94A3B8',

  // Overlays — alpha is part of the token; `${color}33` composition is avoided
  // so the design file and the code agree exactly.
  overlayScrim: '#0F172AA6',
  overlayScrimLight: '#0F172A33',
  overlayGhost: '#FFFFFFCC',
  overlayTint: '#FFFFFF1A',
} as const;

export const FontSize = {
  heroNumeral: 28,
  sectionTitle: 18,
  cardTitle: 15,
  currencyLarge: 16,
  body: 13,
  caption: 11,
  // Hero breakdown grid: the value line is slightly larger than body text so
  // the four money blocks stay scannable at 9.5–10pt labels.
  microLabel: 10,
  microValue: 14,
} as const;

export const Radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
} as const;
