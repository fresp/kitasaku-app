import { describe, expect, it } from 'vitest';
import { categoryIconName, fallbackIcon } from '../category-icon';
import { BRAND_ART, BRAND_ART_NAMES } from '../brand-art';

const CATEGORY_ICONS = [
  'category-belanja',
  'category-hiburan',
  'category-hutang',
  'category-kesehatan',
  'category-lainnya',
  'category-makan-minum',
  'category-pemasukan',
  'category-pendidikan',
  'category-rumah',
  'category-tabungan',
  'category-tagihan',
  'category-transportasi',
  'category-travel',
];

const EMPTY_ICONS = [
  'empty-belum-ada-pemasukan',
  'empty-belum-ada-rencana',
  'empty-belum-ada-tabungan',
  'empty-belum-ada-transaksi',
  'empty-data-tidak-ditemukan',
  'empty-tidak-ada-tagihan',
];

const CONTEXT_ICONS = [
  'context-budget',
  'context-calendar',
  'context-family',
  'context-goal',
  'context-home',
  'context-payment',
];

const ONBOARDING_ICONS = [
  'onboarding-01-family-finance',
  'onboarding-02-expense-tracking',
  'onboarding-03-shared-goal',
];

describe('category icon mapping (phase 6)', () => {
  it('140: the design own labels map to the icon of the same name', () => {
    // Screen 2B is the picker, and its 13 labels pair 1:1 with the 13 file
    // names. These cases are that mapping, so the rules cannot silently drift
    // away from the design.
    const designPairs: [string, string][] = [
      ['Pemasukan', 'category-pemasukan'],
      ['Belanja', 'category-belanja'],
      ['Makan & Minum', 'category-makan-minum'],
      ['Rumah', 'category-rumah'],
      ['Tagihan', 'category-tagihan'],
      ['Pendidikan', 'category-pendidikan'],
      ['Kesehatan', 'category-kesehatan'],
      ['Transportasi', 'category-transportasi'],
      ['Tabungan', 'category-tabungan'],
      ['Hutang', 'category-hutang'],
      ['Hiburan', 'category-hiburan'],
      ['Travel', 'category-travel'],
      ['Lainnya', 'category-lainnya'],
    ];
    for (const [label, icon] of designPairs) {
      expect(categoryIconName({ name: label, type: 'EXPENSE' }), label).toBe(icon);
    }
  });

  it('141: health beats housing, so Rumah Sakit is a hospital', () => {
    // The name contains both `rumah` and `sakit`. First-match-wins makes the
    // ordering load-bearing rather than cosmetic.
    expect(categoryIconName({ name: 'Rumah Sakit', type: 'EXPENSE' })).toBe('category-kesehatan');
    expect(categoryIconName({ name: 'Rumah', type: 'EXPENSE' })).toBe('category-rumah');
    expect(categoryIconName({ name: 'Sewa Rumah', type: 'EXPENSE' })).toBe('category-rumah');
  });

  it('142: a named debt beats the thing that was bought', () => {
    // "Cicilan Motor" is the cicilan, not transport. The obligation is the
    // subject of the category, not the object financed.
    expect(categoryIconName({ name: 'Cicilan Motor', type: 'EXPENSE' })).toBe('category-hutang');
    expect(categoryIconName({ name: 'Kredit Motor', type: 'EXPENSE' })).toBe('category-hutang');
    expect(categoryIconName({ name: 'Bensin Motor', type: 'EXPENSE' })).toBe('category-transportasi');
  });

  it('143: the system roles are decided by role, not by the current name', () => {
    // Migration 006 lets the family rename these. Renaming "Hutang" to
    // something unrecognisable must not change which icon it gets.
    expect(
      categoryIconName({ name: 'Zzz', type: 'EXPENSE', systemRole: 'DEBT_PAYMENT' }),
    ).toBe('category-hutang');
    expect(
      categoryIconName({ name: 'Zzz', type: 'INCOME', systemRole: 'FINANCING_INFLOW' }),
    ).toBe('category-pemasukan');
    // And the role wins over a name that would otherwise match something else.
    expect(
      categoryIconName({ name: 'Bensin', type: 'EXPENSE', systemRole: 'DEBT_PAYMENT' }),
    ).toBe('category-hutang');
  });

  it('144: an unrecognised name falls back to its type', () => {
    expect(categoryIconName({ name: 'Renovasi Dapur', type: 'EXPENSE' })).not.toBe('');
    expect(categoryIconName({ name: 'Qwerty Xyzzy', type: 'INCOME' })).toBe('category-pemasukan');
    expect(categoryIconName({ name: 'Qwerty Xyzzy', type: 'INVESTMENT' })).toBe('category-tabungan');
    expect(categoryIconName({ name: 'Qwerty Xyzzy', type: 'EXPENSE' })).toBe('category-lainnya');
    expect(fallbackIcon('EXPENSE')).toBe('category-lainnya');
  });

  it('145: an empty or whitespace name still produces an icon', () => {
    // A category created before its name is filled in must not render a blank
    // box, so the fallback is reached rather than an empty string.
    for (const name of ['', '   ', ' ']) {
      expect(categoryIconName({ name, type: 'EXPENSE' })).toBe('category-lainnya');
    }
  });

  it('146: matching is case-insensitive and survives stray whitespace', () => {
    expect(categoryIconName({ name: 'MAKAN MINUM', type: 'EXPENSE' })).toBe('category-makan-minum');
    expect(categoryIconName({ name: '  makan   minum  ', type: 'EXPENSE' })).toBe('category-makan-minum');
    expect(categoryIconName({ name: 'Makan Minum', type: 'EXPENSE' })).toBe('category-makan-minum');
  });

  it('146b: a rule word may end a longer word, but must start one', () => {
    // The bug this catches: a plain `includes` let the savings rule's `emas`
    // (gold) match inside "pemasukan" (income), so the income category rendered
    // with the savings icon. Suffix tolerance is still needed — "Tabungan" is
    // the savings category and must be caught by the stem `tabung`.
    expect(categoryIconName({ name: 'Pemasukan', type: 'INCOME' })).toBe('category-pemasukan');
    expect(categoryIconName({ name: 'Tabungan', type: 'INVESTMENT' })).toBe('category-tabungan');
    expect(categoryIconName({ name: 'Emas', type: 'INVESTMENT' })).toBe('category-tabungan');
    expect(categoryIconName({ name: 'Emas Antam', type: 'INVESTMENT' })).toBe('category-tabungan');
    expect(categoryIconName({ name: 'Beli Emas', type: 'EXPENSE' })).toBe('category-tabungan');
    // Suffix tolerance for other stems.
    expect(categoryIconName({ name: 'Cicilan Motor', type: 'EXPENSE' })).toBe('category-hutang');
    expect(categoryIconName({ name: 'Angsuran Rumah', type: 'EXPENSE' })).toBe('category-hutang');
  });

  it('146c: narrower rules win where two rules could both match', () => {
    // "Tiket Pesawat" is transport; a bare "Tiket" is entertainment. "Air" alone
    // is not a utility — the family writing "Air Minum" means drinking water.
    // "Dapur" is a room, so "Renovasi Dapur" is housing, not a meal.
    expect(categoryIconName({ name: 'Tiket Pesawat', type: 'EXPENSE' })).toBe('category-transportasi');
    expect(categoryIconName({ name: 'Tiket Konser', type: 'EXPENSE' })).toBe('category-hiburan');
    expect(categoryIconName({ name: 'Air Minum', type: 'EXPENSE' })).toBe('category-makan-minum');
    expect(categoryIconName({ name: 'Air PDAM', type: 'EXPENSE' })).toBe('category-tagihan');
    expect(categoryIconName({ name: 'Renovasi Dapur', type: 'EXPENSE' })).toBe('category-rumah');
    expect(categoryIconName({ name: 'Sewa Dapur', type: 'EXPENSE' })).toBe('category-rumah');
  });

  it('147: every icon the mapper can return exists in the pack', () => {
    // The mapper promises a name, not a name that renders. If a rule names an
    // icon the pack does not ship, the screen shows nothing and no test fails
    // at the call site — so the check lives here.
    const names = [
      ...CATEGORY_ICONS,
      categoryIconName({ name: 'Gaji', type: 'INCOME' }),
      categoryIconName({ name: 'Netflix', type: 'EXPENSE' }),
      categoryIconName({ name: 'Bensin', type: 'EXPENSE' }),
      categoryIconName({ name: 'Listrik', type: 'EXPENSE' }),
      categoryIconName({ name: 'Liburan Bali', type: 'EXPENSE' }),
      categoryIconName({ name: 'Saham', type: 'INVESTMENT' }),
      categoryIconName({ name: 'Obat', type: 'EXPENSE' }),
      categoryIconName({ name: 'SPP Sekolah', type: 'EXPENSE' }),
      categoryIconName({ name: 'Baju', type: 'EXPENSE' }),
      categoryIconName({ name: 'Lain-lain', type: 'EXPENSE' }),
    ];
    for (const n of names) {
      expect(BRAND_ART_NAMES, n).toContain(n);
    }
  });
});

describe('explicit icon from the picker (migration 009)', () => {
  it('153: a picked icon outranks the name and survives a rename', () => {
    // Screen 2B is a real choice, not a preview. The family can call a category
    // "Hobi" and pick the travel icon on purpose; a rename to "Liburan" must not
    // quietly take that choice away.
    expect(categoryIconName({ name: 'Hobi', type: 'EXPENSE', icon: 'category-travel' }))
      .toBe('category-travel');
    expect(categoryIconName({ name: 'Liburan', type: 'EXPENSE', icon: 'category-travel' }))
      .toBe('category-travel');
    // And it outranks the rules that would otherwise fire.
    expect(categoryIconName({ name: 'Bensin', type: 'EXPENSE', icon: 'category-hiburan' }))
      .toBe('category-hiburan');
    expect(categoryIconName({ name: 'Renovasi Dapur', type: 'EXPENSE', icon: 'category-belanja' }))
      .toBe('category-belanja');
  });

  it('154: a pick outranks even the system role, because it is still a choice', () => {
    // The two system categories get their icon from the role so a rename cannot
    // break them. But if someone has explicitly picked an icon for one, that is
    // a person's decision and the role is only a default.
    expect(
      categoryIconName({ name: 'Pinjaman', type: 'EXPENSE', systemRole: 'DEBT_PAYMENT' }),
    ).toBe('category-hutang');
    expect(
      categoryIconName({
        name: 'Pinjaman', type: 'EXPENSE', systemRole: 'DEBT_PAYMENT', icon: 'category-rumah',
      }),
    ).toBe('category-rumah');
  });

  it('155: null, undefined, and an empty string all mean "derive from the name"', () => {
    // Every row that exists today is null. The picker's "no choice" has to be
    // indistinguishable from a category that predates the column, or the screens
    // would show a blank box for every category the family never touched.
    const base = { name: 'Makan & Minum', type: 'EXPENSE' } as const;
    expect(categoryIconName({ ...base, icon: null })).toBe('category-makan-minum');
    expect(categoryIconName({ ...base, icon: undefined })).toBe('category-makan-minum');
    expect(categoryIconName({ ...base, icon: '' })).toBe('category-makan-minum');
  });

  it('156: an icon the shipped pack does not have is ignored, not rendered as nothing', () => {
    // The column is unconstrained on purpose (migration 009): a row written by a
    // build with a different pack, or by a hand-run SQL update, must still show
    // an icon rather than an empty box. Falling back to the name does that.
    expect(categoryIconName({ name: 'Makan & Minum', type: 'EXPENSE', icon: 'category-yang-tidak-ada' }))
      .toBe('category-makan-minum');
    expect(categoryIconName({ name: 'Makan & Minum', type: 'EXPENSE', icon: 'app-icon' }))
      .toBe('category-makan-minum');
    // The native icons are not in the pack, so they are not pickable either.
    expect(categoryIconName({ name: 'Makan & Minum', type: 'EXPENSE', icon: 'favicon' }))
      .toBe('category-makan-minum');
  });

  it('157: every one of the 13 picker icons is honoured', () => {
    // The picker offers exactly these 13. Each must round-trip, or a family that
    // picks one sees a different icon than the one they tapped.
    for (const icon of CATEGORY_ICONS) {
      expect(categoryIconName({ name: 'Zzz', type: 'EXPENSE', icon }), icon).toBe(icon);
    }
  });
});

describe('brand art pack (phase 6)', () => {
  it('148: the pack holds all 30 UI icons and no native ones', () => {
    expect(BRAND_ART_NAMES).toHaveLength(30);
    for (const n of [...CATEGORY_ICONS, ...EMPTY_ICONS, ...CONTEXT_ICONS, ...ONBOARDING_ICONS]) {
      expect(BRAND_ART_NAMES, n).toContain(n);
    }
    // The native icon set is rastered to PNG by gen-icons.py because Expo's app
    // config takes rasters; shipping them here too would be dead weight.
    for (const n of ['app-icon', 'splash-icon', 'favicon']) {
      expect(BRAND_ART_NAMES, n).not.toContain(n);
    }
    for (const n of ['primary-logo', 'brand-mark']) {
      expect(BRAND_ART_NAMES, n).toContain(n);
    }
  });

  it('149: every icon is on the 512 viewBox and has a non-empty title', () => {
    for (const name of BRAND_ART_NAMES) {
      const art = BRAND_ART[name];
      expect(art.viewBox, name).toBe(512);
      expect(art.title.length, name).toBeGreaterThan(0);
      expect(art.nodes.length, name).toBeGreaterThan(0);
    }
  });

  it('150: every node carries the paint it needs to render', () => {
    // The export bug this pack arrived with was shapes that declared a stroke
    // and no fill, which SVG renders as solid black. A stroked node therefore
    // has to say `fill: false` explicitly once transcribed, and a node with
    // neither fill nor stroke is invisible in both.
    const walk = (nodes: any[], name: string) => {
      for (const n of nodes) {
        if (n.t === 'g') {
          walk(n.children, name);
          continue;
        }
        if (n.t === 'text') {
          expect(typeof n.content, name).toBe('string');
          continue;
        }
        const hasFill = typeof n.fill === 'string' && n.fill.length > 0;
        const hasStroke = typeof n.stroke === 'string' && n.stroke.length > 0;
        if (hasStroke) expect(typeof n.sw, `${name} stroke width`).toBe('number');
        if (!hasFill && !hasStroke) {
          throw new Error(`${name}: node with neither fill nor stroke`);
        }
        if (hasStroke && !hasFill && n.t === 'path') {
          // fill is absent from the data, which BrandIcon renders as "none".
          expect(n.fill).toBeUndefined();
        }
      }
    };
    for (const name of BRAND_ART_NAMES) walk(BRAND_ART[name].nodes, name);
  });

  it('151: the transform strings are well-formed', () => {
    const seen: string[] = [];
    const walk = (nodes: any[]) => {
      for (const n of nodes) {
        if (n.t === 'g') walk(n.children);
        if (n.transform) seen.push(n.transform);
      }
    };
    for (const name of BRAND_ART_NAMES) walk(BRAND_ART[name].nodes);
    expect(seen.length).toBeGreaterThan(0);
    for (const t of seen) {
      // react-native-svg parses these, so a malformed one throws at render
      // time on device rather than here. Pin the two shapes the pack uses.
      expect(t, t).toMatch(/^(translate\([-\d., ]+\)|rotate\([-\d., ]+\))$/);
    }
  });

  it('152: the stroked outlines are not filled', () => {
    // The regression that started this: category-rumah's door and roof were
    // solid black because the export dropped fill="none". A stroked path with
    // no fill in the data is rendered as fill="none" by BrandIcon, so the test
    // is that the door and roof carry no fill — not that every stroked node
    // does, because the house body is legitimately stroked *and* filled.
    const rumah = BRAND_ART['category-rumah'];
    const outlines = rumah.nodes.filter((n: any) => n.stroke && !n.fill) as any[];
    expect(outlines.length).toBe(2);
    expect(outlines.map((n: any) => n.d)).toEqual([
      'M205 390V285H307V390',
      'M256 120L407 245',
    ]);
    // And the house body, which the design does fill, keeps its fill.
    const body = rumah.nodes.find((n: any) => n.fill === '#ECFDF5') as any;
    expect(body).toBeDefined();
    expect(body.stroke).toBe('#0F172A');
  });
});
