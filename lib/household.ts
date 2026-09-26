import { requireSupabase } from './supabase';

export interface Membership {
  id: string;
  household_id: string;
  user_id: string;
  role: 'OWNER' | 'PARTNER';
}

export interface Household {
  id: string;
  name: string;
  invite_code: string | null;
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
