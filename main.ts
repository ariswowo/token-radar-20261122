// main.ts — the token-radar entry point.
//
// Reads the sealed snapshot, ranks every pre-token protocol the radar may
// rank, and writes the entry's outputs:
//   /output/board.json     the ranked board the gate reads
//   /output/data.js        the same board as window.RADAR, for the dashboard
//   /output/dashboard/     a copy of this repository's dashboard/
//   /output/screenshots/   a copy of this repository's screenshots/
//   /output/dossier.json   the dossier buildDossier writes from those files
//
// It takes no network, no clock and no randomness: two runs on the same
// snapshot write byte-identical outputs. Run it with:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
//
// Node 22.18 or later runs this TypeScript as it is; on Node 22.6 to 22.17
// run it as: node --experimental-strip-types main.ts

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';
import { buildRadar, DEFAULTS, type Snapshot } from './lib/model.ts';

const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };

const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));

function flagValue(argv: string[], flag: string): string | null {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}

/** Copy a directory tree of plain files, creating the destination as needed. */
function copyTree(from: string, to: string): number {
  let files = 0;
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const src = join(from, entry.name);
    const dst = join(to, entry.name);
    if (entry.isDirectory()) {
      files += copyTree(src, dst);
    } else if (entry.isFile()) {
      copyFileSync(src, dst);
      files += 1;
    }
  }
  return files;
}

function money(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

function main(): void {
  const argv = process.argv.slice(2);
  const inputPath = flagValue(argv, '--input') ?? '/input/snapshot.json';
  const outDir =
    process.env.MAKEFUN_OUTPUT_DIR ?? flagValue(argv, '--output') ?? 'out';
  const out = resolve(outDir);

  const raw = readFileSync(inputPath, 'utf8');
  const snapshot = JSON.parse(raw) as Snapshot;
  if (!Array.isArray(snapshot.protocols) || !Array.isArray(snapshot.watchlist)) {
    throw new Error(`snapshot at ${inputPath} has no protocols or watchlist arrays`);
  }
  if (typeof snapshot.floor_usd !== 'number' || typeof snapshot.as_of !== 'string') {
    throw new Error(`snapshot at ${inputPath} has no floor_usd or as_of`);
  }

  const radar = buildRadar(snapshot, DEFAULTS);

  mkdirSync(out, { recursive: true });

  // The board the gate reads: ranks 1..N, implied values non-increasing,
  // every watchlist slug covered, a farm plan on every row.
  writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: radar.rows })}\n`);

  // The dashboard's data, beside the page: the same board, the live tokens,
  // the protocols set aside with their reasons, and the model itself.
  const dataScript = `window.RADAR = ${JSON.stringify(radar)};\n`;
  writeFileSync(join(out, 'data.js'), dataScript);

  // The page and its pictures, copied as they stand in the repository.
  const dashboardDir = join(REPO_ROOT, 'dashboard');
  const screenshotsDir = join(REPO_ROOT, 'screenshots');
  if (!existsSync(dashboardDir)) throw new Error(`missing dashboard/ in ${REPO_ROOT}`);
  if (!existsSync(screenshotsDir)) throw new Error(`missing screenshots/ in ${REPO_ROOT}`);
  const dashboardFiles = copyTree(dashboardDir, join(out, 'dashboard'));
  const shotFiles = copyTree(screenshotsDir, join(out, 'screenshots'));
  const shotNames = readdirSync(join(out, 'screenshots'))
    .filter((n) => statSync(join(out, 'screenshots', n)).isFile())
    .sort();

  // The dossier is written last: the scorer rebuilds it from this /output
  // and compares bytes, so it must be exactly what buildDossier writes.
  const dossier = buildDossier(out, {
    text_max_bytes: TEXT_MAX_BYTES,
    screenshots: SCREENSHOT_CAPS,
    dashboard: DASHBOARD_CAPS,
  });
  writeFileSync(join(out, 'dossier.json'), dossier);

  const top = radar.rows[0];
  const early = radar.rows.filter((r) => r.early).length;
  const watch = radar.rows.filter((r) => r.watchlist).length;
  console.log(
    `token radar: ${radar.rows.length} ranked rows ` +
      `(${watch}/${radar.counts.watchlist} watchlist, ${early} below the floor), ` +
      `top ${top?.name ?? 'none'} at ${top ? money(top.implied_value_usd) : '—'}\n` +
      `wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ` +
      `${join(out, 'dashboard')} (${dashboardFiles} files), ` +
      `${join(out, 'screenshots')} (${shotFiles} images: ${shotNames.join(', ')}), ` +
      `and ${join(out, 'dossier.json')} (${dossier.length} bytes)\n`,
  );
}

main();
