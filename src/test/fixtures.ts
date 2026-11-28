import type { PasskeyStatus } from "@/hooks/query/usePasskey";
import type { SellOrder } from "@/hooks/query/useSell";
import type { UserMe } from "@/hooks/query/useUserMe";
import type { P2pMe, P2pTransfer } from "@/lib/p2p";
import type { DCSummary } from "@/lib/types";

/** Backend answers, as a typical member would get them. Pass `over` to change what a test is about. */

/** GET /passkey: a member with one passkey, unlocked, asked for it when the app opens */
export const passkeyStatus = (over: Partial<PasskeyStatus> = {}): PasskeyStatus => ({
  enabled: true,
  unlocked: true,
  available: true,
  lock_on_open: true,
  passkeys: [
    { id: "pk_1", name: "iPhone", created_at: "2026-11-01T04:00:00Z", last_used_at: null },
  ],
  ...over,
});

/** GET /passkey for a member who hasn't set one up */
export const noPasskey = (over: Partial<PasskeyStatus> = {}): PasskeyStatus =>
  passkeyStatus({ enabled: false, lock_on_open: false, passkeys: [], ...over });

/** GET /p2p/me: 50,000 sats to spend, well inside the limits */
export const p2pMe = (over: Partial<P2pMe> = {}): P2pMe => ({
  telegram_id: 777,
  username: "nimal",
  balance: 50_000,
  pot_balance: 0,
  limits: {
    max_amount: 100_000,
    daily_limit: 500_000,
    daily_used: 0,
    daily_remaining: 500_000,
    confirm_threshold: 20_000,
    unconfirmed_remaining: 20_000,
  },
  ...over,
});

/** LKR per BTC in these fixtures: 100,000 sats are 30,000.00 rupees */
export const BTC_LKR = 30_000_000;

/** GET /transaction/dca-summary */
export const walletSummary = (over: Partial<DCSummary> = {}): DCSummary =>
  ({
    dca: { balance: 40_000, spent: 12_000, fees: 480, avg_btc_price: 29_000_000 },
    total_balance: 50_000,
    total_lkr: "15,000.00",
    balance_available: true,
    spendable_balance: 50_000,
    pot_balance: 0,
    currency: "LKR",
    "24_hr_change": 1.2,
    current_btc_price: { usd: 100_000, lkr: BTC_LKR },
    ...over,
  }) as DCSummary;

/** GET /user/me */
export const userMe = (over: Partial<UserMe> = {}): UserMe => ({
  id: "user_1",
  first_name: "Nimal",
  last_name: "Silva",
  email: "nimal@example.com",
  phone: "+94771234567",
  address: "12 Galle Road",
  city: "Colombo",
  country: "Sri Lanka",
  is_profile_complete: true,
  avatar_seed: null,
  username: "nimal",
  ...over,
});

/** A P2P transfer, just started */
export const p2pTransfer = (over: Partial<P2pTransfer> = {}): P2pTransfer => ({
  id: "tr_12345678abcd",
  kind: "internal",
  status: "processing",
  amount: 5000,
  to: { telegram_id: 4242, username: "kasun_77", name: "Kasun P." },
  created_at: "2026-11-26T04:30:00Z",
  ...over,
});

/** A sale of 100,000 sats, waiting for the member to approve its payment in the app */
export const sellOrder = (over: Partial<SellOrder> = {}): SellOrder => ({
  id: "ord_1",
  status: "COLLECTING",
  sats: 100_000,
  feeBasisPoints: 150,
  grossLkr: 30_000,
  feeLkr: 450,
  bankChargeLkr: 50,
  btcLkrRate: BTC_LKR,
  amountLkr: 29_500,
  expiresAt: "2099-01-01T00:00:00Z",
  bankRef: null,
  failureReason: null,
  createdAt: "2026-11-26T04:30:00Z",
  completedAt: null,
  collect: null,
  ...over,
});
