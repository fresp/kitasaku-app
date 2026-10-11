import { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import ArrowLeft from 'lucide-react-native/icons/arrow-left';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import Plus from 'lucide-react-native/icons/plus';
import TrendingUp from 'lucide-react-native/icons/trending-up';
import X from 'lucide-react-native/icons/x';
import { Colors, FontSize, Radius } from '../constants/theme';
import { formatRupiah } from '../lib/format';
import { useAuth } from '../lib/auth-context';
import {
  useAccounts,
  useActiveCycle,
  useAssetValuations,
  useAssets,
  useCreateAsset,
  useCreateAssetAllocation,
  useCreateAssetRelease,
  useRecordAssetValuation,
} from '../lib/queries';
import { PrimaryButton } from '../components/ui/Button';
import { QueryError } from '../components/ui/QueryError';

const BANDS = [
  { key: 'EMERGENCY_FUND', label: 'Dana darurat' },
  { key: 'CHILD', label: 'Anak' },
  { key: 'INVESTMENT', label: 'Investasi' },
  { key: 'LIQUIDITY', label: 'Likuiditas' },
] as const;

type Operation = 'allocate' | 'release' | 'value';

const OPERATION_LABEL: Record<Operation, string> = {
  allocate: 'Top up',
  release: 'Cairkan',
  value: 'Catat nilai',
};

function bandLabel(band: string): string {
  return BANDS.find((b) => b.key === band)?.label ?? band;
}

function parseAmount(text: string): number {
  const digits = text.replace(/[^0-9]/g, '');
  return digits ? Number(digits) : 0;
}

/**
 * Repository Aset.
 *
 * The screen used to stack two inline forms: "Posisi Aset Baru" above the
 * list, and an operation card that only appeared once an asset chip was
 * tapped — so the page grew under the finger, and one card served three
 * operations whose contents mutated between them. Both are sheets now, and
 * the positions render as cards carrying their own latest valuation.
 */
export default function AssetsScreen() {
  const router = useRouter();
  const { household } = useAuth();
  const householdId = household?.id;
  const cycleQ = useActiveCycle(householdId);
  const accountsQ = useAccounts(householdId);
  const assetsQ = useAssets(householdId);
  const createAsset = useCreateAsset();
  const allocate = useCreateAssetAllocation();
  const release = useCreateAssetRelease();
  const recordValue = useRecordAssetValuation();

  const accounts = useMemo(() => accountsQ.data ?? [], [accountsQ.data]);
  const assets = useMemo(() => assetsQ.data ?? [], [assetsQ.data]);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const selectedAsset = assets.find((a) => a.id === selectedAssetId) ?? null;
  const valuationsQ = useAssetValuations(householdId, selectedAsset?.id);

  const [operation, setOperation] = useState<Operation>('allocate');
  const [opOpen, setOpOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [accountPickerOpen, setAccountPickerOpen] = useState(false);
  const [assetName, setAssetName] = useState('');
  const [band, setBand] = useState<string>('INVESTMENT');
  const [amountText, setAmountText] = useState('');
  const [name, setName] = useState('');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [valueDate, setValueDate] = useState(new Date().toISOString().slice(0, 10));
  const [err, setErr] = useState<string | null>(null);

  const amount = parseAmount(amountText);
  const selectedAccountId = accountId ?? accounts[0]?.id ?? null;
  const selectedAccount = accounts.find((a) => a.id === selectedAccountId) ?? null;
  const mutationPending =
    allocate.isPending || release.isPending || recordValue.isPending || createAsset.isPending;
  const latestValue = valuationsQ.data?.[0] ?? null;

  function openOperation(assetId: string, op: Operation) {
    setErr(null);
    setSelectedAssetId(assetId);
    setOperation(op);
    setAmountText('');
    setName('');
    setOpOpen(true);
  }

  function closeOperation() {
    setOpOpen(false);
    setAccountPickerOpen(false);
    setErr(null);
  }

  function openCreate() {
    setErr(null);
    setAssetName('');
    setBand('INVESTMENT');
    setCreateOpen(true);
  }

  async function saveAsset() {
    setErr(null);
    if (!householdId) { setErr('Login dulu untuk membuat posisi aset.'); return; }
    if (assetName.trim().length < 2) { setErr('Nama aset minimal 2 huruf.'); return; }
    try {
      const created = await createAsset.mutateAsync({ householdId, name: assetName.trim(), band });
      setSelectedAssetId(created.id);
      setAssetName('');
      setCreateOpen(false);
    } catch (e: any) {
      setErr(e?.message ?? 'Posisi aset belum tersimpan.');
    }
  }

  async function submitOperation() {
    setErr(null);
    if (!householdId || !selectedAsset) { setErr('Pilih atau buat posisi aset dulu.'); return; }
    if (operation !== 'value' && !selectedAccountId) { setErr('Pilih akun kas sumber atau tujuan.'); return; }
    if (amount <= 0) { setErr('Nominal harus lebih dari Rp 0.'); return; }
    const operationName =
      name.trim() ||
      (operation === 'allocate' ? `Top up ${selectedAsset.name}` : `Pencairan ${selectedAsset.name}`);
    try {
      if (operation === 'allocate') {
        await allocate.mutateAsync({ householdId, cycleId: cycleQ.data?.id ?? null, name: operationName, amount, accountId: selectedAccountId!, assetId: selectedAsset.id, categoryId: null });
      } else if (operation === 'release') {
        await release.mutateAsync({ householdId, cycleId: cycleQ.data?.id ?? null, name: operationName, amount, accountId: selectedAccountId!, assetId: selectedAsset.id, categoryId: null });
      } else {
        await recordValue.mutateAsync({ householdId, assetId: selectedAsset.id, statedValue: amount, valuedAt: valueDate });
      }
      setAmountText('');
      setName('');
      closeOperation();
    } catch (e: any) {
      setErr(e?.message ?? 'Perubahan aset belum tersimpan.');
    }
  }

  // Only the valuation operation can state a before/after, because a stated
  // valuation is a snapshot the family types in. A top up does NOT move it:
  // contributions and valuation are deliberately separate in this domain, so
  // projecting "posisi jadi X" after a top up would be an invented figure.
  const valuationDelta =
    operation === 'value' && latestValue && amount > 0
      ? amount - latestValue.stated_value
      : null;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.back} accessibilityLabel="Kembali">
            <ArrowLeft size={18} color={Colors.textPrimary} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.eyebrow}>REPOSITORY ASET</Text>
            <Text style={styles.title}>Aset & Investasi</Text>
          </View>
          <Pressable onPress={openCreate} style={styles.add}>
            <Plus size={15} color={Colors.white} />
            <Text style={styles.addText}>Aset</Text>
          </Pressable>
        </View>

        <View style={styles.infoCard}>
          <TrendingUp size={20} color={Colors.chartInvestment} />
          <Text style={styles.infoText}>
            Alokasi ke aset adalah perpindahan nilai dari kas, bukan income. Nilai pasar
            hanya dicatat sebagai stated valuation dan tidak mengubah kas.
          </Text>
        </View>

        {assetsQ.isError && (
          <QueryError
            onRetry={() => assetsQ.refetch()}
            retrying={assetsQ.isFetching}
            message="Repository aset belum bisa dibaca."
          />
        )}

        <Text style={styles.label}>POSISI AKTIF</Text>
        {assets.length === 0 && !assetsQ.isLoading && (
          <Text style={styles.muted}>
            Belum ada posisi aset. Buat posisi pertama untuk memisahkan kontribusi dan
            valuasi.
          </Text>
        )}

        {assets.map((asset) => (
          <Pressable
            key={asset.id}
            onPress={() => openOperation(asset.id, 'allocate')}
            style={styles.assetCard}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.assetName}>{asset.name}</Text>
              <Text style={styles.assetBand}>{bandLabel(asset.band)}</Text>
            </View>
            {/* The valuation lives in the sheet, not here: useAssetValuations
                resolves one asset at a time, so printing it per card would
                either need a query per row or show a figure for one card and a
                placeholder on the rest. */}
            {asset.id === selectedAsset?.id && latestValue && (
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.assetValue}>
                  {formatRupiah(latestValue.stated_value)}
                </Text>
                <Text style={styles.assetBand}>{latestValue.valued_at}</Text>
              </View>
            )}
            <ChevronRight size={14} color={Colors.textMuted} />
          </Pressable>
        ))}

        {err && !opOpen && !createOpen && <Text style={styles.error}>{err}</Text>}
      </ScrollView>

      {/* ---- New position ---- */}
      <Modal visible={createOpen} transparent animationType="slide" onRequestClose={() => setCreateOpen(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.scrim}
        >
          <View style={styles.sheet}>
            <View style={styles.grab} />
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>Posisi aset baru</Text>
              <Pressable onPress={() => setCreateOpen(false)} hitSlop={10}>
                <X size={20} color={Colors.textPrimary} />
              </Pressable>
            </View>
            <Text style={styles.label}>NAMA POSISI</Text>
            <TextInput
              value={assetName}
              onChangeText={setAssetName}
              placeholder="mis. Reksa dana pendidikan"
              placeholderTextColor={Colors.textMuted}
              style={styles.input}
            />
            <Text style={styles.label}>BAND</Text>
            <View style={styles.chips}>
              {BANDS.map((item) => (
                <Pressable
                  key={item.key}
                  onPress={() => setBand(item.key)}
                  style={[styles.chip, band === item.key && styles.chipActive]}
                >
                  <Text style={[styles.chipText, band === item.key && styles.chipTextActive]}>
                    {item.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            {err && <Text style={styles.error}>{err}</Text>}
            <PrimaryButton
              label={createAsset.isPending ? 'Menyimpan…' : 'Buat Posisi Aset'}
              onPress={saveAsset}
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ---- Operation ---- */}
      <Modal visible={opOpen} transparent animationType="slide" onRequestClose={closeOperation}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.scrim}
        >
          <View style={styles.sheet}>
            <View style={styles.grab} />
            {selectedAsset && (
              <ScrollView
                contentContainerStyle={{ gap: 10, paddingBottom: 18 }}
                keyboardShouldPersistTaps="handled"
              >
                <View style={styles.sheetHead}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sheetTitle}>
                      {OPERATION_LABEL[operation]} {selectedAsset.name}
                    </Text>
                    <Text style={styles.sheetSub}>
                      {bandLabel(selectedAsset.band)} · valuasi terakhir{' '}
                      {latestValue ? formatRupiah(latestValue.stated_value) : 'belum dicatat'}
                    </Text>
                  </View>
                  <Pressable onPress={closeOperation} hitSlop={10}>
                    <X size={20} color={Colors.textPrimary} />
                  </Pressable>
                </View>

                <View style={styles.seg}>
                  {(['allocate', 'release', 'value'] as const).map((op) => (
                    <Pressable
                      key={op}
                      onPress={() => setOperation(op)}
                      style={[styles.segItem, operation === op && styles.segItemOn]}
                    >
                      <Text style={[styles.segText, operation === op && styles.segTextOn]}>
                        {OPERATION_LABEL[op]}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <View style={styles.moneyBox}>
                  <Text style={styles.label}>
                    {operation === 'value' ? 'NILAI ASET' : 'NOMINAL'}
                  </Text>
                  <TextInput
                    value={amountText}
                    onChangeText={setAmountText}
                    placeholder="0"
                    placeholderTextColor={Colors.borderStrong}
                    keyboardType="number-pad"
                    style={styles.moneyInput}
                  />
                  <Text style={styles.moneyEcho}>{formatRupiah(amount)}</Text>
                  {valuationDelta !== null && valuationDelta !== 0 && (
                    <Text
                      style={[
                        styles.moneyDelta,
                        valuationDelta < 0 && styles.moneyDeltaDown,
                      ]}
                    >
                      {valuationDelta > 0 ? 'Naik' : 'Turun'}{' '}
                      {formatRupiah(Math.abs(valuationDelta))} dari valuasi terakhir.
                    </Text>
                  )}
                </View>

                {operation === 'value' ? (
                  <>
                    <Text style={styles.label}>TANGGAL NILAI</Text>
                    <TextInput
                      value={valueDate}
                      onChangeText={setValueDate}
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor={Colors.textMuted}
                      style={styles.input}
                    />
                    <View style={styles.infoCard}>
                      <TrendingUp size={16} color={Colors.textSecondary} />
                      <Text style={styles.infoText}>
                        Ini hanya snapshot nilai. Tidak menciptakan income dan tidak
                        menggerakkan kas.
                      </Text>
                    </View>
                  </>
                ) : (
                  <>
                    <Pressable onPress={() => setAccountPickerOpen(true)} style={styles.pickRow}>
                      <Text style={styles.pickLabel}>
                        {operation === 'allocate' ? 'Dari akun kas' : 'Ke akun kas'}
                      </Text>
                      <View style={styles.pickValueWrap}>
                        <Text
                          style={[styles.pickValue, !selectedAccount && styles.pickValueMuted]}
                          numberOfLines={1}
                        >
                          {selectedAccount?.name ?? 'Belum dipilih'}
                        </Text>
                        <ChevronRight size={14} color={Colors.textMuted} />
                      </View>
                    </Pressable>
                    <TextInput
                      value={name}
                      onChangeText={setName}
                      placeholder="Catatan (opsional)"
                      placeholderTextColor={Colors.textMuted}
                      style={styles.input}
                    />
                    <Text style={styles.muted}>
                      {cycleQ.data
                        ? `Tercatat di siklus ${cycleQ.data.name}.`
                        : 'Belum ada siklus aktif — tercatat sebagai transaksi audit non-siklus.'}
                    </Text>
                  </>
                )}

                {valuationsQ.isError && (
                  <QueryError
                    onRetry={() => valuationsQ.refetch()}
                    retrying={valuationsQ.isFetching}
                    message="Riwayat valuasi belum bisa dibaca."
                  />
                )}
                {valuationsQ.data && valuationsQ.data.length > 0 && (
                  <View style={styles.historyBox}>
                    <Text style={styles.label}>RIWAYAT VALUASI</Text>
                    {valuationsQ.data.slice(0, 5).map((v) => (
                      <View key={v.id} style={styles.historyRow}>
                        <Text style={styles.muted}>{v.valued_at}</Text>
                        <Text style={styles.historyValue}>{formatRupiah(v.stated_value)}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {err && <Text style={styles.error}>{err}</Text>}

                <PrimaryButton
                  label={
                    mutationPending
                      ? 'Menyimpan…'
                      : operation === 'allocate'
                        ? 'Simpan Top Up'
                        : operation === 'release'
                          ? 'Simpan Pencairan'
                          : 'Simpan Valuasi'
                  }
                  onPress={mutationPending ? undefined : submitOperation}
                />
              </ScrollView>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ---- Account picker ---- */}
      <Modal
        visible={accountPickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setAccountPickerOpen(false)}
      >
        <Pressable style={styles.scrim} onPress={() => setAccountPickerOpen(false)}>
          <Pressable style={styles.pickerSheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.grab} />
            <Text style={styles.sheetTitle}>
              {operation === 'allocate' ? 'Dari akun kas' : 'Ke akun kas'}
            </Text>
            <ScrollView style={{ maxHeight: 340 }} contentContainerStyle={{ paddingVertical: 6 }}>
              {accounts.map((a) => {
                const selected = a.id === selectedAccountId;
                return (
                  <Pressable
                    key={a.id}
                    onPress={() => { setAccountId(a.id); setAccountPickerOpen(false); }}
                    style={[styles.optionRow, selected && styles.optionRowOn]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.optionText, selected && styles.optionTextOn]}>
                        {a.name}
                      </Text>
                      <Text style={styles.optionSub}>{a.type}</Text>
                    </View>
                    {selected && <Text style={styles.optionCheck}>✓</Text>}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.canvas },
  container: { padding: 16, gap: 10, paddingBottom: 36 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  back: {
    width: 36, height: 36, borderRadius: Radius.pill, backgroundColor: Colors.surface,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.borderSubtle,
  },
  eyebrow: { color: Colors.textMuted, fontSize: FontSize.microLabel, fontWeight: '700', letterSpacing: 0.8 },
  title: { color: Colors.textPrimary, fontSize: 23, fontWeight: '700', marginTop: 2 },
  add: {
    flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: Colors.brandPrimary,
    borderRadius: Radius.pill, paddingHorizontal: 11, paddingVertical: 8,
  },
  addText: { color: Colors.white, fontSize: FontSize.caption, fontWeight: '700' },

  infoCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 13,
    backgroundColor: Colors.subtle, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.borderSubtle,
  },
  infoText: { flex: 1, color: Colors.textSecondary, fontSize: FontSize.caption, lineHeight: 17 },

  label: { color: Colors.textMuted, fontSize: FontSize.microLabel, fontWeight: '700', letterSpacing: 0.7, marginTop: 4 },
  input: {
    height: 44, borderWidth: 1, borderColor: Colors.borderSubtle, borderRadius: Radius.md,
    paddingHorizontal: 12, color: Colors.textPrimary, backgroundColor: Colors.canvas,
    fontSize: FontSize.body,
  },
  muted: { color: Colors.textMuted, fontSize: FontSize.caption, lineHeight: 16 },
  error: { color: Colors.pendingText, backgroundColor: Colors.pendingBg, borderRadius: Radius.md, padding: 12, fontSize: FontSize.body },

  assetCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10, padding: 13,
    backgroundColor: Colors.surface, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.borderSubtle,
  },
  assetName: { color: Colors.textPrimary, fontSize: 14, fontWeight: '700' },
  assetBand: { color: Colors.textMuted, fontSize: FontSize.caption },
  assetValue: { color: Colors.accentStrong, fontSize: 13.5, fontWeight: '700', fontVariant: ['tabular-nums'] },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: {
    backgroundColor: Colors.subtle, borderRadius: Radius.pill, paddingHorizontal: 11,
    paddingVertical: 8, borderWidth: 1, borderColor: Colors.subtle,
  },
  chipActive: { backgroundColor: Colors.brandPrimary, borderColor: Colors.brandPrimary },
  chipText: { color: Colors.textSecondary, fontSize: FontSize.caption, fontWeight: '600' },
  chipTextActive: { color: Colors.white },

  scrim: { flex: 1, backgroundColor: Colors.overlayScrim, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 18, paddingBottom: 28, maxHeight: '88%', gap: 8,
  },
  pickerSheet: {
    backgroundColor: Colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 18, paddingBottom: 28, gap: 6,
  },
  grab: {
    width: 44, height: 4, borderRadius: Radius.pill, backgroundColor: Colors.borderStrong,
    alignSelf: 'center', marginBottom: 10,
  },
  sheetHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  sheetTitle: { color: Colors.textPrimary, fontSize: 17, fontWeight: '800', flex: 1 },
  sheetSub: { color: Colors.textMuted, fontSize: FontSize.caption, marginTop: 3 },

  seg: { flexDirection: 'row', backgroundColor: Colors.subtle, borderRadius: Radius.pill, padding: 3 },
  segItem: { flex: 1, paddingVertical: 8, borderRadius: Radius.pill, alignItems: 'center' },
  segItemOn: { backgroundColor: Colors.brandPrimary },
  segText: { color: Colors.textSecondary, fontSize: 12.5, fontWeight: '600' },
  segTextOn: { color: Colors.white, fontWeight: '700' },

  moneyBox: {
    borderWidth: 1.5, borderColor: Colors.brandPrimary, borderRadius: Radius.md,
    padding: 12, gap: 2, backgroundColor: Colors.surface,
  },
  moneyInput: {
    fontSize: 26, fontWeight: '800', color: Colors.textPrimary,
    fontVariant: ['tabular-nums'], padding: 0, marginTop: 2,
  },
  moneyEcho: { color: Colors.textSecondary, fontSize: FontSize.body, fontWeight: '600' },
  moneyDelta: { color: Colors.accentStrong, fontSize: FontSize.caption, marginTop: 2 },
  moneyDeltaDown: { color: Colors.pendingText },

  pickRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1, borderColor: Colors.borderSubtle, borderRadius: Radius.md,
    paddingHorizontal: 13, paddingVertical: 13, backgroundColor: Colors.surface,
  },
  pickLabel: { color: Colors.textSecondary, fontSize: 12.5 },
  pickValueWrap: { flexDirection: 'row', alignItems: 'center', gap: 7, marginLeft: 'auto', flexShrink: 1 },
  pickValue: { color: Colors.textPrimary, fontSize: 13.5, fontWeight: '700', flexShrink: 1 },
  pickValueMuted: { color: Colors.textMuted, fontWeight: '500' },

  historyBox: {
    backgroundColor: Colors.canvas, borderRadius: Radius.md, padding: 12,
    borderWidth: 1, borderColor: Colors.borderSubtle, gap: 2,
  },
  historyRow: {
    flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6,
    borderTopWidth: 1, borderTopColor: Colors.borderSubtle,
  },
  historyValue: { color: Colors.textPrimary, fontSize: FontSize.body, fontWeight: '700' },

  optionRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 13, paddingHorizontal: 12, borderRadius: Radius.md,
  },
  optionRowOn: { backgroundColor: Colors.subtle },
  optionText: { color: Colors.textPrimary, fontSize: 14 },
  optionTextOn: { fontWeight: '700' },
  optionSub: { color: Colors.textMuted, fontSize: FontSize.caption, marginTop: 1 },
  optionCheck: { color: Colors.accentStrong, fontSize: 15, fontWeight: '800' },
});
