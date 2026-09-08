/* Markdown Peek - the diff engine.
 *
 * Produces the row list a unified diff view renders: one row per source line,
 * carrying its old and new line numbers, its kind, and word-level marks where a
 * line was edited rather than replaced wholesale. Grouping into hunks with a few
 * lines of context, and collapsing everything else, happens here too.
 */
(function (global) {
  'use strict';

  // Guards. Beyond these a diff stops being informative and starts being slow.
  var MAX_LINES = 60000;
  var MAX_D = 5000;

  /* ------------------------------------------------------------ Myers ---- */

  // Greedy O(ND) with the edit trace kept so the path can be walked back.
  function myersOps(a, b) {
    var N = a.length, M = b.length;
    var ops = [];

    if (N === 0 && M === 0) return ops;
    if (N === 0) { for (var i0 = 0; i0 < M; i0++) ops.push(1); return ops; }
    if (M === 0) { for (var i1 = 0; i1 < N; i1++) ops.push(-1); return ops; }

    var MAX = N + M;
    if (MAX > MAX_LINES) return coarse(N, M);

    var off = MAX;
    var v = new Int32Array(2 * MAX + 1);
    var trace = [];

    for (var d = 0; d <= MAX && d <= MAX_D; d++) {
      trace.push(v.slice(0));
      for (var k = -d; k <= d; k += 2) {
        var x;
        if (k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])) x = v[off + k + 1];
        else x = v[off + k - 1] + 1;
        var y = x - k;
        while (x < N && y < M && a[x] === b[y]) { x++; y++; }
        v[off + k] = x;
        if (x >= N && y >= M) return backtrack(trace, d, off, N, M);
      }
    }
    return coarse(N, M);
  }

  function coarse(N, M) {
    var ops = [], i;
    for (i = 0; i < N; i++) ops.push(-1);
    for (i = 0; i < M; i++) ops.push(1);
    return ops;
  }

  // Produces a flat list: -1 delete from a, +1 insert from b, 0 keep.
  function backtrack(trace, d, off, N, M) {
    var out = [];
    var x = N, y = M;

    for (var dd = d; dd > 0; dd--) {
      var v = trace[dd];
      var k = x - y;
      var prevK;
      if (k === -dd || (k !== dd && v[off + k - 1] < v[off + k + 1])) prevK = k + 1;
      else prevK = k - 1;

      var prevX = v[off + prevK];
      var prevY = prevX - prevK;

      while (x > prevX && y > prevY) { out.push(0); x--; y--; }
      if (x === prevX) { out.push(1); y--; }
      else { out.push(-1); x--; }
    }
    while (x > 0 && y > 0) { out.push(0); x--; y--; }
    while (x > 0) { out.push(-1); x--; }
    while (y > 0) { out.push(1); y--; }

    out.reverse();
    return out;
  }

  /* ------------------------------------------------------- run grouping -- */

  // Collapses the flat op list into runs, trimming the common prefix and suffix
  // first because that is where nearly all of the work usually disappears.
  function diffRuns(aLines, bLines) {
    var aN = aLines.length, bN = bLines.length;

    var pre = 0;
    while (pre < aN && pre < bN && aLines[pre] === bLines[pre]) pre++;

    var suf = 0;
    while (suf < aN - pre && suf < bN - pre &&
           aLines[aN - 1 - suf] === bLines[bN - 1 - suf]) suf++;

    var flat = myersOps(aLines.slice(pre, aN - suf), bLines.slice(pre, bN - suf));

    var runs = [];
    var i;
    if (pre > 0) runs.push({ op: '=', a0: 0, a1: pre, b0: 0, b1: pre });

    var ai = pre, bi = pre, idx = 0;
    while (idx < flat.length) {
      var kind = flat[idx];
      var n = 0;
      while (idx + n < flat.length && flat[idx + n] === kind) n++;

      if (kind === 0) {
        runs.push({ op: '=', a0: ai, a1: ai + n, b0: bi, b1: bi + n });
        ai += n; bi += n;
      } else if (kind === -1) {
        runs.push({ op: '-', a0: ai, a1: ai + n, b0: bi, b1: bi });
        ai += n;
      } else {
        runs.push({ op: '+', a0: ai, a1: ai, b0: bi, b1: bi + n });
        bi += n;
      }
      idx += n;
    }

    if (suf > 0) runs.push({ op: '=', a0: aN - suf, a1: aN, b0: bN - suf, b1: bN });

    // A delete run immediately followed by an insert run is a replacement, and a
    // replacement is what makes word-level marks worth computing.
    var merged = [];
    for (i = 0; i < runs.length; i++) {
      if (runs[i].op === '-' && i + 1 < runs.length && runs[i + 1].op === '+') {
        merged.push({ op: '!', a0: runs[i].a0, a1: runs[i].a1, b0: runs[i + 1].b0, b1: runs[i + 1].b1 });
        i++;
      } else {
        merged.push(runs[i]);
      }
    }
    return merged;
  }

  /* --------------------------------------------------------- word diff --- */

  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function tokenise(line) {
    return line.match(/(\s+|[A-Za-z0-9_]+|[^\sA-Za-z0-9_])/g) || [];
  }

  // Whitespace matches between any two lines and so says nothing about whether
  // they are the same sentence edited. Weigh the words only.
  function similarity(x, y) {
    var a = x.filter(function (t) { return t.trim() !== ''; });
    var b = y.filter(function (t) { return t.trim() !== ''; });
    if (!a.length && !b.length) return 1;
    if (!a.length || !b.length) return 0;

    var counts = Object.create(null), i, t, shared = 0;
    for (i = 0; i < a.length; i++) { t = a[i]; counts[t] = (counts[t] || 0) + 1; }
    for (i = 0; i < b.length; i++) { t = b[i]; if (counts[t] > 0) { counts[t]--; shared++; } }
    return (2 * shared) / (a.length + b.length);
  }

  /**
   * Escaped HTML for a replaced pair, with the differing words wrapped.
   * @returns {{oldHtml:string, newHtml:string}|null} null when the two lines are
   *   too dissimilar for word marks to help, in which case they read better as a
   *   plain removal followed by a plain addition.
   */
  function wordMarks(oldLine, newLine) {
    var A = tokenise(oldLine), B = tokenise(newLine);
    if (!A.length || !B.length) return null;
    if (A.length + B.length > 4000) return null;
    if (similarity(A, B) < 0.35) return null;

    var flat = myersOps(A, B);
    var oldHtml = '', newHtml = '';
    var ai = 0, bi = 0, idx = 0, changed = false;

    while (idx < flat.length) {
      var kind = flat[idx];
      var n = 0;
      while (idx + n < flat.length && flat[idx + n] === kind) n++;

      if (kind === 0) {
        var same = esc(A.slice(ai, ai + n).join(''));
        oldHtml += same;
        newHtml += same;
        ai += n; bi += n;
      } else if (kind === -1) {
        var gone = A.slice(ai, ai + n).join('');
        oldHtml += gone.trim() ? '<span class="wd">' + esc(gone) + '</span>' : esc(gone);
        if (gone.trim()) changed = true;
        ai += n;
      } else {
        var came = B.slice(bi, bi + n).join('');
        newHtml += came.trim() ? '<span class="wa">' + esc(came) + '</span>' : esc(came);
        if (came.trim()) changed = true;
        bi += n;
      }
      idx += n;
    }

    return changed ? { oldHtml: oldHtml, newHtml: newHtml } : null;
  }

  /* ----------------------------------------------------------- unified --- */

  // GitHub labels each hunk with the section it falls in. For Markdown that is
  // the nearest heading above the hunk, which is far more use than a line count.
  function sectionFor(lines, upto) {
    for (var i = Math.min(upto, lines.length - 1); i >= 0; i--) {
      var m = lines[i].match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
      if (m) return m[2];
    }
    return '';
  }

  /**
   * Builds a unified diff.
   *
   * @param {string} baseText
   * @param {string} curText
   * @param {{context?:number}} [opts] Lines of unchanged context kept either side
   *   of a change. Everything further away is collapsed into an expandable gap.
   * @returns {{rows:Array, hunks:Array, added:number, removed:number,
   *            oldTotal:number, newTotal:number, identical:boolean}}
   *   Each row is {kind:'ctx'|'add'|'del', oldLine, newLine, html}. Line numbers
   *   are zero-based document lines, matching Scintilla, or null where the line
   *   does not exist on that side.
   */
  function unified(baseText, curText, opts) {
    var context = opts && typeof opts.context === 'number' ? opts.context : 3;
    var baseLines = baseText.split('\n');
    var curLines = curText.split('\n');

    var runs = diffRuns(baseLines, curLines);
    var rows = [];
    var added = 0, removed = 0;
    var i;

    function push(kind, oldLine, newLine, html) {
      rows.push({ kind: kind, oldLine: oldLine, newLine: newLine, html: html });
    }

    for (var r = 0; r < runs.length; r++) {
      var run = runs[r];

      if (run.op === '=') {
        for (i = 0; i < run.a1 - run.a0; i++) {
          push('ctx', run.a0 + i, run.b0 + i, esc(curLines[run.b0 + i]));
        }

      } else if (run.op === '-') {
        for (i = run.a0; i < run.a1; i++) { push('del', i, null, esc(baseLines[i])); removed++; }

      } else if (run.op === '+') {
        for (i = run.b0; i < run.b1; i++) { push('add', null, i, esc(curLines[i])); added++; }

      } else {
        // Deletions first, then additions, the way a unified diff reads. Lines
        // are paired by position so word marks line up with their counterpart.
        var aCount = run.a1 - run.a0;
        var bCount = run.b1 - run.b0;
        var pairs = Math.min(aCount, bCount);
        var marks = new Array(pairs);

        for (i = 0; i < pairs; i++) {
          marks[i] = wordMarks(baseLines[run.a0 + i], curLines[run.b0 + i]);
        }

        for (i = 0; i < aCount; i++) {
          var oldIdx = run.a0 + i;
          push('del', oldIdx, null,
               (i < pairs && marks[i]) ? marks[i].oldHtml : esc(baseLines[oldIdx]));
          removed++;
        }
        for (i = 0; i < bCount; i++) {
          var newIdx = run.b0 + i;
          push('add', null, newIdx,
               (i < pairs && marks[i]) ? marks[i].newHtml : esc(curLines[newIdx]));
          added++;
        }
      }
    }

    /* ------------------------------------------------ hunks and gaps ----- */

    var changedAt = [];
    for (i = 0; i < rows.length; i++) if (rows[i].kind !== 'ctx') changedAt.push(i);

    var hunks = [];
    if (changedAt.length) {
      var start = Math.max(0, changedAt[0] - context);
      var end = Math.min(rows.length - 1, changedAt[0] + context);

      // An expander bar occupies a row of its own, so collapsing one or two
      // lines behind one saves nothing and reads worse than showing them.
      var MIN_GAP = 3;

      for (i = 1; i < changedAt.length; i++) {
        var c = changedAt[i];
        if (c - context <= end + MIN_GAP) {
          end = Math.min(rows.length - 1, c + context);
        } else {
          hunks.push({ from: start, to: end });
          start = Math.max(0, c - context);
          end = Math.min(rows.length - 1, c + context);
        }
      }
      hunks.push({ from: start, to: end });
    }

    hunks.forEach(function (h) {
      var oldFrom = null, newFrom = null, oldCount = 0, newCount = 0;
      for (var j = h.from; j <= h.to; j++) {
        var row = rows[j];
        if (row.oldLine !== null) { if (oldFrom === null) oldFrom = row.oldLine; oldCount++; }
        if (row.newLine !== null) { if (newFrom === null) newFrom = row.newLine; newCount++; }
      }
      h.oldStart = (oldFrom === null ? 0 : oldFrom) + 1;
      h.newStart = (newFrom === null ? 0 : newFrom) + 1;
      h.oldCount = oldCount;
      h.newCount = newCount;
      h.header = '@@ -' + h.oldStart + ',' + oldCount + ' +' + h.newStart + ',' + newCount + ' @@';
      h.section = sectionFor(curLines, newFrom === null ? 0 : newFrom);
    });

    return {
      rows: rows,
      hunks: hunks,
      added: added,
      removed: removed,
      oldTotal: baseLines.length,
      newTotal: curLines.length,
      identical: added === 0 && removed === 0
    };
  }

  global.MdPeekDiff = {
    unified: unified,
    diffRuns: diffRuns,
    wordMarks: wordMarks,
    escapeHtml: esc
  };

})(typeof window !== 'undefined' ? window : globalThis);
