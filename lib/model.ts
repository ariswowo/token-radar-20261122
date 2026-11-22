// lib/model.ts — the radar-2 value model and the farm plans for token-radar-01.
//
// Everything here is derived from the snapshot's own figures: a protocol's TVL,
// its 7-day change, how long it has run with no token, and how many chains it
// runs on. No list of names is hardcoded: the same rules rank a protocol the
// snapshot adds tomorrow exactly as they rank one it holds today.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  floor_usd: number;
  watchlist: string[];
  protocols: SnapshotProtocol[];
}

/** The constants of the value model. They are printed in the dashboard next to
 *  the formula, and the dashboard's sandbox lets a reader change them and
 *  re-rank the board in the page. */
export interface RadarConstants {
  /** The multiple applied to TVL at the reference size of $100M. */
  base_multiple: number;
  /** How fast the multiple falls as TVL grows (a power law on TVL / $100M). */
  size_exponent: number;
  /** The multiple never falls below this, however large the protocol. */
  size_floor: number;
  /** How much of the 7-day change feeds into the value (0.7 = 70% of it). */
  growth_weight: number;
  /** The 7-day change is clamped to this range before it is used. */
  growth_lo: number;
  growth_hi: number;
  /** The maturity factor of a protocol that launched yesterday. */
  maturity_base: number;
  /** The maturity factor stops growing after this many days with no token. */
  maturity_cap_days: number;
  /** Each extra chain adds this much to the value, up to the cap. */
  chain_step: number;
  /** At most this many extra chains count. */
  chain_cap: number;
  /** A protocol with no listing date is treated as this many days old. */
  unknown_age_days: number;
}

export const MODEL_NAME = 'radar-2';

export const DEFAULTS: RadarConstants = {
  base_multiple: 0.42,
  size_exponent: -0.1,
  size_floor: 0.1,
  growth_weight: 0.7,
  growth_lo: -50,
  growth_hi: 150,
  maturity_base: 0.55,
  maturity_cap_days: 1460,
  chain_step: 0.03,
  chain_cap: 5,
  unknown_age_days: 365,
};

export const MODEL_FORMULA =
  'implied = TVL x size_multiple x growth_factor x maturity_factor x chain_factor';

const DAY_MS = 86_400_000;

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

/** Whole days between the listing date and the snapshot's date, or null. */
export function ageDays(listedAt: string | null, asOf: string): number | null {
  if (!listedAt) return null;
  const listed = Date.parse(`${listedAt}T00:00:00Z`);
  const ref = Date.parse(`${asOf}T00:00:00Z`);
  if (Number.isNaN(listed) || Number.isNaN(ref)) return null;
  return Math.max(0, Math.round((ref - listed) / DAY_MS));
}

/** The multiple of TVL a token could plausibly be worth. It falls as TVL
 *  grows: a small protocol's token has more headroom than a giant's. At the
 *  $100M reference size it is the base multiple; at $10M it is capped at the
 *  base multiple, at $10B it is about 0.27, at $100B about 0.21. */
export function sizeMultiple(tvl: number, c: RadarConstants): number {
  const raw = c.base_multiple * Math.pow(tvl / 100_000_000, c.size_exponent);
  return clamp(raw, c.size_floor, c.base_multiple);
}

/** The 7-day change, clamped, turned into a factor. +100% growth over the
 *  week lifts the value by the growth weight; -50% cuts it by half of it. */
export function growthFactor(change7d: number | null, c: RadarConstants): number {
  const g = clamp(change7d ?? 0, c.growth_lo, c.growth_hi);
  return 1 + (g / 100) * c.growth_weight;
}

/** How long the protocol has run with no token. A protocol that has survived
 *  years without launching is more likely to launch a valuable one than a
 *  protocol listed last week; the factor rises from the base to 1.0 over the
 *  cap and then stays flat. */
export function maturityFactor(age: number | null, c: RadarConstants): number {
  const days = age ?? c.unknown_age_days;
  const share = Math.min(days, c.maturity_cap_days) / c.maturity_cap_days;
  return c.maturity_base + (1 - c.maturity_base) * share;
}

/** A protocol on more chains reaches more users, so each extra chain adds a
 *  small step, up to the cap. */
export function chainFactor(chains: string[], c: RadarConstants): number {
  const extra = Math.max(0, Math.min(chains.length - 1, c.chain_cap));
  return 1 + c.chain_step * extra;
}

export interface ModelBreakdown {
  size_multiple: number;
  growth_factor: number;
  maturity_factor: number;
  chain_factor: number;
  age_days: number;
}

/** The implied value of a protocol's not-yet-existing token, with the
 *  factors that produced it so the dashboard can show the working. */
export function impliedValue(
  p: SnapshotProtocol,
  asOf: string,
  c: RadarConstants,
): { implied: number; age: number; breakdown: ModelBreakdown } {
  const age = ageDays(p.listed_at, asOf) ?? c.unknown_age_days;
  const sm = sizeMultiple(p.tvl_usd, c);
  const gf = growthFactor(p.change_7d, c);
  const mf = maturityFactor(age, c);
  const cf = chainFactor(p.chains, c);
  const implied = Math.max(1, Math.round(p.tvl_usd * sm * gf * mf * cf));
  return {
    implied,
    age,
    breakdown: {
      // Full precision here: the dashboard shows these rounded to four
      // places, but the stored factors must multiply back to the implied
      // value exactly, so they are not rounded.
      size_multiple: sm,
      growth_factor: gf,
      maturity_factor: mf,
      chain_factor: cf,
      age_days: age,
    },
  };
}

/** Whether the snapshot records no token at all for the protocol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** A name ending in a release marker is a versioned pool of another protocol,
 *  not a protocol of its own. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

export function isVersionedName(name: string): boolean {
  return VERSIONED.test(name);
}

/** Categories whose protocols are products of a token that already trades
 *  (a wrapped or staked form of it, a bridge moving it, or an exchange
 *  listing it), so ranking them as launches would rank the same token twice. */
const PRODUCT_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

const EXCHANGE_NAMES = [
  'Binance',
  'Coinbase',
  'Bybit',
  'Kraken',
  'Bitget',
  'OKX',
  'Bitfinex',
  'Gemini',
];

export function isWrappedProduct(p: SnapshotProtocol): boolean {
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return true;
  return EXCHANGE_NAMES.some((e) => p.name.startsWith(e));
}

/** Whether the protocol belongs on the ranked board: it records no token,
 *  it is not a product of a token that already trades, and it is not a
 *  versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !PRODUCT_CATEGORIES.has(p.category ?? '') &&
    !isVersionedName(p.name) &&
    !isWrappedProduct(p)
  );
}

/** Why a pre-token protocol is not ranked, for the dashboard's set-aside tab. */
export function exclusionReason(p: SnapshotProtocol): string {
  if (PRODUCT_CATEGORIES.has(p.category ?? '')) {
    return `Category ${p.category} is a product of a token that already trades, not a launch of its own`;
  }
  if (isVersionedName(p.name)) {
    return 'Name ends in a version marker, so it is a versioned pool of another protocol';
  }
  if (isWrappedProduct(p)) {
    return 'Name marks it as a wrapped or staked product of a token that already trades';
  }
  return 'Not ranked';
}

// ---------------------------------------------------------------- farm plans

/** What a typical transaction on each chain costs, in broad terms, so the
 *  plan can say what farming actually costs instead of waving at "gas". */
const GAS_TEXT: Record<string, string> = {
  Ethereum: '$8–25 per transaction',
  Solana: '$0.05–0.20 per transaction',
  'Hyperliquid L1': '$0.10–0.50 per transaction',
  Arbitrum: '$0.30–1.50 per transaction',
  Optimism: '$0.30–1.50 per transaction',
  Base: '$0.30–1.50 per transaction',
  Binance: '$0.20–0.60 per transaction',
  Polygon: '$0.10–0.50 per transaction',
  Unichain: '$0.30–1.50 per transaction',
  Avalanche: '$0.50–2 per transaction',
  Bitcoin: '$2–8 per transaction',
};

function gasText(chain: string): string {
  return GAS_TEXT[chain] ?? '$0.50–2 per transaction';
}

function capitalTier(tvl: number): string {
  if (tvl >= 500_000_000) return '$500–1,000';
  if (tvl >= 100_000_000) return '$200–500';
  if (tvl >= 50_000_000) return '$100–250';
  return '$50–150';
}

function holdDays(age: number): number {
  if (age >= 730) return 90;
  if (age >= 365) return 60;
  if (age >= 180) return 45;
  return 30;
}

interface CategoryPlay {
  /** The one action that qualifies a farmer, written as an instruction. */
  action: string;
  /** The noun for the weekly repetition of that action. */
  weekly: string;
  /** A second feature worth using as well. */
  second: string;
}

const PLAYS: Record<string, CategoryPlay> = {
  'Risk Curators': {
    action: 'deposit into a vault the curator manages',
    weekly: 'deposit',
    second: 'allocate to a second vault the curator runs',
  },
  Dexs: {
    action: 'swap a small amount and add a little liquidity to one pool',
    weekly: 'swap',
    second: 'add liquidity to a second pool',
  },
  'Onchain Capital Allocator': {
    action: 'deposit into the allocator vault',
    weekly: 'deposit',
    second: 'try a second vault strategy',
  },
  RWA: {
    action: 'buy or mint a small amount of the tokenised asset',
    weekly: 'purchase',
    second: 'hold the asset in a second supported wallet',
  },
  Lending: {
    action: 'supply collateral and borrow a small amount against it',
    weekly: 'supply',
    second: 'borrow a small amount as well as supplying',
  },
  Yield: {
    action: 'deposit into the yield strategy',
    weekly: 'deposit',
    second: 'try a second strategy the protocol offers',
  },
  Derivatives: {
    action: 'open a small perpetual or options position',
    weekly: 'trade',
    second: 'close and reopen a position rather than leaving one untouched',
  },
  CDP: {
    action: 'lock collateral and mint a small amount of the stablecoin',
    weekly: 'mint',
    second: 'repay part of the minted amount and mint again',
  },
  'Yield Aggregator': {
    action: 'deposit into a vault and leave it compounding',
    weekly: 'deposit',
    second: 'deposit into a second vault',
  },
  'Basis Trading': {
    action: 'deposit into the basis strategy',
    weekly: 'deposit',
    second: 'check the funding history the strategy publishes',
  },
  Chain: {
    action: 'bridge a small amount in and use the chain flagship app once',
    weekly: 'transaction',
    second: 'use a second app on the chain',
  },
  'Staking Pool': {
    action: 'stake a small amount in the pool',
    weekly: 'stake',
    second: 'restake the rewards the pool pays',
  },
  'Liquidity Manager': {
    action: 'deposit into a managed liquidity position',
    weekly: 'deposit',
    second: 'rebalance the position when the manager suggests it',
  },
  'Leveraged Farming': {
    action: 'open a small leveraged farming position',
    weekly: 'position',
    second: 'close and reopen the position at a lower leverage',
  },
  Restaking: {
    action: 'restake a small amount through the protocol',
    weekly: 'restake',
    second: 'delegate to a second operator',
  },
  'Anchor BTC': {
    action: 'mint or bridge a small amount of the BTC-backed asset',
    weekly: 'mint',
    second: 'use the asset as collateral somewhere it is accepted',
  },
  'Decentralized BTC': {
    action: 'mint or bridge a small amount of the BTC-backed asset',
    weekly: 'mint',
    second: 'use the asset as collateral somewhere it is accepted',
  },
  CeDeFi: {
    action: 'deposit into the CeDeFi vault',
    weekly: 'deposit',
    second: 'try a second vault the protocol runs',
  },
  'Dual-Token Stablecoin': {
    action: 'mint a small amount of the stablecoin pair',
    weekly: 'mint',
    second: 'hold both tokens of the pair, not just one',
  },
  Farm: {
    action: 'deposit into the farm',
    weekly: 'deposit',
    second: 'harvest and re-deposit the rewards once',
  },
  'Prediction Market': {
    action: 'place a small prediction on an open market',
    weekly: 'prediction',
    second: 'predict on a second market in a different topic',
  },
  'Stablecoin Wrapper': {
    action: 'wrap a small amount of the stablecoin',
    weekly: 'wrap',
    second: 'unwrap and wrap again to show both directions',
  },
  'Uncollateralized Lending': {
    action: 'supply a small amount to the credit pool',
    weekly: 'supply',
    second: 'check the borrower terms the pool publishes',
  },
  'Interest Rate Derivatives': {
    action: 'open a small fixed-rate position',
    weekly: 'position',
    second: 'try the variable side of the same market once',
  },
  'Cross Chain Bridge': {
    action: 'bridge a small amount to another chain',
    weekly: 'bridge',
    second: 'bridge back a small amount as well',
  },
  'CDP Manager': {
    action: 'open a small collateralised debt position through the manager',
    weekly: 'position',
    second: 'adjust the collateral ratio once',
  },
  'OTC Marketplace': {
    action: 'take a small over-the-counter offer',
    weekly: 'trade',
    second: 'list a small offer of your own',
  },
  Insurance: {
    action: 'buy a small cover policy',
    weekly: 'policy',
    second: 'read the claim terms before the policy expires',
  },
  Payments: {
    action: 'make a small payment through the app',
    weekly: 'payment',
    second: 'receive a payment through the app as well',
  },
  'Governance Incentives': {
    action: 'vote or delegate a small amount',
    weekly: 'vote',
    second: 'vote on a second proposal',
  },
};

const DEFAULT_PLAY: CategoryPlay = {
  action: 'use the protocol main feature with a small amount',
  weekly: 'action',
  second: 'use a second feature of the protocol',
};

function playFor(category: string | null): CategoryPlay {
  return PLAYS[category ?? ''] ?? DEFAULT_PLAY;
}

/** Seven concrete steps for farming a protocol, each with what it costs and
 *  how long it takes. The steps never promise an airdrop: they say what to
 *  do, what it costs, and how long to keep at it. */
export function farmSteps(p: SnapshotProtocol, age: number): string[] {
  const play = playFor(p.category);
  const chain = p.chains[0] ?? 'Ethereum';
  const secondChain = p.chains.length > 1 ? p.chains[1] : null;
  const capital = capitalTier(p.tvl_usd);
  const hold = holdDays(age);
  const steps = [
    `Use a fresh wallet you created only for farming, write its seed phrase on paper and keep it offline, and never type it into any site. No genuine airdrop ever asks you to pay a fee or send funds to claim it.`,
    `On ${chain}, ${play.action} with about ${capital} of capital. Expect roughly ${gasText(chain)} in network fees for the transactions, and keep the amount small enough that losing it would not hurt.`,
    `Repeat the qualifying action once a week — one ${play.weekly} each week — so the activity reads as a real user over time instead of a single burst on one day.`,
    `Keep the position open for at least ${hold} days. ${p.name} has run for ${age} days with no token, so a short visit is unlikely to count; the plan rewards users who stay.`,
    `Check ${p.name}'s points or rewards page once a week and confirm your activity is being counted. Only follow links from the protocol's own site or its verified social account, and ignore direct messages offering help.`,
    secondChain
      ? `Use a second feature as well: ${play.second}, or repeat the same action on ${secondChain}, another chain ${p.name} supports, so your activity covers more than one thing the protocol tracks.`
      : `Use a second feature as well: ${play.second}, so your activity covers more than one thing the protocol tracks.`,
    `Write down the wallet address, the dates you acted, and the transaction hashes in a simple note, and set a weekly reminder. When a claim opens you will need to prove what you did and when.`,
  ];
  return steps;
}

// ---------------------------------------------------------------- the board

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number;
  implied_value_usd: number;
  model: ModelBreakdown;
  farm_steps: string[];
  watchlist: boolean;
  early: boolean;
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  mcap_to_tvl: number;
  change_7d: number | null;
  age_days: number;
}

export interface SetAsideEntry {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  reason: string;
}

export interface RadarBoard {
  as_of: string;
  floor_usd: number;
  model_name: string;
  model_formula: string;
  constants: RadarConstants;
  counts: {
    protocols: number;
    watchlist: number;
    ranked: number;
    live: number;
    set_aside_pre_token: number;
    set_aside_gecko_listed: number;
  };
  rows: BoardRow[];
  live_top: LiveRow[];
  set_aside_pre_token: SetAsideEntry[];
  set_aside_gecko_listed: SetAsideEntry[];
}

/** Build the whole board from the snapshot: every rankable pre-token
 *  protocol ranked by implied value, the live tokens beside it, and the
 *  protocols set aside with the reason why. */
export function buildRadar(snapshot: Snapshot, c: RadarConstants): RadarBoard {
  const asOf = snapshot.as_of;
  const watchlist = new Set(snapshot.watchlist);

  const scored = snapshot.protocols
    .filter(isRankable)
    .map((p) => {
      const { implied, age, breakdown } = impliedValue(p, asOf, c);
      return { p, implied, age, breakdown };
    });
  scored.sort(
    (a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0),
  );

  const rows: BoardRow[] = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: s.breakdown,
    farm_steps: farmSteps(s.p, s.age),
    watchlist: watchlist.has(s.p.slug),
    early: s.p.tvl_usd < snapshot.floor_usd,
  }));

  const live = snapshot.protocols
    .filter((p) => p.mcap_usd !== null)
    .map((p) => ({
      p,
      age: ageDays(p.listed_at, asOf) ?? c.unknown_age_days,
    }))
    .sort((a, b) => (b.p.mcap_usd as number) - (a.p.mcap_usd as number))
    .slice(0, 24)
    .map(({ p, age }) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd as number,
      mcap_to_tvl: round4((p.mcap_usd as number) / p.tvl_usd),
      change_7d: p.change_7d,
      age_days: age,
    }));

  const setAsidePre: SetAsideEntry[] = snapshot.protocols
    .filter((p) => isPreToken(p) && !isRankable(p))
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      reason: exclusionReason(p),
    }))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1));

  const setAsideGecko: SetAsideEntry[] = snapshot.protocols
    .filter((p) => p.mcap_usd === null && (p.gecko_id !== null || p.symbol !== null))
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      reason: 'A token is already recorded for this protocol, so it is not a launch still to come',
    }))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1));

  return {
    as_of: snapshot.as_of,
    floor_usd: snapshot.floor_usd,
    model_name: MODEL_NAME,
    model_formula: MODEL_FORMULA,
    constants: c,
    counts: {
      protocols: snapshot.protocols.length,
      watchlist: snapshot.watchlist.length,
      ranked: rows.length,
      live: snapshot.protocols.filter((p) => p.mcap_usd !== null).length,
      set_aside_pre_token: setAsidePre.length,
      set_aside_gecko_listed: setAsideGecko.length,
    },
    rows,
    live_top: live,
    set_aside_pre_token: setAsidePre,
    set_aside_gecko_listed: setAsideGecko,
  };
}
