import { describe, expect, it } from 'vitest';
import {
  cycleDayIndex,
  cycleRangeLabel,
  cycleWindowFrom,
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

// The window a family is opening right now. These replace the literals that
// used to be hard-coded ('Siklus Nov 2026' with dates in it), so the cases that
// matter are the month boundaries and the short months.
describe('cycle window from payday', () => {
  it('50: opens on this month\'s payday once the day arrives', () => {
    expect(cycleWindowFrom(25, '2026-10-25')).toEqual({
      name: 'Siklus Nov 2026',
      start: '2026-10-25',
      end: '2026-11-24',
    });
    // Mid-cycle: the window is already open, so it keeps its start date.
    expect(cycleWindowFrom(25, '2026-11-02')).toEqual({
      name: 'Siklus Nov 2026',
      start: '2026-10-25',
      end: '2026-11-24',
    });
  });

  it('51: before payday it reports the window that opened last month', () => {
    expect(cycleWindowFrom(25, '2026-10-24')).toEqual({
      name: 'Siklus Okt 2026',
      start: '2026-09-25',
      end: '2026-10-24',
    });
  });

  it('52: the name follows the month the cycle closes in, not the one it opens in', () => {
    // lib/insight.ts files a cycle under the month it *ends* in, so the form
    // must agree or the new cycle lands in the wrong column of the trend chart.
    expect(cycleWindowFrom(25, '2026-10-25')!.name).toBe('Siklus Nov 2026');
    expect(cycleWindowFrom(1, '2026-10-01')!.name).toBe('Siklus Okt 2026');
  });

  it('53: a payday of 29-31 clamps to the short month instead of sliding into the next', () => {
    // 31 Jan -> the next payday is 28 Feb (2027 is not a leap year).
    expect(cycleWindowFrom(31, '2027-01-31')).toEqual({
      name: 'Siklus Feb 2027',
      start: '2027-01-31',
      end: '2027-02-27',
    });
    // A 29 payday survives a leap February...
    expect(cycleWindowFrom(29, '2028-02-29')!.end).toBe('2028-03-28');
    // ...and a payday that does not exist in February ends the window on the
    // clamped date, one day before the payday it is standing in for.
    expect(cycleWindowFrom(30, '2027-02-27')).toEqual({
      name: 'Siklus Feb 2027',
      start: '2027-01-30',
      end: '2027-02-27',
    });
    expect(cycleWindowFrom(30, '2027-03-30')!.end).toBe('2027-04-29');
  });

  it('54: an unset payday anchors a one-month window on today rather than refusing', () => {
    const w = cycleWindowFrom(null, '2026-10-10');
    expect(w).toEqual({ name: 'Siklus Nov 2026', start: '2026-10-10', end: '2026-11-09' });
    // Same window for an out-of-range day: 0 and 99 are not paydays.
    expect(cycleWindowFrom(0, '2026-10-10')).toEqual(w);
    expect(cycleWindowFrom(99, '2026-10-10')).toEqual(w);
    expect(cycleWindowFrom(undefined, '2026-10-10')).toEqual(w);
  });

  it('55: an unparseable date yields null instead of an "Invalid Date" window', () => {
    expect(cycleWindowFrom(25, 'besok')).toBeNull();
    expect(cycleWindowFrom(25, '')).toBeNull();
  });

  it('56: December rolls the closing month into the next year', () => {
    expect(cycleWindowFrom(25, '2026-12-25')).toEqual({
      name: 'Siklus Jan 2027',
      start: '2026-12-25',
      end: '2027-01-24',
    });
    // ...and a January start before payday rolls the *opening* year back.
    expect(cycleWindowFrom(25, '2027-01-10')).toEqual({
      name: 'Siklus Jan 2027',
      start: '2026-12-25',
      end: '2027-01-24',
    });
  });
});
