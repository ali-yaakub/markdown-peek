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

// Rows carry plain text now; the view is what turns them into markup.
function sides(base, cur, opts) {
  const d = D.unified(base, cur, Object.assign({ context: 3 }, opts || {}));
  const oldSide = d.rows.filter(r => r.kind !== 'add').map(r => r.text);
  const newSide = d.rows.filter(r => r.kind !== 'del').map(r => r.text);
  return { d, oldSide, newSide };
}

// The characters a mark covers, for readable assertions.
function marked(row) {
  if (!row.mark) return '';
  let out = '';
  for (let i = 0; i < row.text.length; i++) if (row.mark[i]) out += row.text[i];
  return out;
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
  eq('insert: text', row.text, 'NEW');
}

// 3. A pure deletion keeps the removed line, numbered on the old side only.
{
  const d = D.unified('a\nGONE\nb\n', 'a\nb\n');
  eq('delete: one removal', d.removed, 1);
  eq('delete: nothing added', d.added, 0);
  const row = d.rows.find(r => r.kind === 'del');
  eq('delete: old line number', row.oldLine, 1);
  eq('delete: no new line number', row.newLine, null);
  eq('delete: text', row.text, 'GONE');
}

// 4. An edited line becomes a del/add pair carrying word marks.
{
  const d = D.unified('The quick brown fox\n', 'The quick red fox\n');
  const del = d.rows.find(r => r.kind === 'del');
  const add = d.rows.find(r => r.kind === 'add');
  eq('edit: removed word marked', marked(del), 'brown');
  eq('edit: added word marked', marked(add), 'red');
  eq('edit: mark spans the whole line', del.mark.length, del.text.length);
  eq('edit: deletion precedes addition',
     d.rows.filter(r => r.kind !== 'ctx').map(r => r.kind), ['del', 'add']);
}

// 5. Wholly different lines are not word-diffed into confetti.
{
  const d = D.unified('alpha beta gamma\n', 'wholly unrelated sentence\n');
  eq('dissimilar: no marks on the removal', d.rows.find(r => r.kind === 'del').mark, null);
  eq('dissimilar: no marks on the addition', d.rows.find(r => r.kind === 'add').mark, null);
}

// 6. Rows carry text, never markup. The view sets it through textContent, so a
//    document containing HTML cannot reach the page as live markup.
{
  const d = D.unified('<script>alert(1)</script>\n', '<script>alert(2)</script>\n');
  const del = d.rows.find(r => r.kind === 'del');
  eq('text: passed through verbatim', del.text, '<script>alert(1)</script>');
  check('text: no entity encoding applied', del.text.indexOf('&lt;') === -1, del.text);
  check('rows: carry no html property', d.rows.every(r => r.html === undefined), 'html present');
}

// 7. Lexer style runs are expanded to one index per character.
{
  const d = D.unified('a\n# Heading\nb\n', 'a\n# Heading here\nb\n', {
    context: 3,
    curRuns: '0:1|6:15|0:1|'
  });
  const add = d.rows.find(r => r.kind === 'add');
  eq('runs: one style per character', add.styles.length, add.text.length);
  eq('runs: heading style applied', Array.from(add.styles).every(v => v === 6), true);

  const ctx = d.rows.find(r => r.kind === 'ctx');
  eq('runs: default where none supplied', Array.from(ctx.styles).every(v => v === 0), true);
}

// 8. A short or malformed run string must not overrun or leave the array ragged.
{
  const d = D.unified('x\n', 'abcdef\n', { context: 3, curRuns: '3:2|' });
  const add = d.rows.find(r => r.kind === 'add');
  eq('runs: length still matches the text', add.styles.length, 6);
  eq('runs: covered head', Array.from(add.styles.slice(0, 2)).join(''), '33');
  eq('runs: uncovered tail falls back', Array.from(add.styles.slice(2)).join(''), '0000');

  const junk = D.unified('x\n', 'abc\n', { context: 3, curRuns: 'nonsense|:|9:|' });
  eq('runs: junk is survivable', junk.rows.find(r => r.kind === 'add').styles.length, 3);
}

// 9. Reconstruction. The property that matters most: the rows must rebuild both
//    sides of the comparison exactly.
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

// 10. Line numbers ascend without gaps on each side.
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

// 11. Hunks cover every change, and context stays bounded.
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

// 12. The hunk header names the Markdown section it falls in.
{
  const d = D.unified('# Report\n\n## Expenses\n\nflat\n',
                      '# Report\n\n## Expenses\n\nlower\n', { context: 0 });
  eq('section: nearest heading above the change', d.hunks[0].section, 'Expenses');
}

// 13. A realistic document, and a check that it stays fast.
{
  const base = [];
  for (let i = 0; i < 4000; i++) base.push('Line ' + i + ' of the baseline document.');
  const cur = base.slice();
  for (let i = 0; i < 4000; i += 97) cur[i] = 'Line ' + i + ' of the edited document.';
  cur.splice(500, 0, 'An inserted paragraph.');
  cur.splice(2500, 3);

  // A run string for every line, so the expansion cost is measured too.
  const runs = cur.map(l => '0:' + l.length).join('|');

  const t0 = Date.now();
  const d = D.unified(base.join('\n'), cur.join('\n'), { context: 3, curRuns: runs });
  const ms = Date.now() - t0;

  check('large: completes under 2s', ms < 2000, ms + ' ms');
  eq('large: rebuilds the old side',
     d.rows.filter(r => r.kind !== 'add').map(r => r.text).join('\n'), base.join('\n'));
  eq('large: rebuilds the new side',
     d.rows.filter(r => r.kind !== 'del').map(r => r.text).join('\n'), cur.join('\n'));
  console.log('      large document: ' + ms + ' ms, ' + d.hunks.length + ' hunks, +' +
              d.added + ' −' + d.removed);
}

// 14. Empty and single-line edge cases must not throw.
{
  check('edge: both empty', (function () { D.unified('', ''); return true; })());
  check('edge: newline only', (function () { D.unified('\n', ''); return true; })());
  check('edge: no trailing newline', (function () { D.unified('a', 'b'); return true; })());
  check('edge: zero context', (function () { D.unified('a\nb\n', 'a\nc\n', { context: 0 }); return true; })());
}

/* ----------------------------------------------------------- summary ----- */

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
