import { describe, expect, it } from 'vitest';
import { decideUpdateGate, parseBuildNumber, releaseFromRow, type AppRelease } from '../app-version';

const release: AppRelease = {
  latestVersionCode: 12,
  latestVersionName: '1.2.0',
  minVersionCode: 10,
  apkUrl: 'https://example.test/kitasaku.apk',
  notes: [],
};

describe('parseBuildNumber', () => {
  it('reads the Android versionCode string', () => {
    expect(parseBuildNumber('12')).toBe(12);
    expect(parseBuildNumber(' 7 ')).toBe(7);
  });
  it('returns null for web, empty or non-numeric values', () => {
    expect(parseBuildNumber(null)).toBeNull();
    expect(parseBuildNumber(undefined)).toBeNull();
    expect(parseBuildNumber('')).toBeNull();
    expect(parseBuildNumber('1.2.0')).toBeNull();
    expect(parseBuildNumber('0')).toBeNull();
  });
});

describe('releaseFromRow', () => {
  it('splits notes into lines and strips bullets', () => {
    const r = releaseFromRow({
      latest_version_code: 12,
      latest_version_name: ' 1.2.0 ',
      min_version_code: 10,
      apk_url: '  ',
      notes: '- Notifikasi Ruang Keluarga\n\n• Bayar sekaligus\n  Perbaikan Riwayat  ',
    });
    expect(r).toEqual({
      latestVersionCode: 12,
      latestVersionName: '1.2.0',
      minVersionCode: 10,
      apkUrl: null,
      notes: ['Notifikasi Ruang Keluarga', 'Bayar sekaligus', 'Perbaikan Riwayat'],
    });
  });
  it('returns null when there is no row', () => {
    expect(releaseFromRow(null)).toBeNull();
  });
});

describe('decideUpdateGate', () => {
  it('does nothing without a build number or a release row', () => {
    expect(decideUpdateGate(null, release)).toEqual({ kind: 'none' });
    expect(decideUpdateGate(9, null)).toEqual({ kind: 'none' });
  });
  it('forces below the minimum, even when the soft notice was dismissed', () => {
    expect(decideUpdateGate(9, release, 12)).toEqual({ kind: 'force', release });
  });
  it('offers a soft update between minimum and latest', () => {
    expect(decideUpdateGate(10, release)).toEqual({ kind: 'soft', release });
    expect(decideUpdateGate(11, release)).toEqual({ kind: 'soft', release });
  });
  it('stays quiet once the same release was dismissed', () => {
    expect(decideUpdateGate(11, release, 12)).toEqual({ kind: 'none' });
  });
  it('asks again when a newer release than the dismissed one appears', () => {
    expect(decideUpdateGate(11, { ...release, latestVersionCode: 13 }, 12).kind).toBe('soft');
  });
  it('stays quiet on the latest build or newer', () => {
    expect(decideUpdateGate(12, release)).toEqual({ kind: 'none' });
    expect(decideUpdateGate(14, release)).toEqual({ kind: 'none' });
  });
});
