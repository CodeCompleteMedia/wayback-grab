import fs from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';

// Strip Wayback's URL wrapper if it slipped into an attribute:
//   https://web.archive.org/web/20131208023519/http://example.com/foo.css
//   https://web.archive.org/web/20131208023519id_/http://example.com/foo.css
const WAYBACK_WRAPPER = /^https?:\/\/web\.archive\.org\/web\/\d+(?:id_|im_|cs_|js_|fw_|oe_|sw_)?\//i;

const HTML_ATTRS = [
  ['a', 'href'],
  ['link', 'href'],
  ['script', 'src'],
  ['img', 'src'],
  ['img', 'data-src'],
  ['source', 'src'],
  ['source', 'srcset'],
  ['iframe', 'src'],
  ['form', 'action'],
  ['video', 'src'],
  ['video', 'poster'],
  ['audio', 'src'],
  ['object', 'data'],
  ['embed', 'src'],
  ['use', 'href'],
  ['use', 'xlink:href'],
];

export async function rewriteHtml(filePath, origUrl, fileMap) {
  const html = await fs.readFile(filePath, 'utf-8');
  const $ = cheerio.load(html, { decodeEntities: false });

  // Strip Wayback's injected toolbar/scripts if any made it past id_.
  $('#wm-ipp-base, #wm-ipp, script[src*="archive.org"], link[href*="archive.org"]').remove();
  $('base').remove(); // local files shouldn't use a remote <base href>

  for (const [tag, attr] of HTML_ATTRS) {
    $(tag).each((_, el) => {
      const value = $(el).attr(attr);
      if (!value) return;
      if (attr === 'srcset') {
        $(el).attr(attr, rewriteSrcset(value, origUrl, fileMap, filePath));
      } else {
        const rewritten = resolveLocal(value, origUrl, fileMap, filePath);
        if (rewritten) $(el).attr(attr, rewritten);
      }
    });
  }

  // <img srcset>
  $('img[srcset]').each((_, el) => {
    const srcset = $(el).attr('srcset');
    if (srcset) $(el).attr('srcset', rewriteSrcset(srcset, origUrl, fileMap, filePath));
  });

  // Inline style="background:url(...)" and <style> blocks.
  $('[style]').each((_, el) => {
    const s = $(el).attr('style');
    if (s) $(el).attr('style', rewriteCssUrls(s, origUrl, fileMap, filePath));
  });
  $('style').each((_, el) => {
    const css = $(el).html();
    if (css) $(el).html(rewriteCssUrls(css, origUrl, fileMap, filePath));
  });

  await fs.writeFile(filePath, $.html());
}

export async function rewriteCss(filePath, origUrl, fileMap) {
  const css = await fs.readFile(filePath, 'utf-8');
  await fs.writeFile(filePath, rewriteCssUrls(css, origUrl, fileMap, filePath));
}

// ---------- helpers ----------

function rewriteSrcset(srcset, origUrl, fileMap, currentLocalPath) {
  return srcset
    .split(',')
    .map((entry) => {
      const parts = entry.trim().split(/\s+/);
      const u = parts.shift();
      const local = resolveLocal(u, origUrl, fileMap, currentLocalPath);
      return [local || u, ...parts].join(' ');
    })
    .join(', ');
}

function rewriteCssUrls(css, origUrl, fileMap, currentLocalPath) {
  return css
    .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (match, quote, ref) => {
      const local = resolveLocal(ref, origUrl, fileMap, currentLocalPath);
      return local ? `url(${quote}${local}${quote})` : match;
    })
    .replace(/@import\s+(?:url\()?\s*(['"])([^'"]+)\1\s*\)?/g, (match, quote, ref) => {
      const local = resolveLocal(ref, origUrl, fileMap, currentLocalPath);
      return local ? `@import ${quote}${local}${quote}` : match;
    });
}

function resolveLocal(rawUrl, origUrl, fileMap, currentLocalPath) {
  if (!rawUrl) return null;
  const trimmed = rawUrl.trim();
  if (
    !trimmed ||
    trimmed.startsWith('data:') ||
    trimmed.startsWith('mailto:') ||
    trimmed.startsWith('tel:') ||
    trimmed.startsWith('javascript:') ||
    trimmed.startsWith('#')
  ) {
    return null;
  }

  // Unwrap Wayback's archive prefix if the original HTML referenced it.
  const cleaned = trimmed.replace(WAYBACK_WRAPPER, '');

  let abs;
  try {
    abs = new URL(cleaned, origUrl);
    abs.hash = '';
  } catch {
    return null;
  }

  // Try a few canonicalizations — some pages link to http vs https,
  // with or without trailing slash, with or without www.
  const candidates = [
    abs.toString(),
    flipProtocol(abs.toString()),
    abs.toString().replace(/\/$/, ''),
    abs.toString().endsWith('/') ? abs.toString() : abs.toString() + '/',
    flipWww(abs.toString()),
  ];

  for (const c of candidates) {
    const entry = fileMap.get(c);
    if (entry) return toRelative(entry.localPath, currentLocalPath);
  }
  return null;
}

function flipProtocol(url) {
  return url.startsWith('http://') ? url.replace(/^http:/, 'https:') : url.replace(/^https:/, 'http:');
}
function flipWww(url) {
  try {
    const u = new URL(url);
    u.hostname = u.hostname.startsWith('www.') ? u.hostname.slice(4) : 'www.' + u.hostname;
    return u.toString();
  } catch {
    return url;
  }
}

function toRelative(targetPath, fromFile) {
  const rel = path.relative(path.dirname(fromFile), targetPath).replace(/\\/g, '/');
  return rel.startsWith('.') ? rel : './' + rel;
}
