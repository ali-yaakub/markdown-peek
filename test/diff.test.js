/* Tests for the diff engine. Run with: node test\diff.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(
  fs.readFileSync(path.join(__dirname, '..', 'assets', 'diff.js'), 'utf8'),
  sandbox,
  { filename: 'diff.js' }
);
const D = sandbox.MdPeekDiff;

let pass = 0;
let fail = 0;

function check(name, cond, detail) {
  if (cond) { pass++; return; }
  fail++;
  console.error('FAIL  ' + name + (detail ? '\n      ' + detail : ''));
}

function eq(name, got, want) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  check(name, g === w, 'got  ' + g + '\n      want ' + w);
}

// Strips the HTML the view needs back to plain text, so a row can be compared
// with the source line it came from.
function plain(html) {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

// The two reconstruction properties every unified diff must satisfy.
function sides(base, cur) {
  const d = D.unified(base, cur, { context: 3 });
  const oldSide = d.rows.filter(r => r.kind !== 'add').map(r => plain(r.html));
  const newSide = d.rows.filter(r => r.kind !== 'del').map(r => plain(r.html));
  return { d, oldSide, newSide };
}

/* ------------------------------------------------------------ cases ------ */

// 1. Identical input produces no hunks and nothing to show.
{
  const src = '# Title\n\nOne\nTwo\n';
  const d = D.unified(src, src);
  eq('identical: nothing added', d.added, 0);
  eq('identical: nothing removed', d.removed, 0);
  eq('identical: no hunks', d.hunks.length, 0);
  eq('identical: flagged', d.identical, true);
  eq('identical: every row is context', d.rows.every(r => r.kind === 'ctx'), true);
}

// 2. A pure insertion.
{
  const d = D.unified('a\nb\n', 'a\nNEW\nb\n');
  eq('insert: one add', d.added, 1);
  eq('insert: nothing removed', d.removed, 0);
  const row = d.rows.find(r => r.kind === 'add');
  eq('insert: no old line number', row.oldLine, null);
  eq('insert: new line number', row.newLine, 1);
  eq('insert: text', plain(row.html), 'NEW');
}

// 3. A pure deletion keeps the removed line, numbered on the old side only.
{
  const d = D.unified('a\nGONE\nb\n', 'a\nb\n');
  eq('delete: one removal', d.removed, 1);
  eq('delete: nothing added', d.added, 0);
  const row = d.rows.find(r => r.kind === 'del');
  eq('delete: old line number', row.oldLine, 1);
  eq('delete: no new line number', row.newLine, null);
  eq('delete: text', plain(row.html), 'GONE');
}

// 4. An edited line becomes a del/add pair carrying word marks.
{
  const d = D.unified('The quick brown fox\n', 'The quick red fox\n');
  const del = d.rows.find(r => r.kind === 'del');
  const add = d.rows.find(r => r.kind === 'add');
  check('edit: removed word marked', del.html.indexOf('<span class="wd">brown</span>') >= 0, del.html);
  check('edit: added word marked', add.html.indexOf('<span class="wa">red</span>') >= 0, add.html);
  check('edit: unchanged words unmarked', del.html.indexOf('The quick ') === 0, del.html);
  eq('edit: deletion precedes addition',
     d.rows.filter(r => r.kind !== 'ctx').map(r => r.kind), ['del', 'add']);
}

// 5. Wholly different lines are not word-diffed into confetti.
{
  const d = D.unified('alpha beta gamma\n', 'wholly unrelated sentence\n');
  const del = d.rows.find(r => r.kind === 'del');
  const add = d.rows.find(r => r.kind === 'add');
  check('dissimilar: no marks on the removal', del.html.indexOf('<span') === -1, del.html);
  check('dissimilar: no marks on the addition', add.html.indexOf('<span') === -1, add.html);
}

// 6. HTML in the source is escaped, never emitted live.
{
  const d = D.unified('<script>alert(1)</script>\n', '<script>alert(2)</script>\n');
  const joined = d.rows.map(r => r.html).join('');
  check('escape: no raw script tag', joined.indexOf('<script') === -1, joined);
  check('escape: entity present', joined.indexOf('&lt;script&gt;') >= 0, joined);
  check('escape: only diff spans survive as markup',
        (joined.match(/<(?!\/?span)/g) || []).length === 0, joined);
}

// 7. Reconstruction. This is the property that matters most: the rows must be
//    able to rebuild both sides exactly.
{
  const cases = [
    ['a\nb\nc\n', 'a\nb\nc\n'],
    ['a\nb\nc\n', 'c\nb\na\n'],
    ['', 'hello\n'],
    ['hello\n', ''],
    ['1\n2\n3\n4\n5\n', '1\n3\n5\n7\n'],
    ['# H\n\ntext\n', '# H2\n\ntext here\n\nmore\n'],
    ['x & y < z\n', 'x & y > z\n']
  ];
  cases.forEach(function (c, i) {
    const { oldSide, newSide } = sides(c[0], c[1]);
    eq('rebuild[' + i + ']: old side', oldSide.join('\n'), c[0]);
    eq('rebuild[' + i + ']: new side', newSide.join('\n'), c[1]);
  });
}

// 8. Line numbers ascend without gaps on each side.
{
  const { d } = sides('a\nb\nc\nd\ne\n', 'a\nX\nc\nY\nZ\ne\n');
  let lastOld = -1;
  let lastNew = -1;
  let ok = true;
  d.rows.forEach(function (r) {
    if (r.oldLine !== null) { if (r.oldLine !== lastOld + 1) ok = false; lastOld = r.oldLine; }
    if (r.newLine !== null) { if (r.newLine !== lastNew + 1) ok = false; lastNew = r.newLine; }
  });
  eq('numbering: contiguous on both sides', ok, true);
}

// 9. Hunks cover every change, and context is bounded.
{
  const base = [];
  for (let i = 0; i < 200; i++) base.push('line ' + i);
  const cur = base.slice();
  cur[10] = 'line ten changed';
  cur[150] = 'line one fifty changed';

  const d = D.unified(base.join('\n'), cur.join('\n'), { context: 3 });
  eq('hunks: two separate regions', d.hunks.length, 2);

  const covered = new Set();
  d.hunks.forEach(h => { for (let i = h.from; i <= h.to; i++) covered.add(i); });
  const uncovered = d.rows
    .map((r, i) => ({ r, i }))
    .filter(x => x.r.kind !== 'ctx' && !covered.has(x.i));
  eq('hunks: every change is inside one', uncovered.length, 0);
  check('hunks: context is bounded', covered.size <= 2 * (2 + 2 * 3 + 2), covered.size + ' rows');
  check('hunks: header shape', /^@@ -\d+,\d+ \+\d+,\d+ @@$/.test(d.hunks[0].header), d.hunks[0].header);
}

// 10. The hunk header names the Markdown section it falls in.
{
  const base = '# Report\n\n## Expenses\n\nflat\n';
  const cur  = '# Report\n\n## Expenses\n\nlower\n';
  const d = D.unified(base, cur, { context: 0 });
  eq('section: nearest heading above the change', d.hunks[0].section, 'Expenses');
}

// 11. A realistic document, and a check that it stays fast.
{
  const base = [];
  for (let i = 0; i < 4000; i++) base.push('Line ' + i + ' of the baseline document.');
  const cur = base.slice();
  for (let i = 0; i < 4000; i += 97) cur[i] = 'Line ' + i + ' of the edited document.';
  cur.splice(500, 0, 'An inserted paragraph.');
  cur.splice(2500, 3);

  const t0 = Date.now();
  const d = D.unified(base.join('\n'), cur.join('\n'), { context: 3 });
  const ms = Date.now() - t0;

  check('large: completes under 2s', ms < 2000, ms + ' ms');
  const oldSide = d.rows.filter(r => r.kind !== 'add').map(r => plain(r.html));
  const newSide = d.rows.filter(r => r.kind !== 'del').map(r => plain(r.html));
  eq('large: rebuilds the old side', oldSide.join('\n'), base.join('\n'));
  eq('large: rebuilds the new side', newSide.join('\n'), cur.join('\n'));
  console.log('      large document: ' + ms + ' ms, ' + d.hunks.length + ' hunks, +' +
              d.added + ' −' + d.removed);
}

// 12. Empty and single-line edge cases must not throw.
{
  check('edge: both empty', (function () { D.unified('', ''); return true; })());
  check('edge: newline only', (function () { D.unified('\n', ''); return true; })());
  check('edge: no trailing newline', (function () { D.unified('a', 'b'); return true; })());
  check('edge: zero context', (function () { D.unified('a\nb\n', 'a\nc\n', { context: 0 }); return true; })());
}

/* ----------------------------------------------------------- summary ----- */

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
