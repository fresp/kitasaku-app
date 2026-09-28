import { displayNameFromEmail } from './profile';
import { requireSupabase } from './supabase';

export interface Membership {
  id: string;
  household_id: string;
  user_id: string;
  role: 'OWNER' | 'PARTNER';
  /** Migration 007. Null on a database that has not run it yet. */
  display_name?: string | null;
  notify_partner_expense?: boolean;
}

export type SweepPolicy = 'REQUIRED' | 'OFFERED';

export interface Household {
  id: string;
  name: string;
  invite_code: string | null;
  /** Day of month the family gets paid; null = never set (migration 007). */
  payday_day?: number | null;
  /** Cycle-close sweep treatment (migration 014). */
  sweep_policy?: SweepPolicy;
  created_at?: string;
}

export function generateInviteCode(name: string): string {
  const clean = name
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 3)
    .padEnd(3, 'X');
  const digits = Math.floor(100 + Math.random() * 900).toString();
  return `${clean}-${digits}`;
}

export async function getMyMembership(): Promise<Membership | null> {
  const sb = requireSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return null;
  const { data, error } = await sb
    .from('household_members')
    .select('*')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as Membership | null) ?? null;
}

export async function getHousehold(id: string): Promise<Household | null> {
  const sb = requireSupabase();
  const { data, error } = await sb.from('households').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return (data as Household | null) ?? null;
}

export interface HouseholdMember {
  id: string;
  user_id: string;
  role: 'OWNER' | 'PARTNER';
  display_name: string | null;
  email: string | null;
  notify_partner_expense: boolean;
  joined_at: string;
  is_me: boolean;
}

/**
 * The family roster for Ruang Keluarga.
 *
 * The email comes from `auth.users` via a SECURITY DEFINER RPC (migration 007)
 * because the client cannot read that table and the 001 policy on
 * household_members only exposes the caller's own row. If 007 has not been run
 * yet the RPC is missing, so this falls back to the direct select — which
 * returns just the caller. That is a truthful degradation (a roster of one)
 * rather than an empty screen, and `useHouseholdMembers` marks it as partial so
 * the UI can say why.
 */
export async function listHouseholdMembers(householdId: string): Promise<{
  members: HouseholdMember[];
  partial: boolean;
}> {
  const sb = requireSupabase();
  try {
    const { data, error } = await sb.rpc('list_household_members', {
      p_household_id: householdId,
    });
    if (error) throw error;
    const rows = (Array.isArray(data) ? data : []) as HouseholdMember[];
    if (rows.length > 0) {
      return {
        members: rows.map((r) => ({
          ...r,
          notify_partner_expense: r.notify_partner_expense ?? true,
          display_name: r.display_name ?? null,
          email: r.email ?? null,
          is_me: r.is_me ?? false,
        })),
        partial: false,
      };
    }
  } catch {
    // migration 007 not run — fall through to the caller's own row.
  }

  const {
    data: { user },
  } = await sb.auth.getUser();
  const { data, error } = await sb
    .from('household_members')
    .select('*')
    .eq('household_id', householdId);
  if (error) throw error;
  const rows = ((data ?? []) as Partial<HouseholdMember>[]).map((r) => ({
    id: r.id!,
    user_id: r.user_id!,
    role: (r.role as 'OWNER' | 'PARTNER') ?? 'PARTNER',
    display_name: r.display_name ?? null,
    email: null,
    notify_partner_expense: r.notify_partner_expense ?? true,
    joined_at: r.joined_at ?? '',
    is_me: r.user_id === user?.id,
  }));
  return { members: rows, partial: true };
}

/**
 * Rename the household and/or set the payday day.
 *
 * 001 gave `households` a SELECT policy only, so this needs the UPDATE policy
 * added in 007. Empty strings are rejected here as well as in the UI: the
 * household name is the title of every screen that mentions the family, and a
 * blank one would render as an empty header.
 */
export async function updateHousehold(args: {
  id: string;
  name?: string;
  paydayDay?: number | null;
  sweepPolicy?: SweepPolicy;
}): Promise<Household> {
  const sb = requireSupabase();
  const patch: Record<string, string | number | null> = {};
  if (args.name !== undefined) {
    const name = args.name.trim();
    if (name.length < 3) throw new Error('Nama ruang keluarga minimal 3 huruf.');
    patch.name = name;
  }
  if (args.paydayDay !== undefined) {
    if (args.paydayDay !== null && (args.paydayDay < 1 || args.paydayDay > 31)) {
      throw new Error('Tanggal payday harus antara 1 dan 31.');
    }
    patch.payday_day = args.paydayDay;
  }
  if (args.sweepPolicy !== undefined) {
    if (args.sweepPolicy !== 'REQUIRED' && args.sweepPolicy !== 'OFFERED') {
      throw new Error('Kebijakan sapu akun tidak dikenal.');
    }
    patch.sweep_policy = args.sweepPolicy;
  }
  if (Object.keys(patch).length === 0) {
    const current = await getHousehold(args.id);
    if (!current) throw new Error('Ruang keluarga tidak ditemukan.');
    return current;
  }
  const { data, error } = await sb
    .from('households')
    .update(patch)
    .eq('id', args.id)
    .select('*')
    .single();
  if (error) throw error;
  return data as Household;
}

/**
 * Save the caller's own display name and/or expense-notification preference.
 *
 * Both columns live on household_members, and 001's `members_manage_household_tables`
 * policy is `user_id = auth.uid()` — so this can only ever touch the caller's
 * own row. It deliberately does NOT take a member id: passing someone else's id
 * would silently no-op under RLS, which is a confusing failure.
 */
export async function updateMyMemberProfile(args: {
  householdId: string;
  displayName?: string;
  notifyPartnerExpense?: boolean;
}): Promise<void> {
  const sb = requireSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) throw new Error('Belum login.');

  const patch: Record<string, string | boolean> = {};
  if (args.displayName !== undefined) {
    const name = args.displayName.trim();
    if (name.length < 2) throw new Error('Nama minimal 2 huruf.');
    patch.display_name = name;
  }
  if (args.notifyPartnerExpense !== undefined) {
    patch.notify_partner_expense = args.notifyPartnerExpense;
  }
  if (Object.keys(patch).length === 0) return;

  const { error } = await sb
    .from('household_members')
    .update(patch)
    .eq('household_id', args.householdId)
    .eq('user_id', user.id);
  if (error) throw error;
}

export interface HouseholdPreview {
  id: string;
  name: string;
  active_count: number;
}

export async function previewHouseholdByCode(code: string): Promise<HouseholdPreview | null> {
  const sb = requireSupabase();
  const normalized = code.trim().toUpperCase();
  if (!normalized) return null;
  try {
    const { data, error } = await sb.rpc('lookup_household_by_code', { p_code: normalized });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    return { id: row.id, name: row.name, active_count: Number(row.active_count ?? 0) };
  } catch {
    // Fallback for when migration 002 has not been run: direct select (members only)
    const { data: hh } = await sb
      .from('households')
      .select('*')
      .eq('invite_code', normalized)
      .maybeSingle();
    if (!hh) return null;
    return { id: (hh as Household).id, name: (hh as Household).name, active_count: 0 };
  }
}

export async function createHousehold(name: string): Promise<Household> {
  const sb = requireSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) throw new Error('Belum login.');

  const invite_code = generateInviteCode(name);
  // Primary path: security-definer RPC (works around the RLS chicken-and-egg)
  try {
    const { data, error } = await sb.rpc('create_household', {
      p_name: name.trim(),
      p_invite_code: invite_code,
    });
    if (error) throw error;
    if (data) return data as Household;
  } catch {
    // Fallback: direct insert (succeeds if the insert policy has been opened)
  }

  const { data: hh, error: hhErr } = await sb
    .from('households')
    .insert({ name: name.trim(), invite_code })
    .select('*')
    .single();
  if (hhErr) throw hhErr;

  const { error: mErr } = await sb.from('household_members').insert({
    household_id: (hh as Household).id,
    user_id: user.id,
    role: 'OWNER',
    // The RPC seeds this from the email local-part (007); the fallback path
    // (only reached when the RPC is missing) mirrors it so the profile is not
    // nameless on a database that has not run 007 yet.
    display_name: displayNameFromEmail(user.email),
  });
  if (mErr) throw mErr;
  return hh as Household;
}

export async function joinHouseholdByCode(code: string): Promise<Household> {
  const sb = requireSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) throw new Error('Belum login.');

  const normalized = code.trim().toUpperCase();
  // Primary path: security-definer RPC so a non-member can join via invite code
  try {
    const { data, error } = await sb.rpc('join_household_by_code', { p_code: normalized });
    if (error) throw error;
    if (data) return data as Household;
  } catch (e: any) {
    const msg = e?.message ?? '';
    if (msg.includes('tidak ditemukan')) throw e;
    // fall through to the direct fallback if migration 002 has not been run
  }

  const { data: hh, error: hhErr } = await sb
    .from('households')
    .select('*')
    .eq('invite_code', normalized)
    .maybeSingle();
  if (hhErr) throw hhErr;
  if (!hh) throw new Error('Kode undangan tidak ditemukan. Cek lagi kodenya ya.');

  const { error: mErr } = await sb.from('household_members').upsert(
    {
      household_id: (hh as Household).id,
      user_id: user.id,
      role: 'PARTNER',
      display_name: displayNameFromEmail(user.email),
    },
    { onConflict: 'household_id,user_id' }
  );
  if (mErr) throw mErr;
  return hh as Household;
}

export function buildInviteMessage(householdName: string, code: string): string {
  return (
    `Gabung ke ruang keluarga "${householdName}" di Kitasaku!\n\n` +
    `Kode undangan: ${code}\n\n` +
    `1. Install Kitasaku (Expo Go) lalu login\n` +
    `2. Pilih "Gabung Ruang Keluarga"\n` +
    `3. Masukkan kode di atas\n\n` +
    `Satu data, dua HP — real-time.`
  );
}
