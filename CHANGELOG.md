# Changelog

All notable changes to Kitasaku are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project uses [Semantic Versioning](https://semver.org/).

## [1.3.1] — 2026-10-24

A fix release: closing a cycle works again, opening one no longer trips on card positions,
and the Transaksi tab stops counting incoming salary as unpaid bills.

### Fixed

- **Tutup siklus.** Closing a cycle failed before writing anything with a "record is not
  assigned yet" error. It now completes, and the result card with "Buka Siklus Baru" and "Ke
  Beranda" stays on screen after the active cycle clears.
- **Buka siklus.** Routine positions charged to a credit card no longer count toward the
  opening funding gate, so a plan the opened cycle reports as funded is no longer blocked.
  The card's bill still reaches the cycle later as a debt payment.
- **Banner Transaksi.** "N tagihan belum dibayar" now counts only money going out. Pending
  income gets its own line ("N pemasukan belum diterima"), and those rows read "Belum
  diterima" instead of "Belum lunas".
- **Input nominal.** Amounts in Quick Add (including Bayar tanggungan), Edit Transaksi and
  Konfirmasi Pembayaran show thousands separators while typing. A pasted figure with sen,
  such as "600.000,00", is read as Rp 600.000 instead of Rp 60.000.000.

### Upgrade notes

- Apply `037_fix_close_cycle_record_alias.sql` in the Supabase SQL Editor (after
  `001`–`031` and `033`–`036`) and run its verification block. Until it is applied, closing
  a cycle keeps failing on every build.
- No new native module. If the native fingerprint still matches the 1.3.0 build, this can ship
  as an OTA update (`eas update --channel production`); otherwise build and publish a new APK
  and update `app_releases`.

## [1.3.0] — 2026-10-21

When a tanggungan grows, for example borrowing again from the same person, the extra amount
is now recorded as its own event instead of by rewriting the principal in "Atur Tenor &
Cicilan", and the money that came in lands in the right account.

### Added

- **Tambah pokok.** Detail Tanggungan has a "Tambah pokok" button next to "Tandai sudah
  dibayar" for tanggungan that are not finished yet. Enter the extra amount, date and an
  optional note; with "Uang masuk ke rekening" on, the money is recorded as incoming funds in
  a bank or e-wallet account in the active cycle, so it shows up as unallocated. Turn it off
  to record only the larger debt, e.g. a talangan. Total and sisa rise together in one step.
- Aktivitas shows "Pokok ditambah oleh <nama>" with the amount, account, new sisa and note,
  and the person who submitted the tanggungan gets a push. The Detail hero shows "Sisa dari
  total Rp X" once sisa and total differ.

### Changed

- Tanggungan with open cicilan cannot be topped up yet; the sheet points to "Atur cicilan"
  instead.

### Upgrade notes

- Apply `036_obligation_topup.sql` in the Supabase SQL Editor (after `001`–`031` and
  `033`–`035`) **before** this version reaches any phone, then run its verification block.
- No new native module. If the native fingerprint still matches the 1.2.0 build, this can ship
  as an OTA update (`eas update --channel production`); otherwise build and publish a new APK
  and update `app_releases`.
- Details in [`docs/phase-17-tambah-pokok.md`](docs/phase-17-tambah-pokok.md).

## [1.2.0] — 2026-10-19

One bank transfer can now settle several tanggungan at once, and the app finally knows when
it is out of date: a fix that only touches the app's code arrives on its own, and a new APK
is announced inside the app instead of through a WhatsApp link.

### Added

- **Bayar tanggungan sekaligus.** Quick Add > Pengeluaran has a "Biasa / Bayar tanggungan"
  choice: pick several active tanggungan, pay each in full, in part, or by N open cicilan,
  from one account on one date. A transfer fee above the subtotal is recorded as one
  separate "Biaya Transfer" expense. A review screen checks every row first; the batch is
  then saved in one step, all or nothing.
- **Detail Pembayaran.** A batch shows as one activity in Riwayat ("Bayar n tanggungan ·
  akun") and opens to its rows. Each member gets one summary push per batch instead of one
  per tanggungan.
- **Update notices.** A downloaded update shows a "Versi baru siap dipakai" banner on Home
  with Muat ulang. A newer APK opens a "Kitasaku x.y.z tersedia" sheet that can be postponed;
  a build below the minimum version is blocked with "Perlu update dulu" until it is updated.

### Fixed

- Konfirmasi Pembayaran for a Reimburse or Tagihan without a cicilan schedule no longer
  fails with "tidak dapat dipetakan ke jadwal cicilan".
- Terbayar lists tanggungan that are already lunas, and a lunas tanggungan opens in Detail
  Tanggungan instead of an empty screen.

### Upgrade notes

- Apply in the Supabase SQL Editor, in order: `034_bulk_pay_obligations.sql`, then
  `035_app_releases.sql` (after `001`–`031` and `033`; `032` is still not part of this
  release). Apply 034 **before** installing this build. Run each file's verification block.
- **A new native build is required** (`expo-updates`, `expo-application`). `runtimeVersion`
  uses the `fingerprint` policy, so OTA updates (`eas update --channel production`) reach only
  builds with the same native fingerprint; builds up to 1.1.0 receive none and must be
  updated by hand once.
- After uploading the APK to a public https URL, set `latest_version_code`,
  `latest_version_name`, `apk_url` and `notes` in `app_releases`. Raise `min_version_code`
  only when an older build must stop writing.
- Details in [`docs/phase-16-bulk-bayar-tanggungan.md`](docs/phase-16-bulk-bayar-tanggungan.md).

## [1.1.0] — 2026-10-14

Ruang Keluarga becomes a place to work together, not just a shared ledger. Every
tanggungan now records who submitted it and everything that happened to it, the person who
submitted it hears when it is paid or cancelled, and anyone can tell the household about a
payment from inside the app instead of forwarding a summary to WhatsApp.

### Added

- **Who submitted a tanggungan.** Every new tanggungan records its requester. Detail
  Tanggungan shows "Diajukan oleh", and the list reads "Reimburse · dari Rani". Tanggungan
  created before this release show "Tidak tercatat".
- **Activity trail (Aktivitas).** The Riwayat tab on a tanggungan becomes Aktivitas: submitted,
  paid in part or in full (by whom, from which account, what is left), schedule changed,
  cancelled with its reason. Payments made before this release are folded in.
- **Submit a reimburse from the app.** Tambah Tanggungan has a Jenis toggle (Tagihan |
  Reimburse); a reimburse hides Frekuensi, since it is paid back once.
- **Push notifications for tanggungan.** A new submission notifies the other members; a
  payment, payoff, cancellation or schedule change notifies the requester, never the person
  who did it.
- **Kabari anggota ruang.** Quick Add, Konfirmasi Pembayaran and Eksekusi Bersama have a card
  to tell the household about what was just recorded or paid, with an optional note. It is
  on by default with every other member selected, and is sent only after the money is saved.
- **Kabar Pembayaran.** Tapping a kabar opens who paid what, when, from which account, the
  note and the total, read live from the transactions.

### Changed

- **Eksekusi Bersama checks before it writes.** Selected rows are verified first and any
  problem is shown on its row; the batch is then recorded in one step, all or nothing,
  instead of one payment at a time that could stop halfway. Sharing to WhatsApp stays as a
  secondary link.
- **One notification setting.** "Notifikasi Pengeluaran" in Profile and Ruang Keluarga becomes
  "Notifikasi Ruang Keluarga". Turning it off stops pushes; activity is still recorded.

### Fixed

- Home no longer shows a navy band below the content when the cycle is still empty.

### Upgrade notes

- Apply migration `033_household_collaboration.sql` in the Supabase SQL Editor (after
  `001`–`031`; `032` is not part of this release). It leaves `realtime_health()` untouched;
  verify with the `pg_publication_tables` query at the end of the file.
- Deploy the `send-push` Edge Function with **Verify JWT off**, set the secret
  `PUSH_WEBHOOK_SECRET`, and create a Database Webhook on `notifications` INSERT that calls it
  with the header `x-webhook-secret` set to the same value.
- Android push needs `google-services.json` (now in the repo) and the FCM V1 service-account
  key uploaded to EAS.
- **A new native build is required** (`expo-notifications` and Firebase config). Push does not
  work in Expo Go; the app runs there without it.
- Details in [`docs/phase-15-kolaborasi-ruang.md`](docs/phase-15-kolaborasi-ruang.md).

## [1.0.0] — 2026-10-13

First stable release. Since 0.9.0 the work has gone into three things: making every
figure on screen mean exactly one thing, closing the gaps where money could be counted
twice or not at all, and making each screen do one job well.

### Added

- **State the opening balance when a cycle starts.** Buka Siklus names the primary account
  and asks for its balance on day one, so Home can show a real balance from the very first
  cycle instead of a net movement that often read as negative. The figure locks once the
  cycle is reconciled.
- **Pay off a debt in one go.** The obligation screen takes any typed amount up to what is
  still owed, with one-tap presets for the next instalment and the full payoff. The payoff
  option says how many instalments it closes, and the instalment schedule is settled with it.
- **Plan vs. actual per commitment.** Each allocation shows what was actually spent and how
  far over or under plan it landed; the summary totals every rupiah spent beyond plan.
- **Instalment schedules with interest.** Loans support fixed and floating interest, and
  existing obligations can be given a schedule after the fact. Instalment payments stay in
  sync with their transactions.
- **Bulk execution (Eksekusi Bersama).** Confirm several planned payments at once and share
  the summary with your partner.
- **Edit transactions** after they are recorded, with a native date picker.
- **Audited cancellation.** Transactions, obligations and whole cycles can be cancelled with
  a reason. Cancelled cycles stay readable as an archive in Riwayat; nothing is deleted.
- **Cash and e-wallet tracking with a primary account.** Choose the household's primary bank
  account, record account snapshots (closing balances), and see which cash accounts still
  have no closing balance recorded.
- **Cycle switcher** in the ledger to browse earlier cycles.
- **Outside-cycle spending is visible.** Credit-card and cash transactions appear in the
  cycle ledger and on Home, clearly marked as not counted toward the cycle's cash.
- **"Left after unpaid plans".** Home shows what remains in an account once its unexecuted
  plans are paid, with the count and amount being subtracted.
- **Cycle-open breakdown by account.** The routine plan is split into primary account, other
  cash accounts, and credit card, so you see which part this cycle's cash actually has to cover.
- **Choose what goes into a new cycle.** Selected routine templates and deferred obligations
  are counted in the headers, with bulk toggles and a line explaining the consequence.

### Changed

- **A cycle traces every account.** Paying a plan with a credit card or cash is the normal
  confirm flow again and stays in the cycle's trail. Card and cash rows still never count
  toward source funds, allocations or reconciliation, and year insight no longer counts a
  card purchase twice (once as spending, again as the card bill).
- **Planned expenses can be confirmed from any active account.** Obligation payments still
  require a bank or e-wallet account.
- **Calmer Home.** The quick-action tiles and stacked warning banners are gone; attention
  items are one list, income/expense collapse into a single line, and the freed space shows
  six recent transactions instead of three.
- **Forms live in sheets.** Routine templates, allocations, transfers, assets and account
  snapshots open as sheets over their list instead of inline forms that pushed content off
  screen. Pickers replace long rows of chips, and each sheet has a single primary action.
- **Amounts format as you type.** One shared money field shows `Rp 1.817.548` while typing,
  in every sheet.
- **Routine templates grouped by pocket** (primary, other cash, card), with subtotals and a
  clear marker on card rows. Income templates can now be created, not just edited.
- **Transfers** open as a compact modal with a swap control; the account already used on the
  other side stays visible but disabled.
- **Labels say what they count.** The cycle card names its account, the category budget is
  renamed Pagu Kategori and states its scope, and Insight states it covers cash accounts only.
- **Tanggungan summary.** The cycle pill (which looked like a filter but wasn't) is replaced by
  a summary of active obligations, those due within two weeks, and those without a due date.
- **One primary action per screen**, and "Kembali" reads as a way back rather than a second
  choice.

### Fixed

- Riwayat Siklus counted cancelled transactions and unpaid plans as spending; pending plans
  are now shown separately as "Rencana belum dibayar".
- Budget health capped the overall ratio at 100%, hiding overspend; the real percentage is
  now shown while the bar stays within its track.
- A pending plan could disappear from the ledger checklist behind the page limit.
- A plan created on a credit card could not be confirmed.
- Paying a debt from the obligation screen left its instalments open while the debt read as
  settled.
- Cancelling a planned expense could leave its allocation behind.
- The last rows of Lainnya were hidden under the floating tab bar.
- The "next due" line on Home missed plans created when the cycle opened.

### Removed

- The audit-history screen, which nothing navigated to.

### Upgrade notes

Database migrations `018`–`031` must be applied in order in the Supabase SQL Editor before
installing 1.0.0 (both `019` files included). See [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).

## [0.9.0] — 2026-09-28

First installable preview (Android APK via EAS).

- Household workspace for two: Google sign-in, invite code pairing, real-time sync between
  both phones.
- Pay cycles with zero-based allocation: source funds, allocations, unallocated amount and
  funding gap, with a Home dashboard built on the Kitasaku design system.
- Quick Add for expenses, income, transfers and loan intake, with custom transaction dates.
- Obligations and loans: repayment modes, generated instalment schedules, counterparties,
  and a funding-gap view.
- Ledger, recurring templates, categories with icons, and account management.
- Cycle close with reconciliation against the real bank balance and an atomic sweep to the
  primary account.
- Assets and transfers, plus the Insight & Aset yearly overview.
- Profile and household screens with a member roster.
