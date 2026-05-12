import fs from 'node:fs/promises';
import path from 'node:path';
import pLimit from 'p-limit';
import { listSnapshots } from './cdx.js';
import { downloadAsset } from './downloader.js';
import { rewriteHtml, rewriteCss } from './rewriter.js';

export async function run({
  domain,
  outputDir,
  from,
  to,
  pick,
  includeSubs,
  concurrency,
  rewriteUrls,
  dryRun,
}) {
  domain = domain.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const absOut = path.resolve(outputDir);

  console.log(`\n  Domain:       ${domain}`);
  console.log(`  Output:       ${absOut}`);
  if (from || to) console.log(`  Date range:   ${from || '*'} → ${to || '*'}`);
  console.log(`  Concurrency:  ${concurrency}`);
  console.log(`  Snapshot:     keep ${pick} per URL`);
  console.log(`  Subdomains:   ${includeSubs ? 'included' : 'excluded'}`);
  console.log(`  Rewrite URLs: ${rewriteUrls ? 'yes' : 'no'}`);
  console.log(`  Mode:         ${dryRun ? 'dry-run' : 'download'}\n`);

  console.log('  Querying Wayback CDX index...');
  const raw = await listSnapshots(domain, { from, to, includeSubs });
  if (!raw.length) {
    console.log('  No snapshots found. Try widening --from/--to.');
    return;
  }

  // Dedupe by urlkey, keeping first or last snapshot in the range.
  const dedup = new Map();
  for (const s of raw) {
    const existing = dedup.get(s.urlkey);
    if (!existing) {
      dedup.set(s.urlkey, s);
    } else if (pick === 'last' && s.timestamp > existing.timestamp) {
      dedup.set(s.urlkey, s);
    } else if (pick === 'first' && s.timestamp < existing.timestamp) {
      dedup.set(s.urlkey, s);
    }
  }
  const snapshots = [...dedup.values()];

  console.log(`  Found ${raw.length} archived captures across ${snapshots.length} unique URLs.\n`);

  if (dryRun) {
    for (const s of snapshots.slice(0, 200)) {
      console.log(`  ${s.timestamp}  ${s.mimetype.padEnd(24)}  ${s.original}`);
    }
    if (snapshots.length > 200) console.log(`  ... and ${snapshots.length - 200} more`);
    return;
  }

  await fs.mkdir(absOut, { recursive: true });

  // First pass: download all assets.
  const limit = pLimit(concurrency);
  const stats = { ok: 0, cached: 0, failed: 0 };
  const fileMap = new Map(); // canonical URL → { localPath, contentType }
  let done = 0;

  await Promise.all(
    snapshots.map((snap) =>
      limit(async () => {
        const localPath = urlToLocalPath(snap.original, absOut);
        try {
          const { written, contentType } = await downloadAsset(snap, localPath);
          fileMap.set(canonicalize(snap.original), { localPath, contentType });
          stats[written ? 'ok' : 'cached']++;
        } catch (err) {
          stats.failed++;
          process.stderr.write(`\n  ✗ ${snap.original} — ${err.message}`);
        } finally {
          done++;
          if (done % 5 === 0 || done === snapshots.length) {
            process.stdout.write(
              `\r  Downloaded ${stats.ok} new, ${stats.cached} cached, ${stats.failed} failed  (${done}/${snapshots.length})`
            );
          }
        }
      })
    )
  );

  process.stdout.write('\n\n');

  // Second pass: rewrite internal links to local paths.
  if (rewriteUrls) {
    console.log('  Rewriting internal links...');
    let rewritten = 0;
    for (const [origUrl, entry] of fileMap.entries()) {
      const ct = entry.contentType || '';
      try {
        if (/text\/html|application\/xhtml/.test(ct) || entry.localPath.endsWith('.html')) {
          await rewriteHtml(entry.localPath, origUrl, fileMap);
          rewritten++;
        } else if (/text\/css/.test(ct) || entry.localPath.endsWith('.css')) {
          await rewriteCss(entry.localPath, origUrl, fileMap);
          rewritten++;
        }
      } catch (err) {
        process.stderr.write(`\n  ✗ Rewrite failed: ${entry.localPath} — ${err.message}`);
      }
    }
    console.log(`  Rewrote ${rewritten} files.\n`);
  }

  // Find a sensible landing page to suggest.
  const landingCandidates = [
    `http://${domain}/`,
    `http://${domain}`,
    `https://${domain}/`,
    `http://www.${domain}/`,
  ];
  let entry;
  for (const c of landingCandidates) {
    entry = fileMap.get(canonicalize(c));
    if (entry) break;
  }

  console.log('  Summary:');
  console.log(`    Downloaded:  ${stats.ok}`);
  console.log(`    Already had: ${stats.cached}`);
  console.log(`    Failed:      ${stats.failed}`);
  console.log(`    Output:      ${absOut}`);
  if (entry) {
    console.log(`\n  Open this file to view the mirror:`);
    console.log(`    ${entry.localPath}\n`);
  } else {
    console.log(`\n  Browse ${absOut} to find the entry point.\n`);
  }
}

// ---------- helpers ----------

function urlToLocalPath(rawUrl, baseDir) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    return path.join(baseDir, '_unparseable', encodeURIComponent(rawUrl));
  }

  let p = decodeURIComponent(u.pathname || '/');
  if (p === '' || p === '/') p = '/index.html';
  else if (p.endsWith('/')) p += 'index.html';
  else if (!path.extname(p)) p += '/index.html';

  // Encode query string into filename so different queries don't collide.
  if (u.search) {
    const ext = path.extname(p);
    const stem = ext ? p.slice(0, -ext.length) : p;
    const q = u.search.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 60);
    p = `${stem}__${q}${ext}`;
  }

  // Sanitize path segments — keep them filesystem-safe on Windows too.
  p = p
    .split('/')
    .map((seg) => seg.replace(/[<>:"|?*\x00-\x1f]/g, '_'))
    .join('/');

  return path.join(baseDir, u.hostname, p);
}

function canonicalize(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    // Normalize default ports and trailing slash on bare host.
    if (u.pathname === '') u.pathname = '/';
    return u.toString();
  } catch {
    return url;
  }
}
