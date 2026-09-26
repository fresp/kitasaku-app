export type TxnStatus = 'PENDING' | 'PAID';

export interface MockTransaction {
  id: string;
  name: string;
  category: string;
  account: string;
  amount: number;
  prevAmount?: number;
  dueLabel: string;
  status: TxnStatus;
  deltaKind: 'up' | 'down' | 'same' | 'neutral';
  deltaText: string;
  recordedBy?: string;
  executedBy?: string;
}

export const activeCycle = {
  name: 'Siklus Okt 2026',
  range: '25 Sep – 24 Okt • Payday-to-Payday',
  dayLabel: '25 Sep – 24 Okt • Hari ke-1',
  actualCash: 6034000,
  projectedRemaining: 1390834,
  buffer: 890000,
  pendingCount: 18,
  paidCount: 5,
  totalCount: 23,
};

export const pendingTransactions: MockTransaction[] = [
  {
    id: 't1',
    name: 'Tagihan Rumah',
    category: 'Rumah Tangga',
    account: 'BCA •• 8821',
    amount: 4800000,
    prevAmount: 4300000,
    dueLabel: 'Jatuh tempo 27 Sep • Bulanan',
    status: 'PENDING',
    deltaKind: 'up',
    deltaText: '+Rp 500rb vs rencana',
  },
  {
    id: 't2',
    name: 'Flexy Cash',
    category: 'Pinjaman',
    account: 'CC Mandiri',
    amount: 1294840,
    prevAmount: 1719840,
    dueLabel: 'Jatuh tempo 28 Sep • Cicilan 8/12',
    status: 'PENDING',
    deltaKind: 'down',
    deltaText: '−Rp 425rb vs bulan lalu',
  },
  {
    id: 't3',
    name: 'Sekolah Ryu',
    category: 'Pendidikan',
    account: 'Tunai',
    amount: 1100000,
    prevAmount: 1100000,
    dueLabel: 'Jatuh tempo 30 Sep • SPP',
    status: 'PENDING',
    deltaKind: 'same',
    deltaText: 'Sama seperti rencana',
  },
  {
    id: 't4',
    name: 'Listrik PLN',
    category: 'Utilitas',
    account: 'ShopeePay',
    amount: 500000,
    dueLabel: 'Jatuh tempo 2 Okt • Token',
    status: 'PENDING',
    deltaKind: 'neutral',
    deltaText: 'Estimasi • Cek meter',
  },
];
