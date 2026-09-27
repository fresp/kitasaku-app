// Which asset-pack icon stands for a category.
//
// Categories are user-authored — the family can create "Hobi", "Renovasi
// Dapur", "Sekolah Ryu" — so there is no fixed list to switch on. The icon
// comes from one of two places, in this order:
//
//   1. `icon` — the family picked it in Screen 2B's "Pilih ikon" grid, and
//      migration 009 stores it. An explicit choice is the whole point of the
//      picker, so it wins and survives a rename.
//   2. the name, matched against the ordered rules below, with the category's
//      own `type` as the fallback when the name says nothing recognisable.
//
// Pure on purpose: it takes a plain object rather than the full `Category` row,
// so Vitest can exercise it without reaching react-native. See
// lib/__tests__/category-icon.test.ts.
//
// The rules are ordered and first-match-wins, which matters more than it looks:
// "Rumah Sakit" contains both `rumah` and `sakit`, and the family means the
// hospital, not the house. Specific health words therefore sit above the
// generic `rumah` rule. When reordering, keep the narrow rules first.

import { BRAND_ART_NAMES } from './brand-art';

/** Category types in the app. Mirrors the `category_type` enum. */
export type CategoryIconType = 'EXPENSE' | 'INCOME' | 'INVESTMENT';

export interface CategoryIconInput {
  name: string;
  type: CategoryIconType | string;
  /** Set on the two categories migration 006 protects. */
  systemRole?: 'DEBT_PAYMENT' | 'FINANCING_INFLOW' | null;
  /**
   * The picker's choice, stored in `categories.icon` (migration 009).
   *
   * Kept as a plain `string` rather than a union of the 13 names so the pack can
   * grow without touching this type. An unrecognised value is ignored, not
   * thrown on: the column is unconstrained by design, so a row written by an
   * older or newer build must still render.
   */
  icon?: string | null;
}

/** Membership test against the shipped pack. */
const PACK = new Set(BRAND_ART_NAMES);

interface Rule {
  /** Asset-pack file name, without .svg. */
  icon: string;
  /** Lower-case words; any one match wins. */
  words: string[];
}

/**
 * Ordered matching rules. The first rule with a matching word supplies the icon.
 *
 * Health sits above housing so "Rumah Sakit" is a hospital. Debt sits above
 * everything so a category the family named "Cicilan Motor" is a debt, not a
 * vehicle — the obligation is the subject, not the thing bought.
 */
const RULES: Rule[] = [
  {
    icon: 'category-hutang',
    words: ['hutang', 'utang', 'cicil', 'kredit', 'pinjam', 'paylater', 'kartu kredit', 'angsur'],
  },
  {
    icon: 'category-kesehatan',
    words: ['kesehatan', 'sehat', 'sakit', 'obat', 'dokter', 'klinik', 'rumah sakit', 'vitamin', 'gigi', 'bpjs'],
  },
  {
    icon: 'category-pendidikan',
    words: ['pendidikan', 'didik', 'sekolah', 'kuliah', 'kursus', 'buku', 'spp', 'pangkal', 'seragam', 'les ', 'kampus'],
  },
  {
    icon: 'category-transportasi',
    words: ['transport', 'bensin', 'bbm', 'ojek', 'gojek', 'grab', 'taksi', 'taxi', 'kendaraan', 'motor', 'mobil', 'parkir', 'tol ', 'bus', 'kereta', 'tiket pesawat'],
  },
  {
    icon: 'category-tagihan',
    words: ['tagihan', 'listrik', 'air pdam', 'pdam', 'pln', 'internet', 'wifi', 'telkom', 'pulsa', 'paket data', 'langganan', 'iuran', 'pajak'],
  },
  {
    icon: 'category-makan-minum',
    words: ['makan', 'minum', 'food', 'kafe', 'kopi', 'resto', 'warung', 'warteg', 'jajan', 'snack', 'katering'],
  },
  {
    icon: 'category-travel',
    words: ['travel', 'libur', 'wisata', 'hotel', 'pesawat', 'jalan-jalan', 'cuti', 'penginapan'],
  },
  {
    icon: 'category-hiburan',
    // `tiket` sits here rather than under travel: a bare "Tiket" is far more
    // often a concert or a cinema than a flight, and "Tiket Pesawat" is claimed
    // by the transport rule above, which runs first.
    words: ['hibur', 'nonton', 'bioskop', 'game', 'main', 'netflix', 'spotify', 'konser', 'streaming', 'hobi', 'tiket'],
  },
  {
    icon: 'category-belanja',
    words: ['belanja', 'shop', 'baju', 'pakaian', 'fashion', 'tokopedia', 'shopee', 'elektronik', 'kosmetik', 'perabot', 'skincare'],
  },
  {
    icon: 'category-tabungan',
    words: ['tabung', 'saving', 'darurat', 'deposito', 'emas', 'investasi', 'reksa', 'saham'],
  },
  {
    icon: 'category-rumah',
    words: ['rumah', 'sewa', 'kontrak', 'kpr', 'renovasi', 'kebersihan', 'perbaikan', 'kost', 'dapur'],
  },
  {
    icon: 'category-pemasukan',
    words: ['pemasukan', 'gaji', 'income', 'bonus', 'thr', 'upah', 'honor', 'pendapatan', 'bagi hasil', 'untung', 'komisi'],
  },
  {
    icon: 'category-lainnya',
    words: ['lainnya', 'lain-lain', 'lain lain', 'other', 'misc', 'umum', 'tak terduga'],
  },
];

/** The icon a category falls back to when its name matches no rule. */
export function fallbackIcon(type: CategoryIconType | string): string {
  if (type === 'INCOME') return 'category-pemasukan';
  if (type === 'INVESTMENT') return 'category-tabungan';
  return 'category-lainnya';
}

/**
 * Lower-cases and normalises a category name for matching.
 *
 * Non-breaking spaces and runs of whitespace are collapsed because the names
 * come from a text input where both happen, and a rule written as `air ` would
 * otherwise miss a name ending in "Air" plus a stray space.
 */
function normalise(name: string): string {
  return name.toLowerCase().replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Whether `word` occurs in `name` at the start of a word.
 *
 * Deliberately not a plain `includes`. Indonesian adds suffixes to a stem
 * ("tabung" -> "Tabungan", "cicil" -> "Cicilan"), so the rule words are stems
 * and the match must be allowed to run past them. But a substring match also
 * fires mid-word, and that produced a real bug: the savings rule's `emas` (gold)
 * matched inside "p**emas**ukan", so the income category rendered with the
 * savings icon.
 *
 * Requiring a word boundary before the match keeps the suffix tolerance and
 * drops the false positive: "emas" starts "Emas" and "Emas Antam", but sits in
 * the middle of "pemasukan". Derivations in Indonesian add suffixes rather than
 * prefixes, so losing prefix-inside matches costs nothing — the bare forms are
 * listed explicitly where a name needs one (`pendidikan` alongside `didik`).
 */
function matchesWord(name: string, word: string): boolean {
  let from = 0;
  for (;;) {
    const at = name.indexOf(word, from);
    if (at === -1) return false;
    if (at === 0 || !/[\p{L}\p{N}]/u.test(name[at - 1])) return true;
    from = at + 1;
  }
}

/**
 * The asset-pack icon for a category.
 *
 * Returns a name that is guaranteed to exist in BRAND_ART: the family's picker
 * choice if it is a real pack icon, then the system roles, then the ordered
 * rules, then the type fallback. A brand-new category with an unrecognised name
 * therefore still gets an icon rather than a blank box.
 */
export function categoryIconName(cat: CategoryIconInput): string {
  // The picker's explicit choice outranks every heuristic below: the family said
  // which icon this is, and a rename must not quietly take it away. A value the
  // shipped pack does not have is ignored rather than rendered as nothing, so a
  // row written by a build with a different pack still shows an icon.
  if (cat.icon && PACK.has(cat.icon)) return cat.icon;

  // The two system categories are the app's own vocabulary, so they are decided
  // by role rather than by whatever the family renamed them to.
  if (cat.systemRole === 'DEBT_PAYMENT') return 'category-hutang';
  if (cat.systemRole === 'FINANCING_INFLOW') return 'category-pemasukan';

  const n = normalise(cat.name ?? '');
  if (n) {
    for (const rule of RULES) {
      for (const word of rule.words) {
        if (matchesWord(n, word)) return rule.icon;
      }
    }
  }
  return fallbackIcon(cat.type);
}
