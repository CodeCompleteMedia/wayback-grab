import fs from 'node:fs/promises';
import path from 'node:path';

// The "id_" modifier asks the Wayback Machine for the raw, original asset
// without injecting its toolbar or rewriting links.
//   https://web.archive.org/web/{timestamp}id_/{original_url}
const WAYBACK_BASE = 'https://web.archive.org/web';

export async function downloadAsset(snap, localPath, { maxRetries = 4 } = {}) {
  // Skip if we already have it.
  try {
    const stat = await fs.stat(localPath);
    if (stat.size > 0) {
      return { written: false, contentType: guessContentType(localPath) };
    }
  } catch {
    // No file yet, fall through.
  }

  const url = `${WAYBACK_BASE}/${snap.timestamp}id_/${snap.original}`;
  let lastErr;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        redirect: 'follow',
        headers: { 'User-Agent': 'wayback-grab/1.0' },
      });

      // Wayback occasionally returns 5xx or 429 when hammered — retry those.
      if (res.status === 429 || res.status >= 500) {
        throw new Error(`Retryable HTTP ${res.status}`);
      }
      if (!res.ok) {
        // 404 / 403 — give up on this asset, not the whole job.
        throw new Error(`HTTP ${res.status}`);
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      await fs.mkdir(path.dirname(localPath), { recursive: true });
      await fs.writeFile(localPath, buffer);

      const contentType =
        (res.headers.get('content-type') || '').split(';')[0].trim() || guessContentType(localPath);

      return { written: true, contentType };
    } catch (err) {
      lastErr = err;
      // Exponential-ish backoff with jitter.
      await sleep(600 * (attempt + 1) + Math.random() * 400);
    }
  }
  throw lastErr;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TYPES = {
  '.html': 'text/html',
  '.htm': 'text/html',
  '.xhtml': 'application/xhtml+xml',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
};

function guessContentType(filePath) {
  return TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}
