// Wayback CDX server: returns an index of every capture for a URL pattern.
// Docs: https://github.com/internetarchive/wayback/blob/master/wayback-cdx-server/README.md

const CDX_ENDPOINT = 'https://web.archive.org/cdx/search/cdx';
const FIELDS = ['urlkey', 'timestamp', 'original', 'mimetype', 'statuscode', 'digest', 'length'];

export async function listSnapshots(domain, { from = '', to = '', includeSubs = false } = {}) {
  const params = new URLSearchParams({
    url: includeSubs ? `*.${domain}/*` : `${domain}/*`,
    output: 'json',
    fl: FIELDS.join(','),
    filter: 'statuscode:200',
  });
  if (from) params.append('from', from);
  if (to) params.append('to', to);

  const url = `${CDX_ENDPOINT}?${params.toString()}`;
  const res = await fetchWithRetry(url, { maxRetries: 4 });
  if (!res.ok) {
    throw new Error(`CDX API returned HTTP ${res.status} ${res.statusText}`);
  }

  const text = await res.text();
  if (!text.trim()) return [];

  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(`CDX returned non-JSON (${err.message}). First 200 chars: ${text.slice(0, 200)}`);
  }
  if (!Array.isArray(data) || data.length === 0) return [];

  const [header, ...rows] = data;
  return rows
    .map((row) => Object.fromEntries(header.map((k, i) => [k, row[i]])))
    // Drop any non-text-y mimetypes we definitely don't want (warc metadata, etc.)
    .filter((r) => r.original && r.timestamp);
}

async function fetchWithRetry(url, { maxRetries = 3 } = {}) {
  let lastErr;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'wayback-grab/1.0' } });
      if (res.status === 429 || res.status >= 500) {
        throw new Error(`Retryable HTTP ${res.status}`);
      }
      return res;
    } catch (err) {
      lastErr = err;
      await sleep(800 * (i + 1));
    }
  }
  throw lastErr;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
