#!/usr/bin/env node
// Builds static p/<slug>.html pages so link previews can show each fragrance.
// Uses the same sheet feed, Hidden filter, itemSlug(), and Settings title as index.html.
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'p');
const OG_DIR = path.join(ROOT, 'images', 'og');
const MANIFEST_PATH = path.join(OG_DIR, 'manifest.json');
const OG_SIZE = 1200;
const CARD_BACKGROUND = '#fafafa';
const SHEET_ID = '1qbzipee61G8YtRI9JAKAmtv7PNl7CtKWYD_xeKu_-cc';
const SITE = 'https://ambrette.store';
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=Inventory&t=${Date.now()}`;

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

function takeFunction(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error('Could not find ' + startMarker);
  return new Function(source.slice(start, end) + '\nreturn ' + startMarker.replace(/\(.*$/, '').replace(/^function /, '') + ';')();
}

const parseInventory = takeFunction(html, 'function parseInventory(table) {', '\nfunction loadInventory(');
const itemSlug = takeFunction(html, 'function itemSlug(item) {', '\nfunction showShareToast');
const parseSettings = takeFunction(html, 'function parseSettings(table) {', '\nfunction applySettings(');

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchText(res.headers.location).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error('Sheet request failed: ' + res.statusCode));
        return;
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function itemTitle(item) {
  return item.brand + ' ' + (item.concentration ? item.name + ' ' + item.concentration : item.name);
}

function absoluteImage(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (e) {
    const file = decodeURIComponent(raw.split('/').pop().split('?')[0]);
    return SITE + '/images/' + encodeURIComponent(file);
  }
  if (parsed.hostname === 'cdn.shopify.com') {
    parsed.searchParams.set('width', '1200');
    return parsed.toString();
  }
  const onSite = parsed.hostname === 'yk7swvzpsz-debug.github.io'
    && /\/images\/[^/]+$/i.test(parsed.pathname);
  if (onSite) {
    const file = decodeURIComponent(parsed.pathname.split('/').pop());
    return SITE + '/images/' + encodeURIComponent(file);
  }
  return raw;
}

function fetchBuffer(url, redirects) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('http:') ? http : https;
    const req = lib.get(url, { headers: { 'User-Agent': 'fragrance-catalog-share-pages' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirects > 5) {
          reject(new Error('Too many redirects for ' + url));
          return;
        }
        fetchBuffer(new URL(res.headers.location, url).toString(), redirects + 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error('Image download failed ' + res.statusCode + ' for ' + url));
        return;
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
  });
}

function localImagePath(imageUrl) {
  const absolute = absoluteImage(imageUrl);
  let pathname = absolute;
  try { pathname = new URL(absolute).pathname; } catch (e) { return null; }
  const match = pathname.match(/\/images\/([^/?#]+)$/i);
  if (!match) return null;
  const file = path.join(ROOT, 'images', decodeURIComponent(match[1]));
  return fs.existsSync(file) ? file : null;
}

function readManifest() {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  } catch (e) {
    return {};
  }
}

async function sourceBuffer(item) {
  const local = localImagePath(item.img);
  if (local) return fs.readFileSync(local);
  return fetchBuffer(String(item.img).trim(), 0);
}

async function writeOgImage(input, dest) {
  await sharp(input, { failOn: 'none' })
    .rotate()
    .resize(OG_SIZE, OG_SIZE, {
      fit: 'contain',
      background: { r: 250, g: 250, b: 250, alpha: 1 }
    })
    .flatten({ background: CARD_BACKGROUND })
    .jpeg({ quality: 85 })
    .toFile(dest);
}

function pageHtml(item, slug, siteTitle) {
  const title = siteTitle || 'Fragrance Catalog';
  const image = SITE + '/images/og/' + slug + '.jpg';
  const pageUrl = SITE + '/p/' + slug + '.html';
  const back = '../?item=' + slug;
  const sizeTags = '<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="1200">\n';
  return '<!DOCTYPE html>\n'
    + '<html lang="en">\n'
    + '<head>\n'
    + '<meta charset="UTF-8">\n'
    + '<title>' + esc(title) + '</title>\n'
    + '<meta property="og:title" content="' + esc(title) + '">\n'
    + '<meta property="og:description" content="Browse available fragrances">\n'
    + '<meta property="og:image" content="' + esc(image) + '">\n'
    + sizeTags
    + '<meta property="og:url" content="' + esc(pageUrl) + '">\n'
    + '<meta name="twitter:card" content="summary_large_image">\n'
    + '<meta http-equiv="refresh" content="0;url=' + esc(back) + '">\n'
    + '<script>location.replace(' + JSON.stringify(back) + ');</script>\n'
    + '</head>\n'
    + '<body>\n'
    + '<p><a href="' + esc(back) + '">' + esc(itemTitle(item)) + '</a></p>\n'
    + '</body>\n'
    + '</html>\n';
}

async function main() {
  const raw = await fetchText(SHEET_URL);
  const match = raw.match(/setResponse\(([\s\S]*)\);\s*$/);
  if (!match) throw new Error('Could not read the sheet response');
  const data = JSON.parse(match[1]);
  if (!data || data.status !== 'ok' || !data.table) throw new Error('Bad sheet response');
  const items = parseInventory(data.table);
  let siteTitle = 'Fragrance Catalog';
  try {
    const settingsUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=Settings&t=${Date.now()}`;
    const settingsRaw = await fetchText(settingsUrl);
    const settingsMatch = settingsRaw.match(/setResponse\(([\s\S]*)\);\s*$/);
    if (settingsMatch) {
      const settingsData = JSON.parse(settingsMatch[1]);
      if (settingsData && settingsData.status === 'ok' && settingsData.table) {
        const parsed = parseSettings(settingsData.table);
        if (parsed && parsed.siteTitle) siteTitle = parsed.siteTitle;
      }
    }
  } catch (err) {
    console.warn('Settings tab unavailable, using default site title');
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(OG_DIR, { recursive: true });
  const previous = readManifest();
  const manifest = {};
  const keepPages = new Set();
  const keepImages = new Set();
  const seen = new Set();
  let written = 0;
  let generated = 0;
  let reused = 0;
  for (const item of items) {
    const slug = itemSlug(item);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    const source = String(item.img).trim();
    const imageName = slug + '.jpg';
    const imagePath = path.join(OG_DIR, imageName);
    keepPages.add(slug + '.html');
    keepImages.add(imageName);
    manifest[slug] = source;
    if (previous[slug] === source && fs.existsSync(imagePath)) {
      reused += 1;
    } else {
      await writeOgImage(await sourceBuffer(item), imagePath);
      generated += 1;
    }
    fs.writeFileSync(path.join(OUT_DIR, slug + '.html'), pageHtml(item, slug, siteTitle));
    written += 1;
  }
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
  let removed = 0;
  for (const name of fs.readdirSync(OUT_DIR)) {
    if (!name.endsWith('.html') || keepPages.has(name)) continue;
    fs.unlinkSync(path.join(OUT_DIR, name));
    removed += 1;
  }
  let removedImages = 0;
  for (const name of fs.readdirSync(OG_DIR)) {
    if (!name.endsWith('.jpg') || keepImages.has(name)) continue;
    fs.unlinkSync(path.join(OG_DIR, name));
    removedImages += 1;
  }
  console.log('Wrote ' + written + ' share pages, removed ' + removed + ' stale pages');
  console.log('Generated ' + generated + ' og images, reused ' + reused + ', removed ' + removedImages + ' stale images');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
