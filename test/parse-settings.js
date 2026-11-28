// Exercises parseSettings in index.html.
// Run: node test/parse-settings.js
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('function parseSettings(table) {');
const end = html.indexOf('\nfunction applySettings(', start);
if (start < 0 || end < 0) {
  console.error('parseSettings was not found in index.html');
  process.exit(1);
}
const parseSettings = new Function(html.slice(start, end) + '\nreturn parseSettings;')();

let failed = 0;
function check(name, cond) {
  if (cond) console.log('ok  ' + name);
  else { failed += 1; console.error('FAIL ' + name); }
}

function table(rows) {
  return {
    cols: [{ label: 'Setting' }, { label: 'Value' }],
    rows: rows.map((pair) => ({
      c: pair.map((v) => (v === undefined ? null : { v: v }))
    }))
  };
}

const empty = parseSettings(null);
check('missing table keeps defaults', empty.siteTitle === 'Fragrance Catalog' && empty.tabs.men === 'Men' && empty.tabs.sold === 'Sold');

const blanks = parseSettings(table([
  ['Site title', ''],
  ['Tab: Men', '   '],
  ['How to use', 'ignore me']
]));
check('blank values keep defaults', blanks.siteTitle === 'Fragrance Catalog' && blanks.tabs.men === 'Men');
check('unknown keys are ignored', blanks.tabs.women === 'Women');

const custom = parseSettings(table([
  ['Site title', 'Preview Catalog'],
  ['Tab: All', 'Everything'],
  ['Tab: Men', 'For Him'],
  ['Tab: Women', 'For Her'],
  ['Tab: Unisex', 'Everyone'],
  ['Tab: Sold', 'Gone']
]));
check('custom title is used', custom.siteTitle === 'Preview Catalog');
check('custom tab labels are used', custom.tabs.all === 'Everything' && custom.tabs.men === 'For Him' && custom.tabs.women === 'For Her' && custom.tabs.unisex === 'Everyone' && custom.tabs.sold === 'Gone');

const padded = parseSettings(table([
  ['  SITE TITLE ', '  Vault  '],
  ['tab: men', 'Him']
]));
check('keys are trimmed and case-insensitive and values are trimmed', padded.siteTitle === 'Vault' && padded.tabs.men === 'Him');

const alt = parseSettings(table([
  ['title', 'Alt Title'],
  ['tab men', 'Mens']
]));
check('title and tab men aliases work', alt.siteTitle === 'Alt Title' && alt.tabs.men === 'Mens');

if (failed) {
  console.error(failed + ' check(s) failed');
  process.exit(1);
}
console.log('all settings checks passed');
