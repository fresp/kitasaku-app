import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import ArrowLeft from 'lucide-react-native/icons/arrow-left';
import Plus from 'lucide-react-native/icons/plus';
import TrendingUp from 'lucide-react-native/icons/trending-up';
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
import { PrimaryButton, SecondaryButton } from '../components/ui/Button';
import { QueryError } from '../components/ui/QueryError';

const BANDS = [
  { key: 'EMERGENCY_FUND', label: 'Dana darurat' },
  { key: 'CHILD', label: 'Anak' },
  { key: 'INVESTMENT', label: 'Investasi' },
  { key: 'LIQUIDITY', label: 'Likuiditas' },
] as const;

type Operation = 'allocate' | 'release' | 'value';

function parseAmount(text: string): number {
  const digits = text.replace(/[^0-9]/g, '');
  return digits ? Number(digits) : 0;
}

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
  const selectedAsset = assets.find((a) => a.id === selectedAssetId) ?? assets[0] ?? null;
  const valuationsQ = useAssetValuations(householdId, selectedAsset?.id);

  const [operation, setOperation] = useState<Operation>('allocate');
  const [showCreate, setShowCreate] = useState(false);
  const [assetName, setAssetName] = useState('');
  const [band, setBand] = useState<string>('INVESTMENT');
  const [amountText, setAmountText] = useState('');
  const [name, setName] = useState('');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [valueDate, setValueDate] = useState(new Date().toISOString().slice(0, 10));
  const [err, setErr] = useState<string | null>(null);
  const amount = parseAmount(amountText);
  const selectedAccountId = accountId ?? accounts[0]?.id ?? null;
  const mutationPending = allocate.isPending || release.isPending || recordValue.isPending || createAsset.isPending;
  const latestValue = valuationsQ.data?.[0] ?? null;

  async function saveAsset() {
    setErr(null);
    if (!householdId) { setErr('Login dulu untuk membuat posisi aset.'); return; }
    if (assetName.trim().length < 2) { setErr('Nama aset minimal 2 huruf.'); return; }
    try {
      const created = await createAsset.mutateAsync({ householdId, name: assetName.trim(), band });
      setSelectedAssetId(created.id);
      setAssetName('');
      setShowCreate(false);
    } catch (e: any) {
      setErr(e?.message ?? 'Posisi aset belum tersimpan.');
    }
  }

  async function submitOperation() {
    setErr(null);
    if (!householdId || !selectedAsset) { setErr('Pilih atau buat posisi aset dulu.'); return; }
    if (operation !== 'value' && !selectedAccountId) { setErr('Pilih akun kas sumber atau tujuan.'); return; }
    if (amount <= 0) { setErr('Nominal harus lebih dari Rp 0.'); return; }
    const operationName = name.trim() || (operation === 'allocate' ? `Top up ${selectedAsset.name}` : `Pencairan ${selectedAsset.name}`);
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
    } catch (e: any) {
      setErr(e?.message ?? 'Perubahan aset belum tersimpan.');
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.back} accessibilityLabel="Kembali"><ArrowLeft size={18} color={Colors.textPrimary} /></Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.eyebrow}>REPOSITORY ASET</Text>
            <Text style={styles.title}>Aset & Investasi</Text>
          </View>
          <Pressable onPress={() => setShowCreate((v) => !v)} style={styles.add}><Plus size={15} color={Colors.white} /><Text style={styles.addText}>Aset</Text></Pressable>
        </View>

        <View style={styles.infoCard}>
          <TrendingUp size={20} color={Colors.chartInvestment} />
          <Text style={styles.infoText}>Alokasi ke aset adalah perpindahan nilai dari kas, bukan income. Nilai pasar hanya dicatat sebagai stated valuation dan tidak mengubah kas.</Text>
        </View>

        {assetsQ.isError && <QueryError onRetry={() => assetsQ.refetch()} retrying={assetsQ.isFetching} message="Repository aset belum bisa dibaca." />}
        {showCreate && (
          <View style={styles.card}>
            <Text style={styles.label}>POSISI ASET BARU</Text>
            <TextInput value={assetName} onChangeText={setAssetName} placeholder="mis. Reksa dana pendidikan" placeholderTextColor={Colors.textMuted} style={styles.input} />
            <View style={styles.chips}>{BANDS.map((item) => <Pressable key={item.key} onPress={() => setBand(item.key)} style={[styles.chip, band === item.key && styles.chipActive]}><Text style={[styles.chipText, band === item.key && styles.chipTextActive]}>{item.label}</Text></Pressable>)}</View>
            <PrimaryButton label={createAsset.isPending ? 'Menyimpan…' : 'Buat Posisi Aset'} onPress={saveAsset} />
          </View>
        )}

        <Text style={styles.label}>POSISI AKTIF</Text>
        {assets.length === 0 && !assetsQ.isLoading && <Text style={styles.muted}>Belum ada posisi aset. Buat posisi pertama untuk memisahkan kontribusi dan valuasi.</Text>}
        <View style={styles.chips}>{assets.map((asset) => <Pressable key={asset.id} onPress={() => setSelectedAssetId(asset.id)} style={[styles.assetChip, selectedAsset?.id === asset.id && styles.assetChipActive]}><Text style={styles.assetName}>{asset.name}</Text><Text style={styles.assetBand}>{BANDS.find((b) => b.key === asset.band)?.label ?? asset.band}</Text></Pressable>)}</View>

        {selectedAsset && (
          <>
            <View style={styles.selectedCard}>
              <View style={{ flex: 1 }}><Text style={styles.selectedLabel}>POSISI TERPILIH</Text><Text style={styles.selectedName}>{selectedAsset.name}</Text><Text style={styles.muted}>{BANDS.find((b) => b.key === selectedAsset.band)?.label ?? selectedAsset.band}</Text></View>
              <View style={styles.valueBox}><Text style={styles.valueLabel}>VALUASI TERAKHIR</Text><Text style={styles.value}>{latestValue ? formatRupiah(latestValue.stated_value) : 'Belum diketahui'}</Text><Text style={styles.muted}>{latestValue?.valued_at ?? 'Belum dicatat'}</Text></View>
            </View>
            <View style={styles.tabs}>{([['allocate', 'Top up'], ['release', 'Cairkan'], ['value', 'Catat nilai']] as const).map(([key, label]) => <Pressable key={key} onPress={() => setOperation(key)} style={[styles.tab, operation === key && styles.tabActive]}><Text style={[styles.tabText, operation === key && styles.tabTextActive]}>{label}</Text></Pressable>)}</View>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{operation === 'allocate' ? 'Top up dari akun kas' : operation === 'release' ? 'Cairkan ke akun kas' : 'Catat stated valuation'}</Text>
              <Text style={styles.muted}>{operation === 'value' ? 'Ini hanya snapshot nilai; tidak menciptakan income atau pergerakan kas.' : `Siklus aktif: ${cycleQ.data?.name ?? 'dicatat sebagai transaksi audit non-siklus'}`}</Text>
              <Text style={styles.label}>{operation === 'value' ? 'NILAI ASET' : 'NOMINAL'}</Text>
              <TextInput value={amountText} onChangeText={setAmountText} placeholder="mis. 1500000" placeholderTextColor={Colors.textMuted} keyboardType="number-pad" style={styles.amountInput} />
              <Text style={styles.amountHint}>{formatRupiah(amount)}</Text>
              {operation === 'value' && <><Text style={styles.label}>TANGGAL NILAI</Text><TextInput value={valueDate} onChangeText={setValueDate} placeholder="YYYY-MM-DD" placeholderTextColor={Colors.textMuted} style={styles.input} /></>}
              {operation !== 'value' && <><Text style={styles.label}>AKUN KAS</Text><View style={styles.chips}>{accounts.map((account) => <Pressable key={account.id} onPress={() => setAccountId(account.id)} style={[styles.chip, selectedAccountId === account.id && styles.chipActive]}><Text style={[styles.chipText, selectedAccountId === account.id && styles.chipTextActive]}>{account.name}</Text></Pressable>)}</View><TextInput value={name} onChangeText={setName} placeholder="Catatan (opsional)" placeholderTextColor={Colors.textMuted} style={styles.input} /></>}
              <PrimaryButton label={mutationPending ? 'Menyimpan…' : operation === 'allocate' ? 'Simpan Top Up' : operation === 'release' ? 'Simpan Pencairan' : 'Simpan Valuasi'} onPress={mutationPending ? undefined : submitOperation} />
            </View>
            {valuationsQ.isError && <QueryError onRetry={() => valuationsQ.refetch()} retrying={valuationsQ.isFetching} message="Riwayat valuasi belum bisa dibaca." />}
            {valuationsQ.data && valuationsQ.data.length > 0 && <View style={styles.card}><Text style={styles.cardTitle}>Riwayat valuasi</Text>{valuationsQ.data.slice(0, 5).map((v) => <View key={v.id} style={styles.historyRow}><Text style={styles.muted}>{v.valued_at}</Text><Text style={styles.historyValue}>{formatRupiah(v.stated_value)}</Text></View>)}</View>}
          </>
        )}
        {err && <Text style={styles.error}>{err}</Text>}
        <SecondaryButton label="Tutup" onPress={() => router.back()} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.canvas },
  container: { padding: 16, gap: 12, paddingBottom: 36 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  back: { width: 36, height: 36, borderRadius: Radius.pill, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.borderSubtle },
  eyebrow: { color: Colors.textMuted, fontSize: FontSize.microLabel, fontWeight: '700', letterSpacing: 0.8 },
  title: { color: Colors.textPrimary, fontSize: 23, fontWeight: '700', marginTop: 2 },
  add: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: Colors.brandPrimary, borderRadius: Radius.pill, paddingHorizontal: 11, paddingVertical: 8 },
  addText: { color: Colors.white, fontSize: FontSize.caption, fontWeight: '700' },
  infoCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 13, backgroundColor: Colors.subtle, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.borderSubtle },
  infoText: { flex: 1, color: Colors.textSecondary, fontSize: FontSize.body, lineHeight: 19 },
  card: { gap: 8, padding: 15, backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.borderSubtle },
  cardTitle: { color: Colors.textPrimary, fontSize: FontSize.cardTitle, fontWeight: '700' },
  label: { color: Colors.textMuted, fontSize: FontSize.microLabel, fontWeight: '700', letterSpacing: 0.7, marginTop: 4 },
  input: { height: 44, borderWidth: 1, borderColor: Colors.borderSubtle, borderRadius: Radius.md, paddingHorizontal: 12, color: Colors.textPrimary, backgroundColor: Colors.canvas, fontSize: FontSize.body },
  amountInput: { color: Colors.textPrimary, fontSize: 28, fontWeight: '700', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: Colors.borderStrong },
  amountHint: { color: Colors.textSecondary, fontSize: FontSize.body },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: { backgroundColor: Colors.subtle, borderRadius: Radius.pill, paddingHorizontal: 11, paddingVertical: 8, borderWidth: 1, borderColor: Colors.subtle },
  chipActive: { backgroundColor: Colors.brandPrimary, borderColor: Colors.brandPrimary },
  chipText: { color: Colors.textSecondary, fontSize: FontSize.caption, fontWeight: '600' },
  chipTextActive: { color: Colors.white },
  assetChip: { minWidth: '46%', flexGrow: 1, backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.borderSubtle, padding: 11, gap: 3 },
  assetChipActive: { borderColor: Colors.brandPrimary, backgroundColor: Colors.subtle },
  assetName: { color: Colors.textPrimary, fontSize: FontSize.body, fontWeight: '700' },
  assetBand: { color: Colors.textMuted, fontSize: FontSize.caption },
  selectedCard: { flexDirection: 'row', gap: 12, padding: 14, backgroundColor: Colors.brandPrimary, borderRadius: Radius.lg },
  selectedLabel: { color: '#AEBCCD', fontSize: FontSize.microLabel, fontWeight: '700' },
  selectedName: { color: Colors.white, fontSize: FontSize.cardTitle, fontWeight: '700', marginTop: 4 },
  valueBox: { alignItems: 'flex-end', gap: 2, maxWidth: '48%' },
  valueLabel: { color: '#AEBCCD', fontSize: FontSize.microLabel, fontWeight: '700' },
  value: { color: '#9DD9C2', fontSize: FontSize.body, fontWeight: '700', textAlign: 'right' },
  tabs: { flexDirection: 'row', gap: 6 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: Radius.pill, backgroundColor: Colors.subtle },
  tabActive: { backgroundColor: Colors.brandPrimary },
  tabText: { color: Colors.textSecondary, fontSize: FontSize.caption, fontWeight: '700' },
  tabTextActive: { color: Colors.white },
  historyRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7, borderTopWidth: 1, borderTopColor: Colors.borderSubtle },
  historyValue: { color: Colors.textPrimary, fontSize: FontSize.body, fontWeight: '700' },
  muted: { color: Colors.textMuted, fontSize: FontSize.caption, lineHeight: 16 },
  error: { color: Colors.pendingText, backgroundColor: Colors.pendingBg, borderRadius: Radius.md, padding: 12, fontSize: FontSize.body },
});
