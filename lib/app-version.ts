/**
 * Version gate for sideloaded APKs. The app is not distributed through a store,
 * so nothing tells an installed build that a newer one exists; one row in
 * `app_releases` (migration 035) does.
 *
 * Two thresholds, both Android `versionCode`s (the integer EAS increments):
 *   - below `minVersionCode`    → the build must not keep writing (force)
 *   - below `latestVersionCode` → a newer build exists (soft, can be postponed)
 *
 * Raise `min` only AFTER the new APK is published and BEFORE a breaking server
 * change (revoking an RPC grant, changing a contract an old build relies on).
 */

export type AppRelease = {
  latestVersionCode: number;
  latestVersionName: string;
  minVersionCode: number;
  apkUrl: string | null;
  notes: string[];
};

export type AppReleaseRow = {
  latest_version_code: number;
  latest_version_name: string;
  min_version_code: number;
  apk_url: string | null;
  notes: string | null;
};

export type UpdateGate =
  | { kind: 'none' }
  | { kind: 'soft'; release: AppRelease }
  | { kind: 'force'; release: AppRelease };

/** `Application.nativeBuildVersion` is a string on Android and null on web. */
export function parseBuildNumber(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export function releaseFromRow(row: AppReleaseRow | null | undefined): AppRelease | null {
  if (!row) return null;
  const url = row.apk_url?.trim();
  return {
    latestVersionCode: row.latest_version_code,
    latestVersionName: row.latest_version_name.trim(),
    minVersionCode: row.min_version_code,
    apkUrl: url ? url : null,
    notes: (row.notes ?? '')
      .split('\n')
      .map((line) => line.replace(/^[-•*]\s*/, '').trim())
      .filter((line) => line.length > 0),
  };
}

/**
 * `dismissedVersionCode` is the `latestVersionCode` the family tapped "Nanti
 * saja" on; it only silences the soft notice for that same release, never the
 * force gate.
 */
export function decideUpdateGate(
  currentVersionCode: number | null,
  release: AppRelease | null,
  dismissedVersionCode: number | null = null,
): UpdateGate {
  // Web, dev client or a missing row: nothing to compare against.
  if (currentVersionCode == null || !release) return { kind: 'none' };
  if (currentVersionCode < release.minVersionCode) return { kind: 'force', release };
  if (currentVersionCode < release.latestVersionCode && dismissedVersionCode !== release.latestVersionCode) {
    return { kind: 'soft', release };
  }
  return { kind: 'none' };
}
