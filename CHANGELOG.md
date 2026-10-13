# Changelog

All notable changes to Kitasaku are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project uses [Semantic Versioning](https://semver.org/).

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
