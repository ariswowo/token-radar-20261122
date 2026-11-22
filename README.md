# token-radar-20261122

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/ariswowo/token-radar-20261122/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/ariswowo/token-radar-20261122/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: a Node 22 program that reads one sealed snapshot of
the protocol universe and writes a ranked board of the pre-token protocols
worth farming, with a concrete farm plan for each one, plus a dashboard that
shows the board, the working behind every value, and the protocols it
deliberately set aside.

## The model (radar-2)

```
implied = TVL × size_multiple × growth_factor × maturity_factor × chain_factor
```

- **Size multiple.** A token is worth a multiple of the TVL it secures, and
  the multiple falls as TVL grows: 0.42 at $100M of TVL, about 0.27 at $10B,
  never below 0.10. A small protocol's token has more headroom than a giant's.
- **Growth.** The 7-day TVL change, clamped to −50%…+150%, feeds in at 70%.
- **Maturity.** A protocol that has run for years with no token is more
  likely to launch a valuable one than one listed last week. The factor
  rises from 0.55 to 1.00 over four years with no token.
- **Chain breadth.** Each extra chain adds 3%, up to five extra chains.

Nothing is hardcoded by name: the same rules rank whatever the snapshot
holds, so the radar finds future launches early instead of repeating a
hand-kept list.

## What the board ranks

Every pre-token protocol in the snapshot (no market cap, no CoinGecko id,
no symbol) that is a launch of its own — not an exchange, not a versioned
pool, and not a wrapped, staked or bridged product of a token that already
trades. The 40 watchlist protocols are all covered. Protocols set aside are
shown in the dashboard's "Set aside" tab with the reason for each one, and
the live tokens are shown beside the board for comparison (their market
cap over TVL is what a new token would be measured against).

Each row carries a 7-step farm plan: a fresh wallet and the seed kept
offline, the qualifying action with the capital and the chain's typical gas
cost, a weekly cadence, a hold period, a weekly check of the points page,
a second feature or chain, and a log of what was done. No step promises an
airdrop.

## The dashboard

`dashboard/` is plain HTML, CSS and JavaScript with no network calls. It
renders the board from `data.js` (written by the same program, so the page
and `board.json` always agree) and offers:

- a sortable, filterable board — search, category, chain, minimum TVL;
- a detail view per protocol with the full model breakdown and its farm plan;
- the live tokens beside the board, and the set-aside protocols with reasons;
- a model sandbox: change a constant and re-rank the board in the page.

## Run it

Node 22.18 or later, standard library only, nothing to install:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

It writes `out/board.json`, `out/data.js`, `out/dashboard/`,
`out/screenshots/` and `out/dossier.json`. Two runs on the same snapshot
write byte-identical outputs: no clock, no randomness, no network.

## Local verification

Run locally against the kit snapshot (see below). This is a program/v1
competition: there is no local grade — the server grades every entry. The
checks below are the seven gate rows, verified locally.

- Board rows: 198 (100–4,000), ranks 1–198 each once, implied values
  non-increasing, all 40 watchlist slugs covered, farm steps 7 per row.
- Top row: Steakhouse Financial, implied $674,420,757.
- Dashboard: 3 files, no external URLs; screenshots 3, 1280×900.
- Determinism: two runs, byte-identical outputs.
- Dossier: built by the kit's `buildDossier`, text within 65,536 bytes.

## Layout

```
main.ts                 entry point: snapshot in, board + dashboard + dossier out
lib/model.ts            the radar-2 model, the ranking rules, the farm plans
vendor/makefun-board.ts the kit's dossier library, byte for byte
dashboard/              index.html, app.css, app.js (no network, no libraries)
screenshots/            1-board.png, 2-detail.png, 3-filtered.png
LICENSE                 MIT
```
