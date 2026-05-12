#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { run } from '../src/index.js';

const HELP = `
wayback-grab — download a full Wayback Machine snapshot of a domain

Usage:
  wayback-grab <domain> [options]

Examples:
  wayback-grab yardsaledigger.com
  wayback-grab yardsaledigger.com -o ./ysd --from 20130101 --to 20141231
  wayback-grab yardsaledigger.com --concurrency 3 --no-rewrite

Options:
  -o, --output <dir>        Output directory (default: ./wayback-archive)
      --from <YYYYMMDD>     Only include snapshots on or after this date
      --to <YYYYMMDD>       Only include snapshots on or before this date
      --pick <first|last>   Which snapshot to keep per URL (default: last)
      --include-subs        Include archived subdomains
  -c, --concurrency <n>     Parallel downloads (default: 5)
      --no-rewrite          Skip rewriting internal links to local paths
      --dry-run             List URLs without downloading
  -h, --help                Show this help

Tips:
  - Start with --dry-run to see what's in the archive before pulling.
  - Constrain --from/--to to the era you care about; old domains often have
    parked-page snapshots later in their life that you don't want.
`;

let parsed;
try {
  parsed = parseArgs({
    options: {
      output: { type: 'string', short: 'o', default: './wayback-archive' },
      from: { type: 'string', default: '' },
      to: { type: 'string', default: '' },
      pick: { type: 'string', default: 'last' },
      'include-subs': { type: 'boolean', default: false },
      concurrency: { type: 'string', short: 'c', default: '5' },
      'no-rewrite': { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: true,
  });
} catch (err) {
  console.error(`\n  Error: ${err.message}`);
  console.error(HELP);
  process.exit(1);
}

const { values, positionals } = parsed;

if (values.help || positionals.length === 0) {
  console.log(HELP);
  process.exit(values.help ? 0 : 1);
}

try {
  await run({
    domain: positionals[0],
    outputDir: values.output,
    from: values.from,
    to: values.to,
    pick: values.pick === 'first' ? 'first' : 'last',
    includeSubs: values['include-subs'],
    concurrency: Math.max(1, parseInt(values.concurrency, 10) || 5),
    rewriteUrls: !values['no-rewrite'],
    dryRun: values['dry-run'],
  });
} catch (err) {
  console.error(`\n  Fatal: ${err.message}\n`);
  process.exit(1);
}
