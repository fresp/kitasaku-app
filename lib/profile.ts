// Identity and household presentation helpers.
//
// Kept apart from `zero-based.ts` on purpose: that module is the money
// contract (source funds, allocations, funding gap) and every function in it
// can move a number. Nothing here touches an amount — these are the labels on
// My Profile and Ruang Keluarga, and they are pure so they can be tested
// without a database.
//
// Design source: "Screen - My Profile" and "Screen 14 - Ruang Keluarga".

import { MONTHS_ID } from './zero-based';

export type MemberRole = 'OWNER' | 'PARTNER';

/**
 * Avatar initials. Two words give two letters ("Istri Andra" -> "IA"); one
 * word gives one ("Andra" -> "A", matching the design). An empty or
 * whitespace-only name falls back to '?' rather than rendering a blank circle,
 * because a member seeded before migration 007 could legitimately have no
 * display name.
 */
export function memberInitials(name: string | null | undefined): string {
  const parts = (name ?? '')
    .trim()
    .split(/\s+/)
    .filter((p) => /[a-zA-Z0-9]/.test(p));
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * The role chip. The design writes "Owner / Inisiator" for the founder and
 * "Pasangan" for the partner — the two roles are not symmetric in the copy, so
 * a single template string would read wrong on one of them.
 */
export function roleLabel(role: MemberRole | string | null | undefined): string {
  return role === 'OWNER' ? 'Owner / Inisiator' : 'Pasangan';
}

/**
 * The member's name as it should appear in a list. A member with no
 * display name is labelled by role instead of by an email local-part — the
 * email is shown on its own line, so repeating it here would read as a bug.
 */
export function memberDisplayName(
  displayName: string | null | undefined,
  role: MemberRole | string | null | undefined,
  isMe?: boolean
): string {
  const base = (displayName ?? '').trim() || roleLabel(role);
  return isMe ? `${base} (Anda)` : base;
}

/** "Tgl 25" / null when unset. The caller decides how to phrase "unset". */
export function paydayShort(paydayDay: number | null | undefined): string | null {
  if (paydayDay === null || paydayDay === undefined) return null;
  if (!Number.isFinite(paydayDay) || paydayDay < 1 || paydayDay > 31) return null;
  return `Tgl ${Math.floor(paydayDay)}`;
}

/**
 * The two payday phrasings in the design: the profile summary row reads
 * "Payday-to-payday · Tanggal 25", Ruang Keluarga's meta line reads
 * "Siklus Payday: Tgl 25". Both go through here so they cannot drift.
 */
export function paydayLabel(paydayDay: number | null | undefined, style: 'row' | 'meta'): string {
  const short = paydayShort(paydayDay);
  if (!short) return style === 'row' ? 'Siklus belum diatur' : 'Siklus Payday: belum diatur';
  return style === 'row' ? `Payday-to-payday · Tanggal ${paydayShort(paydayDay)!.slice(4)}` : `Siklus Payday: ${short}`;
}

/** "2 anggota" — the profile's Ruang Keluarga subtitle. */
export function memberCountLabel(count: number): string {
  const n = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  return `${n} anggota`;
}

export interface CycleWindow {
  name: string;
  start: string;
  end: string;
}

/**
 * The payday-to-payday window a family is opening right now, from its payday
 * day and today's date.
 *
 * The defaults this replaces were literal (`new-cycle.tsx` opened on
 * "Siklus Nov 2026" with dates in it, `lib/seed.ts` seeded "Siklus Okt 2026"),
 * so a family signing up in any other month met a form pre-filled with someone
 * else's cycle — dated in the past. The dates are derivable, so they are
 * derived.
 *
 * Rules, following the design's own naming (`lib/insight.ts` files a cycle
 * under the month it *ends* in, so "Siklus Nov" runs 25 Oct – 24 Nov):
 *
 *   * If today is on or after this month's payday, the window opens on that
 *     payday; otherwise it opened on last month's.
 *   * It closes the day before the following payday.
 *   * A payday of 29–31 clamps to the last day of a shorter month, so "tanggal
 *     31" in February opens 28 Feb rather than sliding into March.
 *
 * An unset or invalid payday means the family has not told the app when they
 * are paid (Ruang Keluarga leaves `payday_day` null by default). The window
 * then runs one month from today rather than refusing to open — the dates are
 * editable on this very form, and a blank date field is a worse start than a
 * correct-length window anchored on today.
 */
export function cycleWindowFrom(
  paydayDay: number | null | undefined,
  todayISO: string
): CycleWindow | null {
  const [ty, tm, td] = todayISO.slice(0, 10).split('-').map((p) => parseInt(p, 10));
  if (!Number.isFinite(ty) || !Number.isFinite(tm) || !Number.isFinite(td)) return null;
  if (dayNumber(todayISO) === null) return null;

  const hasPayday =
    paydayDay !== null && paydayDay !== undefined && Number.isFinite(paydayDay) &&
    paydayDay >= 1 && paydayDay <= 31;
  // No payday on file: anchor the cycle on today instead of guessing one.
  const day = hasPayday ? Math.floor(paydayDay!) : td;

  // This month's payday, clamped to the month's real length.
  const thisPayday = clampDay(ty, tm, day);
  const opensThisMonth = td >= thisPayday;

  const startYear = opensThisMonth ? ty : tm === 1 ? ty - 1 : ty;
  // Rolling back from January lands on December — not month 0, which would
  // format as "2027-00-25".
  const startMonth = opensThisMonth ? tm : tm === 1 ? 12 : tm - 1;
  const startDay = clampDay(startYear, startMonth, day);

  const endYear = startMonth === 12 ? startYear + 1 : startYear;
  const endMonth = startMonth === 12 ? 1 : startMonth + 1;
  // A cycle ends the day before the next payday.
  const end = new Date(Date.UTC(endYear, endMonth - 1, clampDay(endYear, endMonth, day)));
  end.setUTCDate(end.getUTCDate() - 1);

  const endISO = end.toISOString().slice(0, 10);
  const endMonthIndex = parseInt(endISO.slice(5, 7), 10) - 1;
  return {
    name: `Siklus ${MONTHS_ID[endMonthIndex]} ${endISO.slice(0, 4)}`,
    start: isoFrom(startYear, startMonth, startDay),
    end: endISO,
  };
}

/** Day `day`, clamped to the real length of `year`-`month` (1-based month). */
function clampDay(year: number, month: number, day: number): number {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Math.min(day, lastDay);
}

function isoFrom(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}



/** "ANGGOTA KELUARGA (2 ORANG)" — the roster heading. */
export function rosterLabel(count: number): string {
  const n = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  return `ANGGOTA KELUARGA (${n} ORANG)`;
}

/**
 * "Dibuat Sep 2026" from a timestamptz. Timestamps arrive with a time and a
 * zone, so only the leading `YYYY-MM` is parsed — reading it as a local Date
 * would shift the month for anyone east or west of UTC.
 */
export function joinedMonthLabel(joinedAt: string | null | undefined): string | null {
  if (!joinedAt) return null;
  const m = /^(\d{4})-(\d{2})/.exec(joinedAt);
  if (!m) return null;
  const month = MONTHS_ID[parseInt(m[2], 10) - 1];
  if (!month) return null;
  return `Dibuat ${month} ${m[1]}`;
}

/**
 * "Keluarga Andra · 2 anggota" / "Keluarga Andra · Dibuat Sep 2026". Either
 * fragment may be missing, so the separator is only inserted when there is
 * something on both sides.
 */
export function householdMeta(
  parts: (string | null | undefined)[],
  separator = '  •  '
): string {
  return parts.filter((p): p is string => !!p && p.trim().length > 0).join(separator);
}

/**
 * "25 Sep – 24 Okt  •  Hari ke-1". Day 1 is the cycle's start date; a date
 * before the start clamps to 1 and one after the end reports the final day, so
 * a cycle the family forgot to close does not read "Hari ke-137".
 */
export function cycleRangeLabel(
  startISO: string | null | undefined,
  endISO: string | null | undefined,
  todayISO?: string
): string | null {
  const start = shortDay(startISO);
  const end = shortDay(endISO);
  if (!start || !end) return null;
  const range = `${start} – ${end}`;
  if (!todayISO) return range;
  const day = cycleDayIndex(startISO!, endISO!, todayISO);
  if (day === null) return range;
  return `${range}  •  Hari ke-${day}`;
}

/** Whole-day index within the cycle, 1-based. Null when the dates are unusable. */
export function cycleDayIndex(
  startISO: string,
  endISO: string,
  todayISO: string
): number | null {
  const start = dayNumber(startISO);
  const end = dayNumber(endISO);
  const today = dayNumber(todayISO);
  if (start === null || end === null || today === null || end < start) return null;
  const clamped = Math.min(Math.max(today, start), end);
  return Math.floor((clamped - start) / 86_400_000) + 1;
}

/** "25 Sep" — day and short month, no year (the cycle pill keeps it compact). */
function shortDay(iso: string | null | undefined): string | null {  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  if (!m) return null;
  const month = MONTHS_ID[parseInt(m[2], 10) - 1];
  if (!month) return null;
  return `${parseInt(m[3], 10)} ${month}`;
}

function dayNumber(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const t = Date.UTC(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
  return Number.isFinite(t) ? t : null;
}

/**
 * "Real-time aktif" vs "Real-time nonaktif" for the profile row. Realtime is
 * the household's sync state, so this is derived from whether a household is
 * actually connected — not from a per-device toggle that would claim a sync
 * that is not happening.
 */
export function realtimeLabel(connected: boolean): string {
  return connected ? 'Real-time aktif' : 'Real-time nonaktif';
}

/**
 * "andra.wijaya@example.com" -> "Andra Wijaya".
 *
 * Mirrors `seed_member_display_name` in migration 007 so the RPC path and the
 * client fallback produce the same name; otherwise a family that joined before
 * the migration would show a different name than one that joined after.
 *
 * Lives here rather than in `household.ts` because that module imports the
 * Supabase client (and therefore React Native), and this is a pure string
 * function the test suite can exercise directly.
 */
export function displayNameFromEmail(email: string | null | undefined): string | null {
  const local = (email ?? '').split('@')[0]?.trim();
  if (!local) return null;
  const words = local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  return words.length > 0 ? words.join(' ') : null;
}
