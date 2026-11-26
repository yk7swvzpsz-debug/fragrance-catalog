// Exercises the catalog parser in index.html.
// Run: node test/parse-inventory.js
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('function parseInventory(table) {');
const end = html.indexOf('\nfunction loadInventory(', start);
if (start < 0 || end < 0) {
  console.error('parseInventory was not found in index.html');
  process.exit(1);
}
const parseInventory = new Function(html.slice(start, end) + '\nreturn parseInventory;')();

const HEADERS = [
  'Brand', 'Name', 'Gender', 'Concentration', 'Size', 'Retail', 'Sale', 'Sold',
  'Top Notes', 'Heart Notes', 'Base Notes', 'Image URL', 'Photo', 'Hidden'
];

function table(rows, labels) {
  const cols = (labels || HEADERS).map((label, i) => ({
    id: String.fromCharCode(65 + (i % 26)),
    label: label,
    type: 'string'
  }));
  return { cols, rows };
}

function cells(values) {
  return {
    c: values.map((v) => (v === undefined ? null : { v: v }))
  };
}

function product(hidden, extra) {
  const values = [
    'Acme', 'Rose', 'Women', 'Eau de Parfum', '50ml', 120, 80, 'No',
    'citrus', 'rose', 'musk', 'https://img.example/rose.jpg', null, hidden
  ];
  if (extra) {
    for (const key of Object.keys(extra)) values[key] = extra[key];
  }
  return cells(values);
}

let failed = 0;
function check(name, cond) {
  if (cond) {
    console.log('ok  ' + name);
  } else {
    failed += 1;
    console.error('FAIL ' + name);
  }
}

const shown = parseInventory(table([
  product('No'),
  product('no'),
  product(' NO '),
  product('Yes'),
  product('YES'),
  product(' Yes '),
  product('yes\n'),
  product(null),
  product(''),
  product('   '),
  product(undefined)
]));
check('Yes / YES / padded Yes are left out', shown.length === 7);
check('No, blank, and whitespace-only Hidden stay', shown.every((item) => item.brand === 'Acme' && item.name === 'Rose'));

// Short row: Hidden cell omitted entirely (gviz drops a trailing empty cell).
const short = cells([
  'Acme', 'Short', 'Men', 'EDT', '30ml', 90, 40, 'No',
  'a', 'b', 'c', 'https://img.example/short.jpg', null
]);
const shortItems = parseInventory(table([short, product('Yes', { 1: 'Hidden One' })]));
check('missing Hidden cell is shown', shortItems.some((item) => item.name === 'Short'));
check('explicit Yes beside a short row is hidden', !shortItems.some((item) => item.name === 'Hidden One'));

// Blank retail must not throw, and a sale price still keeps the listing.
const blankRetail = product('No', { 1: 'No Retail', 5: null });
const blankBoth = product('No', { 1: 'No Prices', 5: null, 6: null });
const numeric = product('No', { 1: 'Numeric', 5: 410, 6: 230 });
const currency = product('No', { 1: 'Currency', 5: '$1,250.00', 6: '$99.50' });
let blankResult;
let blankThrew = false;
try {
  blankResult = parseInventory(table([blankRetail, blankBoth, numeric, currency, product('Yes', { 1: 'Hidden Blank Retail', 5: null })]));
} catch (err) {
  blankThrew = true;
  console.error(err);
}
check('blank retail does not throw', !blankThrew);
check('blank retail with a sale price is shown', blankResult.some((item) => item.name === 'No Retail' && item.retail === 0 && item.sale === 80));
check('blank retail and blank sale is still left out', !blankResult.some((item) => item.name === 'No Prices'));
check('numeric retail from gviz is kept', blankResult.some((item) => item.name === 'Numeric' && item.retail === 410 && item.sale === 230));
check('currency-formatted retail still parses', blankResult.some((item) => item.name === 'Currency' && item.retail === 1250 && item.sale === 99.5));
check('hidden row with blank retail is left out', !blankResult.some((item) => item.name === 'Hidden Blank Retail'));

// Sold handling and sheet order (newest / last row first) stay the same.
const ordered = parseInventory(table([
  product('No', { 1: 'First', 7: 'No' }),
  product('No', { 1: 'Sold One', 7: 'Yes' }),
  product('No', { 1: 'Sold Word', 7: 'Sold' }),
  product('Yes', { 1: 'Hidden Sold', 7: 'Yes' }),
  product('No', { 1: 'Last', 7: 'no' })
]));
check('visible order is reversed', ordered.map((item) => item.name).join(',') === 'Last,Sold Word,Sold One,First');
check('sold Yes and Sold still have qty 0', ordered.filter((item) => item.name === 'Sold One' || item.name === 'Sold Word').every((item) => item.qty === 0));
check('unsold rows still have qty 1', ordered.filter((item) => item.name === 'First' || item.name === 'Last').every((item) => item.qty === 1));
check('hidden sold row is left out', !ordered.some((item) => item.name === 'Hidden Sold'));

// Header name wins over a fixed column index.
const shiftedLabels = HEADERS.slice();
shiftedLabels[13] = 'Extra';
shiftedLabels.push('Hidden');
const shifted = parseInventory(table([
  cells([
    'Acme', 'Header No', 'Unisex', 'EDP', '50ml', 100, 50, 'No',
    'a', 'b', 'c', 'https://img.example/h.jpg', null, 'Yes', 'No'
  ]),
  cells([
    'Acme', 'Header Yes', 'Unisex', 'EDP', '50ml', 100, 50, 'No',
    'a', 'b', 'c', 'https://img.example/h2.jpg', null, 'No', 'Yes'
  ])
], shiftedLabels));
check('Hidden header that is not column N is the one that hides', shifted.length === 1 && shifted[0].name === 'Header No');

const oddLabel = HEADERS.slice();
oddLabel[13] = '  HIDDEN ';
const odd = parseInventory(table([product('Yes', { 1: 'Odd Header' })], oddLabel));
check('Hidden header match is trimmed and case-insensitive', odd.length === 0);

// No header: fall back to column N (index 13).
const unlabeled = HEADERS.map((label, i) => (i === 13 ? '' : label));
const fallback = parseInventory(table([
  product('Yes', { 1: 'Fallback Yes' }),
  product('No', { 1: 'Fallback No' }),
  product('', { 1: 'Fallback Blank' })
], unlabeled));
check('without a Hidden header, column N Yes is hidden', fallback.map((item) => item.name).sort().join(',') === 'Fallback Blank,Fallback No');

const empty = parseInventory(table([cells([])]));
check('empty row does not throw and is skipped', empty.length === 0);

// Upon Request is a badge flag only. Yes (any case, trimmed) is on.
// No, blank, whitespace, and a missing cell stay off. Hidden still wins.
const uponLabels = HEADERS.concat('Upon Request');
const uponRows = parseInventory(table([
  product('No', { 1: 'Yes', 14: 'Yes' }),
  product('No', { 1: 'Upper', 14: 'YES' }),
  product('No', { 1: 'Padded', 14: ' Yes ' }),
  product('No', { 1: 'Newline', 14: 'yes\n' }),
  product('No', { 1: 'No Word', 14: 'No' }),
  product('No', { 1: 'Lower No', 14: 'no' }),
  product('No', { 1: 'Padded No', 14: ' NO ' }),
  product('No', { 1: 'Blank', 14: '' }),
  product('No', { 1: 'Spaces', 14: '   ' }),
  product('No', { 1: 'Null Cell', 14: null }),
  product('No', { 1: 'Missing' }),
  product('No', { 1: 'Other', 14: 'Yeah' }),
  product('Yes', { 1: 'Hidden Upon', 14: 'Yes', 5: 100, 6: 71 }),
  product('No', { 1: 'Sold Upon', 7: 'Yes', 14: 'Yes', 5: 100, 6: 71 }),
  product('No', { 1: 'Sold Word Upon', 7: 'Sold', 14: 'yes' })
], uponLabels));
check('upon-request order stays reversed and hidden rows stay out', uponRows.map((item) => item.name).join(',') === 'Sold Word Upon,Sold Upon,Other,Missing,Null Cell,Spaces,Blank,Padded No,Lower No,No Word,Newline,Padded,Upper,Yes');
check('Yes / YES / padded Yes turn the flag on', uponRows.filter((item) => item.name === 'Yes' || item.name === 'Upper' || item.name === 'Padded' || item.name === 'Newline').every((item) => item.uponRequest === true));
check('No, blank, missing, and other words leave the flag off', uponRows.filter((item) => ['No Word', 'Lower No', 'Padded No', 'Blank', 'Spaces', 'Null Cell', 'Missing', 'Other'].includes(item.name)).every((item) => item.uponRequest === false));
check('hidden Yes is left out even when Upon Request is Yes', !uponRows.some((item) => item.name === 'Hidden Upon'));
const soldUpon = uponRows.find((item) => item.name === 'Sold Upon');
check('sold Yes with a discount still has qty 0 and both prices', soldUpon && soldUpon.qty === 0 && soldUpon.retail === 100 && soldUpon.sale === 71 && soldUpon.uponRequest === true);
check('sold word with Upon Request Yes still has qty 0', uponRows.find((item) => item.name === 'Sold Word Upon').qty === 0 && uponRows.find((item) => item.name === 'Sold Word Upon').uponRequest === true);
check('an unsold Upon Request row still has qty 1', uponRows.find((item) => item.name === 'Yes').qty === 1);

// Header name wins over column O.
const uponShifted = HEADERS.concat(['Notes Extra', 'Upon Request']);
const shiftedUpon = parseInventory(table([
  cells([
    'Acme', 'Column O Yes', 'Women', 'EDP', '50ml', 120, 80, 'No',
    'a', 'b', 'c', 'https://img.example/a.jpg', null, 'No', 'Yes', 'No'
  ]),
  cells([
    'Acme', 'Header Yes', 'Women', 'EDP', '50ml', 120, 80, 'No',
    'a', 'b', 'c', 'https://img.example/b.jpg', null, 'No', 'No', 'Yes'
  ])
], uponShifted));
check('Upon Request header that is not column O is the one that flags', shiftedUpon.length === 2 && shiftedUpon.find((item) => item.name === 'Column O Yes').uponRequest === false && shiftedUpon.find((item) => item.name === 'Header Yes').uponRequest === true);

const oddUponLabels = HEADERS.concat('  uPoN rEqUeSt ');
const oddUpon = parseInventory(table([
  product('No', { 1: 'Odd Upon', 14: 'Yes' })
], oddUponLabels));
check('Upon Request header match is trimmed and case-insensitive', oddUpon.length === 1 && oddUpon[0].uponRequest === true);

// No header: fall back to column O (index 14). Default headers stop at Hidden.
const fallbackUpon = parseInventory(table([
  product('No', { 1: 'Fallback Upon Yes', 14: 'Yes' }),
  product('No', { 1: 'Fallback Upon No', 14: 'No' }),
  product('No', { 1: 'Fallback Upon Blank', 14: '' })
]));
check('without an Upon Request header, column O Yes is flagged', fallbackUpon.find((item) => item.name === 'Fallback Upon Yes').uponRequest === true);
check('without an Upon Request header, column O No and blank stay off', fallbackUpon.filter((item) => item.name !== 'Fallback Upon Yes').every((item) => item.uponRequest === false));

// Current sheet labels (Top / Heart, not "Top Notes") still resolve notes and Sold.
const sheetLabels = [
  'Brand', 'Name', 'Gender', 'Concentration', 'Size', 'Retail', 'Sale', 'Sold',
  'Top', 'Heart', 'Base Notes', 'Image URL', 'Photo', 'Hidden', 'Upon Request',
  'Owner', 'Quantity'
];
const sheetRow = parseInventory(table([
  product('No', { 1: 'Sheet Labels', 7: 'Yes', 8: 'bergamot', 9: 'jasmine', 10: 'cedar', 14: 'Yes' })
], sheetLabels));
check('current layout with Top/Heart headers reads sold, notes, and image', sheetRow.length === 1 && sheetRow[0].name === 'Sheet Labels' && sheetRow[0].qty === 0 && sheetRow[0].notes.top === 'bergamot' && sheetRow[0].notes.heart === 'jasmine' && sheetRow[0].notes.base === 'cedar' && sheetRow[0].img === 'https://img.example/rose.jpg' && sheetRow[0].uponRequest === true);

// Post-move layout: Sold sits after Photo. Both layouts must parse identically.
const MOVED_HEADERS = [
  'Brand', 'Name', 'Gender', 'Concentration', 'Size', 'Retail', 'Sale',
  'Top', 'Heart', 'Base Notes', 'Image URL', 'Photo', 'Sold', 'Hidden',
  'Upon Request', 'Owner', 'Quantity'
];

function movedCells(overrides) {
  const values = [
    'Acme', 'Rose', 'Women', 'Eau de Parfum', '50ml', 120, 80,
    'citrus', 'rose', 'musk', 'https://img.example/rose.jpg', null,
    'No', 'No', '', '', ''
  ];
  if (overrides) {
    for (const key of Object.keys(overrides)) values[key] = overrides[key];
  }
  return cells(values);
}

function fields(item) {
  return [
    item.brand, item.name, item.gender, item.concentration, item.size,
    item.retail, item.sale, item.qty, item.uponRequest,
    item.notes.top, item.notes.heart, item.notes.base, item.img
  ].join('|');
}

const currentPair = parseInventory(table([
  product('No', { 1: 'First', 7: 'No', 8: 'bergamot', 9: 'jasmine', 10: 'cedar' }),
  product('No', { 1: 'Sold One', 7: 'Yes', 8: 'pepper', 9: 'rose', 10: 'musk' }),
  product('No', { 1: 'Sold Word', 7: 'Sold', 14: 'Yes' }),
  product('Yes', { 1: 'Hidden Sold', 7: 'Yes' }),
  product('No', { 1: 'Upon', 14: 'Yes' }),
  product('No', { 1: 'Last', 7: 'no' })
], sheetLabels));
const movedPair = parseInventory(table([
  movedCells({ 1: 'First', 12: 'No', 7: 'bergamot', 8: 'jasmine', 9: 'cedar' }),
  movedCells({ 1: 'Sold One', 12: 'Yes', 7: 'pepper', 8: 'rose', 9: 'musk' }),
  movedCells({ 1: 'Sold Word', 12: 'Sold', 14: 'Yes' }),
  movedCells({ 1: 'Hidden Sold', 12: 'Yes', 13: 'Yes' }),
  movedCells({ 1: 'Upon', 14: 'Yes' }),
  movedCells({ 1: 'Last', 12: 'no' })
], MOVED_HEADERS));
check('moved layout keeps the same visible order', movedPair.map((item) => item.name).join(',') === 'Last,Upon,Sold Word,Sold One,First');
check('current and moved layouts parse identically', currentPair.map(fields).join('\n') === movedPair.map(fields).join('\n'));
check('moved layout still marks Sold Yes / Sold as qty 0', movedPair.filter((item) => item.name === 'Sold One' || item.name === 'Sold Word').every((item) => item.qty === 0));
check('moved layout still leaves unsold rows at qty 1', movedPair.filter((item) => item.name === 'First' || item.name === 'Last' || item.name === 'Upon').every((item) => item.qty === 1));
check('moved layout still omits a hidden sold row', !movedPair.some((item) => item.name === 'Hidden Sold'));
check('moved layout still flags Upon Request', movedPair.find((item) => item.name === 'Upon').uponRequest === true && movedPair.find((item) => item.name === 'Sold Word').uponRequest === true);
check('moved layout reads notes and image from the shifted columns', movedPair.find((item) => item.name === 'Sold One').notes.top === 'pepper' && movedPair.find((item) => item.name === 'Sold One').notes.heart === 'rose' && movedPair.find((item) => item.name === 'Sold One').notes.base === 'musk' && movedPair.find((item) => item.name === 'Sold One').img === 'https://img.example/rose.jpg');

// Sold header wins over the old column H index. After the move, index 7 is Top.
const movedSoldHeader = parseInventory(table([
  movedCells({ 1: 'Top Looks Sold', 7: 'Yes', 12: 'No' }),
  movedCells({ 1: 'Actually Sold', 7: 'bergamot', 12: 'Yes' })
], MOVED_HEADERS));
check('Sold header after Photo wins over column H', movedSoldHeader.length === 2 && movedSoldHeader.find((item) => item.name === 'Top Looks Sold').qty === 1 && movedSoldHeader.find((item) => item.name === 'Actually Sold').qty === 0);
check('notes still come from Top when Sold has moved', movedSoldHeader.find((item) => item.name === 'Actually Sold').notes.top === 'bergamot');

const oddSoldLabels = MOVED_HEADERS.slice();
oddSoldLabels[12] = '  SoLd ';
oddSoldLabels[7] = '  TOP ';
const oddSold = parseInventory(table([
  movedCells({ 1: 'Odd Sold', 12: 'Yes', 7: 'lime' })
], oddSoldLabels));
check('Sold and Top header match is trimmed and case-insensitive', oddSold.length === 1 && oddSold[0].qty === 0 && oddSold[0].notes.top === 'lime');

// gviz may drop trailing empty cells after the move (Sold / Hidden / Upon / Owner / Quantity).
const movedShort = cells([
  'Acme', 'Moved Short', 'Men', 'EDT', '30ml', 90, 40,
  'a', 'b', 'c', 'https://img.example/short.jpg', null
]);
const movedShortItems = parseInventory(table([
  movedShort,
  movedCells({ 1: 'Hidden One', 13: 'Yes' }),
  movedCells({ 1: 'Sold Trailing', 12: 'Yes' })
], MOVED_HEADERS));
check('moved short row with no Sold or Hidden cell is shown unsold', movedShortItems.some((item) => item.name === 'Moved Short' && item.qty === 1 && item.img === 'https://img.example/short.jpg' && item.notes.top === 'a'));
check('explicit Hidden Yes beside a moved short row is hidden', !movedShortItems.some((item) => item.name === 'Hidden One'));
check('explicit Sold Yes beside a moved short row is sold', movedShortItems.find((item) => item.name === 'Sold Trailing').qty === 0);

// Image URL header wins over the old index 11, which is Photo after the move.
const photoTrap = parseInventory(table([
  cells([
    'Acme', 'Photo Trap', 'Women', 'EDP', '50ml', 120, 80,
    'citrus', 'rose', 'musk', 'https://img.example/real.jpg', 'https://img.example/photo-formula.jpg',
    'No', 'No'
  ])
], MOVED_HEADERS));
check('Image URL header is used even when Photo has a different value', photoTrap.length === 1 && photoTrap[0].img === 'https://img.example/real.jpg');

// Empty labels still fall back to the current-layout indices, including Sold at 7.
const allBlankLabels = sheetLabels.map(() => '');
const blankLabelRows = parseInventory(table([
  product('No', { 1: 'Fallback Sold', 7: 'Yes', 8: 'top1', 11: 'https://img.example/fb.jpg' }),
  product('No', { 1: 'Fallback Open', 7: 'No', 8: 'top2', 11: 'https://img.example/fb2.jpg' })
], allBlankLabels));
check('empty labels fall back to column H for Sold', blankLabelRows.find((item) => item.name === 'Fallback Sold').qty === 0 && blankLabelRows.find((item) => item.name === 'Fallback Open').qty === 1);
check('empty labels fall back to current note and image indexes', blankLabelRows.find((item) => item.name === 'Fallback Sold').notes.top === 'top1' && blankLabelRows.find((item) => item.name === 'Fallback Sold').img === 'https://img.example/fb.jpg');

if (failed) {
  console.error(failed + ' check(s) failed');
  process.exit(1);
}
console.log('all parser checks passed');
