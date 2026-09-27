import { describe, expect, it } from 'vitest';
import {
  cycleDayIndex,
  cycleRangeLabel,
  displayNameFromEmail,
  householdMeta,
  joinedMonthLabel,
  memberCountLabel,
  memberDisplayName,
  memberInitials,
  paydayLabel,
  paydayShort,
  realtimeLabel,
  roleLabel,
  rosterLabel,
} from '../profile';

// Continues the numbering from zero-based.test.ts (which stops at 36) so a
// failing test number is unambiguous across the suite.

describe('member identity (phase 5a)', () => {
  it('37: initials take the first letter of one word and both ends of two', () => {
    expect(memberInitials('Andra')).toBe('A');
    expect(memberInitials('Istri Andra')).toBe('IA');
    expect(memberInitials('  andra   wijaya  ')).toBe('AW');
    expect(memberInitials('Ryu')).toBe('R');
  });

  it('38: a nameless member gets a placeholder, never a blank circle', () => {
    expect(memberInitials(null)).toBe('?');
    expect(memberInitials('')).toBe('?');
    expect(memberInitials('   ')).toBe('?');
    expect(memberInitials('!!!')).toBe('?');
  });

  it('39: the two roles use the design copy, not a shared template', () => {
    expect(roleLabel('OWNER')).toBe('Owner / Inisiator');
    expect(roleLabel('PARTNER')).toBe('Pasangan');
    expect(roleLabel(null)).toBe('Pasangan');
  });

  it('40: the caller is marked "(Anda)" and only the caller', () => {
    expect(memberDisplayName('Andra', 'OWNER', true)).toBe('Andra (Anda)');
    expect(memberDisplayName('Istri Andra', 'PARTNER', false)).toBe('Istri Andra');
    expect(memberDisplayName('Istri Andra', 'PARTNER')).toBe('Istri Andra');
  });

  it('41: a member with no name falls back to their role, not to the email', () => {
    expect(memberDisplayName(null, 'OWNER', true)).toBe('Owner / Inisiator (Anda)');
    expect(memberDisplayName('  ', 'PARTNER', false)).toBe('Pasangan');
  });

  it('42: seeded names mirror the SQL seeding rule', () => {
    expect(displayNameFromEmail('andra@example.com')).toBe('Andra');
    expect(displayNameFromEmail('andra.wijaya@example.com')).toBe('Andra Wijaya');
    expect(displayNameFromEmail('istri_andra@example.com')).toBe('Istri Andra');
    expect(displayNameFromEmail('a-b.c@example.com')).toBe('A B C');
    expect(displayNameFromEmail(null)).toBeNull();
    expect(displayNameFromEmail('@example.com')).toBeNull();
  });
});

describe('household presentation (phase 5a)', () => {
  it('43: payday is stated or explicitly unset — never guessed', () => {
    expect(paydayShort(25)).toBe('Tgl 25');
    expect(paydayShort(null)).toBeNull();
    expect(paydayShort(0)).toBeNull();
    expect(paydayShort(32)).toBeNull();
    expect(paydayLabel(25, 'row')).toBe('Payday-to-payday · Tanggal 25');
    expect(paydayLabel(25, 'meta')).toBe('Siklus Payday: Tgl 25');
    expect(paydayLabel(null, 'row')).toBe('Siklus belum diatur');
    expect(paydayLabel(null, 'meta')).toBe('Siklus Payday: belum diatur');
  });

  it('44: counts read "0 anggota" rather than "-1 anggota" or "NaN"', () => {
    expect(memberCountLabel(2)).toBe('2 anggota');
    expect(memberCountLabel(0)).toBe('0 anggota');
    expect(memberCountLabel(-3)).toBe('0 anggota');
    expect(rosterLabel(2)).toBe('ANGGOTA KELUARGA (2 ORANG)');
    expect(rosterLabel(1)).toBe('ANGGOTA KELUARGA (1 ORANG)');
  });

  it('45: "Dibuat Sep 2026" reads the timestamp without shifting the month', () => {
    // A timestamptz at the very end of a UTC month must not roll into the next
    // month for a reader whose device is ahead of UTC.
    expect(joinedMonthLabel('2026-09-01T00:00:00+00:00')).toBe('Dibuat Sep 2026');
    expect(joinedMonthLabel('2026-09-30T23:59:59Z')).toBe('Dibuat Sep 2026');
    expect(joinedMonthLabel('2026-12-31T16:00:00Z')).toBe('Dibuat Des 2026');
    expect(joinedMonthLabel(null)).toBeNull();
    expect(joinedMonthLabel('lalu')).toBeNull();
  });

  it('46: meta lines drop missing fragments instead of leaving a dangling bullet', () => {
    expect(householdMeta(['Keluarga Andra', '2 anggota'])).toBe('Keluarga Andra  •  2 anggota');
    expect(householdMeta(['Keluarga Andra', null])).toBe('Keluarga Andra');
    expect(householdMeta([null, null])).toBe('');
    expect(householdMeta(['Keluarga Andra', 'Siklus Payday: Tgl 25', 'Dibuat Sep 2026'])).toBe(
      'Keluarga Andra  •  Siklus Payday: Tgl 25  •  Dibuat Sep 2026'
    );
  });

  it('47: the cycle pill counts days and clamps at both ends', () => {
    expect(cycleRangeLabel('2026-09-25', '2026-10-24')).toBe('25 Sep – 24 Okt');
    expect(cycleRangeLabel('2026-09-25', '2026-10-24', '2026-09-25')).toBe(
      '25 Sep – 24 Okt  •  Hari ke-1'
    );
    expect(cycleRangeLabel('2026-09-25', '2026-10-24', '2026-10-02')).toBe(
      '25 Sep – 24 Okt  •  Hari ke-8'
    );
    // A cycle nobody closed must not read "Hari ke-137".
    expect(cycleRangeLabel('2026-09-25', '2026-10-24', '2027-02-09')).toBe(
      '25 Sep – 24 Okt  •  Hari ke-30'
    );
    // ...and one that has not started clamps to day 1, not day 0 or negative.
    expect(cycleRangeLabel('2026-09-25', '2026-10-24', '2026-09-20')).toBe(
      '25 Sep – 24 Okt  •  Hari ke-1'
    );
    expect(cycleRangeLabel(null, '2026-10-24')).toBeNull();
  });

  it('48: a backwards or unparseable cycle reports no day index', () => {
    expect(cycleDayIndex('2026-10-24', '2026-09-25', '2026-10-01')).toBeNull();
    expect(cycleDayIndex('2026-09-25', '2026-10-24', 'besok')).toBeNull();
  });

  it('49: realtime is described as on or off, never as "maybe"', () => {
    expect(realtimeLabel(true)).toBe('Real-time aktif');
    expect(realtimeLabel(false)).toBe('Real-time nonaktif');
  });
});
