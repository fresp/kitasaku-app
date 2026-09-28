import { useMemo } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import ChevronLeft from 'lucide-react-native/icons/chevron-left';
import ArrowRight from 'lucide-react-native/icons/arrow-right';
import ArrowDownLeft from 'lucide-react-native/icons/arrow-down-left';
import CalendarRange from 'lucide-react-native/icons/calendar-range';
import Landmark from 'lucide-react-native/icons/landmark';
import Lock from 'lucide-react-native/icons/lock';
import TrendingUp from 'lucide-react-native/icons/trending-up';
import Wallet from 'lucide-react-native/icons/wallet';
import { Colors, FontSize, Radius } from '../constants/theme';
import { BrandIcon } from '../components/ui/BrandIcon';
import { formatRupiah } from '../lib/format';
import { useAuth } from '../lib/auth-context';
import {
  useAccounts,
  useActiveCycle,
  useCycleAllocations,
  useCycleInstallments,
  useCycleSourceFunds,
  useObligations,
  useTemplates,
} from '../lib/queries';
import { cycleReadiness } from '../lib/zero-based';
import { currentInstallmentNumber, longDateFullLabel, shortDateLabel } from '../lib/obligation';
import { Badge } from '../components/ui/Badge';
import { PrimaryButton } from '../components/ui/Button';
import { QueryError } from '../components/ui/QueryError';
import { ZeroBasedProjection } from '../components/ui/ZeroBasedProjection';

/**
 * Screen 7B — Funding Gap.
 *
 * The blocked version of Buka Siklus. `new-cycle.tsx` is the form you fill in
 * from scratch; this is the same projection shown when the cycle already has
 * numbers and the required allocation exceeds the source funds, so the only
 * useful content is the arithmetic and the ways out of it.
 *
 * The arithmetic is not recomputed here. `sourceFunds` and `requiredAllocation`
 * come from `useCycleSourceFunds` and `useCycleAllocations` — the same queries
 * Home's allocation dashboard reads — so the gap on this screen and the gap on
 * Home cannot disagree. The only judgement made locally is the three-way
 * strategy list, and that is copy.
 *
 * Reaching a zero gap means the cycle can open: the CTA hands off to the
 * new-cycle form rather than opening anything itself.
 */
export default function FundingGapScreen() {
  const router = useRouter();
  const { household } = useAuth();
  const householdId = household?.id;

  const cycleQ = useActiveCycle(householdId);
  const cycleId = cycleQ.data?.id;
  const sourceQ = useCycleSourceFunds(householdId, cycleId, 'planned');
  const allocQ = useCycleAllocations(householdId, cycleId);
  const accsQ = useAccounts(householdId);
  const tmplQ = useTemplates(householdId);
  const obligQ = useObligations(householdId);
  const instQ = useCycleInstallments(householdId, cycleId);

  const source = sourceQ.data;
  const allocations = useMemo(() => allocQ.data ?? [], [allocQ.data]);

  const requiredAllocation = useMemo(
    () => allocations.reduce((s, a) => s + Math.max(0, a.amount), 0),
    [allocations]
  );
  const totalSource = source?.total ?? 0;
  // The same verdict Buka Siklus renders, from the same function — the two
  // screens are one question, and they used to answer it with two different
  // sums (§4.1 of the audit).
  const readiness = cycleReadiness(requiredAllocation, totalSource);
  const { fundingGap } = readiness;
  // A failed read leaves both sides at zero, which makes the gap zero too —
  // "ready to open". Never let an outage open a cycle.
  const loadFailed = sourceQ.isError || allocQ.isError;
  const canOpen = readiness.canOpen && !loadFailed;

  // The payroll amount, if the cycle has one — shown separately from financing
  // and asset release so the projection cannot be read as "we earned all this".
  const incomeInflow = source?.operatingIncome ?? 0;
  const financingInflow = source?.financingInflow ?? 0;
  const assetRelease = source?.assetRelease ?? 0;
  const otherInflow = financingInflow + assetRelease;

  const recurring = useMemo(
    () => allocations.filter((a) => a.allocation_type === 'EXPENSE'),
    [allocations]
  );
  const debtAllocations = useMemo(
    () => allocations.filter((a) => a.allocation_type === 'DEBT_PAYMENT'),
    [allocations]
  );
  const assetAllocations = useMemo(
    () =>
      allocations.filter((a) =>
        a.allocation_type === 'ASSET' ||
        a.allocation_type === 'SAVINGS' ||
        a.allocation_type === 'INVESTMENT' ||
        a.allocation_type === 'EMERGENCY_FUND'
      ),
    [allocations]
  );
  const totalRecurring = recurring.reduce((s, a) => s + a.amount, 0);
  const totalDebt = debtAllocations.reduce((s, a) => s + a.amount, 0);
  const totalAsset = assetAllocations.reduce((s, a) => s + a.amount, 0);
  // `requiredAllocation` sums every row above it, so the projection needs a
  // line for each bucket `ALLOCATION_ORDER` allows. OTHER is the one that used
  // to have no row.
  const otherAllocations = useMemo(
    () => allocations.filter((a) => a.allocation_type === 'OTHER'),
    [allocations]
  );
  const totalOther = otherAllocations.reduce((s, a) => s + a.amount, 0);

  const activeTemplates = useMemo(
    () => (tmplQ.data ?? []).filter((t) => t.status === 'ACTIVE'),
    [tmplQ.data]
  );
  const openObligations = useMemo(
    () =>
      (obligQ.data ?? []).filter(
        (o) => o.remaining_amount > 0 && o.status !== 'SETTLED' && o.status !== 'CANCELLED'
      ),
    [obligQ.data]
  );
  const openInstallments = useMemo(
    () => (instQ.data ?? []).filter((i) => i.status !== 'SETTLED' && i.status !== 'CANCELLED'),
    [instQ.data]
  );

  const cycleName = cycleQ.data?.name ?? 'Siklus ini';
  const cyclePeriod = cycleQ.data
    ? `${shortDateLabel(cycleQ.data.start_date) ?? '—'} – ${shortDateLabel(cycleQ.data.end_date) ?? '—'}`
    : null;

  const payrollAccount = accsQ.data?.[0]?.name ?? 'Belum ada akun';

  // The design's eyebrow reads "FUNDING GAP NOV" — one month token, not the
  // whole cycle name. Derived from the cycle's end date (the month a payday-to-
  // payday cycle is named for) so a cycle renamed by hand ("Siklus Gajian
  // Anak") still produces a month rather than "ANAK".
  const monthTag = cycleQ.data
    ? (shortDateLabel(cycleQ.data.end_date) ?? '').split(' ')[1]?.toUpperCase() ?? ''
    : '';

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={sourceQ.isFetching || allocQ.isFetching}
            onRefresh={() => { void sourceQ.refetch(); void allocQ.refetch(); void cycleQ.refetch(); }}
          />
        }
      >
        <View style={styles.nav}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <ChevronLeft size={18} color={Colors.textPrimary} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.navEyebrow}>
              PAYDAY SETUP · FUNDING GAP {monthTag || ''}
            </Text>
            <Text style={styles.navTitle}>Buka Siklus Anggaran Baru</Text>
          </View>
        </View>

        {/* Every number below is arithmetic on these reads, and a failed one
            leaves the sums at zero — which reads as "no gap", the one verdict
            this screen must never give by accident. */}
        {(sourceQ.isError || allocQ.isError) && householdId && (
          <QueryError
            onRetry={() => {
              sourceQ.refetch();
              allocQ.refetch();
              cycleQ.refetch();
            }}
            retrying={sourceQ.isFetching || allocQ.isFetching}
            message="Sumber dana atau alokasi belum bisa dibaca, jadi proyeksi di bawah belum bisa dipercaya. Datamu tidak hilang."
          />
        )}

        <Text style={styles.navSub}>
          {canOpen
            ? `Sumber dana ${formatRupiah(totalSource)} sudah menutup kebutuhan ${formatRupiah(requiredAllocation)} — siklus siap dibuka.`
            : `Kebutuhan ${formatRupiah(requiredAllocation)} melebihi Total Sumber Dana ${formatRupiah(totalSource)} — tutup Funding Gap sebelum siklus dibuka.`}
        </Text>

        <View style={styles.rowCard}>
          <View style={styles.iconBox}>
            <CalendarRange size={16} color={Colors.textPrimary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>{cycleName}</Text>
            <Text style={styles.rowSub}>{cyclePeriod ?? 'Periode belum ditentukan'}</Text>
          </View>
          <ArrowRight size={15} color={Colors.textMuted} />
        </View>

        <View style={styles.rowCard}>
          <View style={[styles.iconBox, { backgroundColor: Colors.paidBg }]}>
            <ArrowDownLeft size={16} color={Colors.paidText} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.eyebrow}>PEMASUKAN · {payrollAccount.toUpperCase()}</Text>
            <Text style={styles.incomeValue}>{formatRupiah(incomeInflow)}</Text>
            <Text style={styles.rowSub}>
              {otherInflow > 0
                ? `+ ${formatRupiah(otherInflow)} dari pendanaan & pencairan aset`
                : 'Hanya income operasional — tanpa pendanaan'}
            </Text>
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.cloneHead}>
            <Text style={styles.cardTitle}>Clone {activeTemplates.length} pos rutin</Text>
            <View style={styles.allCheck}>
              <Text style={styles.allCheckText}>
                {activeTemplates.length}/{activeTemplates.length}
              </Text>
            </View>
          </View>
          <Text style={styles.rowSub}>
            dari siklus sebelumnya · edit sebelum dibuka
          </Text>
          {activeTemplates.slice(0, 4).map((t) => (
            <View key={t.id} style={styles.cloneRow}>
              <View style={styles.checkBox}>
                <Text style={styles.checkMark}>✓</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cloneName}>{t.name}</Text>
                <Text style={styles.rowSub}>
                  {t.categories?.name ?? 'Tanpa kategori'} · {t.accounts?.name ?? 'Tanpa akun'}
                </Text>
              </View>
              <Text style={styles.cloneAmt}>{formatRupiah(t.default_amount)}</Text>
            </View>
          ))}
          {activeTemplates.length > 4 && (
            <Text style={styles.moreText}>
              + {activeTemplates.length - 4} pos lainnya sudah dicentang
            </Text>
          )}
          {activeTemplates.length === 0 && (
            <View style={styles.emptyArt}>
              <BrandIcon name="empty-belum-ada-rencana" size={72} label="" />
              <Text style={styles.rowSub}>Belum ada pos rutin aktif.</Text>
              {/* This used to read "Buat lewat Riwayat → Template Rutin", which
                  was a dead end twice over: Riwayat never linked to Template
                  Rutin, and until now nothing else did either. It is a button
                  to the real screen instead of directions to a route that did
                  not exist. */}
              <Pressable onPress={() => router.push('/templates')} style={styles.emptyCta}>
                <Text style={styles.emptyCtaText}>+ Buat pos rutin</Text>
              </Pressable>
            </View>
          )}
        </View>

        <View style={styles.card}>
          <View style={styles.kwHead}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Pembayaran Kewajiban Siklus Ini</Text>
              <Text style={styles.rowSub}>Kewajiban aktif yang dibawa dari siklus sebelumnya</Text>
            </View>
            <Badge label={`${openObligations.length} Kewajiban`} />
          </View>

          {openObligations.length === 0 && (
            <Text style={styles.rowSub}>Tidak ada kewajiban terbuka yang dibawa ke siklus ini.</Text>
          )}

          {openObligations.map((o) => {
            const inst = openInstallments.find((i) => i.obligation_id === o.id);
            const amount = inst?.planned_amount ?? o.remaining_amount;
            const total = o.installment_count ?? 0;
            // Derived from `remaining_amount` (which every payment path
            // decrements), NOT `o.current_installment` — that column is written
            // once as 1 and never updated, so it read "ke-1" for every loan
            // forever. See `currentInstallmentNumber` for the full reasoning.
            const current = currentInstallmentNumber(o);
            return (
              <View key={o.id} style={styles.kwRow}>
                <View style={styles.checkBox}>
                  <Text style={styles.checkMark}>✓</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cloneName}>{o.title}</Text>
                  <Text style={styles.rowSub}>
                    {current !== null ? `Cicilan ke-${current} dari ${total} • ` : ''}
                    {o.due_date ? `Jatuh tempo ${longDate(o.due_date)}` : `Sisa ${formatRupiah(o.remaining_amount)}`}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.cloneAmt}>{formatRupiah(amount)}</Text>
                  <Text style={styles.tag}>Pokok cicilan</Text>
                </View>
              </View>
            );
          })}

          <View style={styles.noteRow}>
            <Text style={styles.noteText}>
              Penerimaan pinjaman tidak dianggap sebagai income rutin dan tidak di-clone ke
              siklus berikutnya.
            </Text>
          </View>
        </View>

        <ZeroBasedProjection
          title={`ZERO-BASED ALLOCATION ${cycleName.toUpperCase()}`}
          source={{
            incomeLines: [
              { label: 'Total Sumber Dana (Income Operasional)', value: incomeInflow },
            ],
            financingInflow,
            assetRelease,
          }}
          allocations={{
            expense: totalRecurring,
            expenseCount: recurring.length,
            debtPayment: totalDebt,
            debtCount: debtAllocations.length,
            savingsAssets: totalAsset,
            savingsCount: assetAllocations.length,
            other: totalOther,
            otherCount: otherAllocations.length,
          }}
          readiness={readiness}
          strategies={
            !canOpen ? (
              <>
                <Text style={styles.strategiesTitle}>STRATEGI TUTUP FUNDING GAP</Text>
                <StrategyRow
                  icon={<TrendingUp size={14} color={Colors.paidText} />}
                  text={`Tambah Pendapatan · +${formatRupiah(fundingGap)}`}
                  onPress={() => router.push({ pathname: '/quick-add', params: { kind: 'in' } })}
                />
                {/* Asset release is a flow_type with no capture path yet: quick add
                    writes OPERATING_INCOME for every income and the insert never
                    sends ASSET_RELEASE. Shown as unavailable rather than routed to
                    a form that would silently record the wrong flow type. */}
                <StrategyRow
                  icon={<Wallet size={14} color={Colors.textMuted} />}
                  text="Pencairan Aset (Asset Release) · Dana Darurat"
                  note="Belum tersedia — catat lewat penyesuaian saldo akun"
                  disabled
                />
                <StrategyRow
                  icon={<Landmark size={14} color={Colors.loanText} />}
                  text="Pinjaman Baru (Financing Inflow) · +Liabilitas"
                  onPress={() => router.push({ pathname: '/quick-add', params: { kind: 'loan' } })}
                />
              </>
            ) : undefined
          }
        />

        <PrimaryButton
          label={
            loadFailed
              ? 'Muat Ulang Dulu'
              : canOpen
                ? 'Pilih Strategi & Buka Siklus'
                : 'Tutup Funding Gap Dulu'
          }
          onPress={() => {
            if (loadFailed) {
              sourceQ.refetch();
              allocQ.refetch();
              return;
            }
            if (canOpen) router.replace('/new-cycle');
          }}
        />

        <View style={styles.lockRow}>
          <Lock size={13} color={Colors.textMuted} />
          <Text style={styles.lockText}>
            Siklus tidak dapat dibuka selama Funding Gap belum tertutup · Unallocated Funds tidak
            boleh negatif.
          </Text>
        </View>

        {!householdId && (
          <Text style={styles.lockText}>Mode offline — login untuk angka live.</Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function StrategyRow({
  icon,
  text,
  note,
  onPress,
  disabled,
}: {
  icon: React.ReactNode;
  text: string;
  note?: string;
  onPress?: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.strategyRow, disabled && styles.strategyRowDisabled]}
    >
      {icon}
      <View style={{ flex: 1 }}>
        <Text style={styles.strategyText} numberOfLines={2}>{text}</Text>
        {!!note && <Text style={styles.strategyNote}>{note}</Text>}
      </View>
    </Pressable>
  );
}

/** `2026-10-25` -> `25 Oktober 2026`. Delegates to lib/obligation so this
 * screen and Detail Pinjaman spell the month the same way. */
function longDate(iso: string): string {
  return longDateFullLabel(iso) ?? iso;
}

const styles = StyleSheet.create({
  emptyArt: { alignItems: 'center', gap: 10, paddingVertical: 12 },
  emptyCta: {
    borderWidth: 1, borderColor: Colors.borderSubtle, backgroundColor: Colors.surface,
    borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 9,
  },
  emptyCtaText: { color: Colors.textPrimary, fontSize: FontSize.body, fontWeight: '700' },

  safe: { flex: 1, backgroundColor: Colors.canvas },
  container: { padding: 16, gap: 12, paddingBottom: 40 },

  nav: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  backBtn: {
    width: 34, height: 34, borderRadius: Radius.md, backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.borderSubtle, alignItems: 'center', justifyContent: 'center',
  },
  navEyebrow: { color: Colors.textMuted, fontSize: FontSize.microLabel, fontWeight: '700', letterSpacing: 0.8 },
  navTitle: { color: Colors.textPrimary, fontSize: FontSize.sectionTitle, fontWeight: '700' },
  navSub: { color: Colors.textSecondary, fontSize: FontSize.body, lineHeight: 18 },

  rowCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1,
    borderColor: Colors.borderSubtle, padding: 14,
  },
  iconBox: {
    width: 34, height: 34, borderRadius: Radius.sm, backgroundColor: Colors.subtle,
    alignItems: 'center', justifyContent: 'center',
  },
  rowTitle: { color: Colors.textPrimary, fontSize: FontSize.cardTitle, fontWeight: '600' },
  rowSub: { color: Colors.textMuted, fontSize: FontSize.caption, lineHeight: 16 },
  eyebrow: { color: Colors.textMuted, fontSize: FontSize.microLabel, fontWeight: '700', letterSpacing: 0.6 },
  incomeValue: {
    color: Colors.textPrimary, fontSize: 20, fontWeight: '700',
    fontVariant: ['tabular-nums'], marginTop: 1,
  },

  card: {
    backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1,
    borderColor: Colors.borderSubtle, padding: 14, gap: 8,
  },
  cardTitle: { color: Colors.textPrimary, fontSize: FontSize.cardTitle, fontWeight: '600' },
  cloneHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  allCheck: {
    backgroundColor: Colors.paidBg, borderRadius: Radius.pill,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  allCheckText: { color: Colors.paidText, fontSize: FontSize.caption, fontWeight: '700' },
  cloneRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  checkBox: {
    width: 22, height: 22, borderRadius: Radius.sm, backgroundColor: Colors.paidText,
    alignItems: 'center', justifyContent: 'center',
  },
  checkMark: { color: Colors.white, fontSize: 12, fontWeight: '700' },
  cloneName: { color: Colors.textPrimary, fontSize: FontSize.body, fontWeight: '600' },
  cloneAmt: {
    color: Colors.textPrimary, fontSize: FontSize.body, fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  moreText: { color: Colors.textSecondary, fontSize: FontSize.caption, fontWeight: '600' },

  kwHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  kwRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  tag: { color: Colors.textMuted, fontSize: FontSize.caption, marginTop: 1 },
  noteRow: { backgroundColor: Colors.canvas, borderRadius: Radius.sm, padding: 9 },
  noteText: { color: Colors.textSecondary, fontSize: FontSize.caption, lineHeight: 16 },

  strategiesTitle: {
    color: Colors.textMuted, fontSize: FontSize.microLabel, fontWeight: '700', letterSpacing: 1,
  },
  strategyRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.heroFooter, borderRadius: Radius.sm, padding: 10,
  },
  // `strategyText` dropped its `flex: 1` for the wrapping View the note needs.
  strategyText: { color: Colors.white, fontSize: FontSize.caption, fontWeight: '600' },
  // A strategy that cannot be run yet stays visible — the family should know the
  // option exists — but stops looking tappable.
  strategyRowDisabled: { opacity: 0.55 },
  strategyNote: { color: Colors.textMuted, fontSize: FontSize.microLabel, marginTop: 2 },

  lockRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 7 },
  lockText: { color: Colors.textMuted, fontSize: FontSize.caption, lineHeight: 16, flex: 1 },
});
