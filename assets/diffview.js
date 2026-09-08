/* Markdown Peek - the unified diff view.
 *
 * Renders the row list from diff.js as GitHub renders a source diff: two line
 * number gutters, a marker column, full-width tinted rows, word-level marks
 * inside edited lines, and @@ headers over the regions that were collapsed.
 *
 * Colour comes from the editor. Each character carries the lexer style index
 * Notepad++ gave it, and theme.js has already turned those indices into rules,
 * so the code reads exactly as it does in the editing pane.
 */
(function (global) {
  'use strict';

  var MARK = { add: '+', del: '−', ctx: '' };

  function cell(cls, text) {
    var td = document.createElement('td');
    td.className = cls;
    if (text !== undefined && text !== null) td.textContent = text;
    return td;
  }

  // Breaks the line wherever either the lexer style or the word-diff mark changes,
// and sets text through textContent, so nothing here can inject markup.
function codeCell(row) {
    var td = document.createElement('td');
    td.className = 'code';

    var text = row.text;
    if (!text.length) {
      td.appendChild(document.createTextNode(' '));
      return td;
    }

    var styles = row.styles;
    var mark = row.mark;
    var markClass = row.kind === 'del' ? ' wd' : ' wa';

    var i = 0;
    while (i < text.length) {
      var st = styles && i < styles.length ? styles[i] : 0;
      var mk = mark && i < mark.length ? mark[i] : 0;

      var j = i + 1;
      while (j < text.length) {
        var st2 = styles && j < styles.length ? styles[j] : 0;
        var mk2 = mark && j < mark.length ? mark[j] : 0;
        if (st2 !== st || mk2 !== mk) break;
        j++;
      }

      var span = document.createElement('span');
      span.className = 's' + st + (mk ? markClass : '');
      span.textContent = text.slice(i, j);
      td.appendChild(span);
      i = j;
    }
    return td;
  }

  function lineRow(row) {
    var tr = document.createElement('tr');
    tr.className = 'dl dl-' + row.kind;

    tr.appendChild(cell('num num-old', row.oldLine === null ? '' : String(row.oldLine + 1)));
    tr.appendChild(cell('num num-new', row.newLine === null ? '' : String(row.newLine + 1)));
    tr.appendChild(cell('mark', MARK[row.kind]));
    tr.appendChild(codeCell(row));

    // Only lines that still exist can be scrolled to or jumped into.
    if (row.newLine !== null) {
      tr.setAttribute('data-line', String(row.newLine));
      tr.setAttribute('data-endline', String(row.newLine + 1));
    }
    return tr;
  }

  // The bar over a collapsed region. Clicking it reveals what it hides, the way
  // GitHub's expander does, so context is available without leaving the panel.
  function gapRow(diff, from, to, hunk, onExpand) {
    var tr = document.createElement('tr');
    tr.className = 'dl dl-gap';

    var expander = document.createElement('td');
    expander.className = 'num gap-expand';
    expander.colSpan = 3;
    expander.title = 'Show ' + (to - from + 1) + ' hidden line' + (to - from ? 's' : '');
    expander.textContent = '↕';
    expander.addEventListener('click', function () { onExpand(from, to, tr); });
    tr.appendChild(expander);

    var head = document.createElement('td');
    head.className = 'code gap-head';
    head.textContent = hunk
      ? hunk.header + (hunk.section ? ' ' + hunk.section : '')
      : '⋯';
    tr.appendChild(head);

    // Anchor the collapsed span so scroll sync can interpolate across it.
    var firstNew = null;
    for (var i = from; i <= to; i++) {
      if (diff.rows[i].newLine !== null) { firstNew = diff.rows[i].newLine; break; }
    }
    if (firstNew !== null) {
      tr.setAttribute('data-line', String(firstNew));
      tr.setAttribute('data-endline', String(firstNew + 1));
    }
    return tr;
  }

  /**
   * @param {object} diff        Result of MdPeekDiff.unified.
   * @param {HTMLElement} target Container to fill.
   */
  function render(diff, target) {
    target.innerHTML = '';

    var table = document.createElement('table');
    table.className = 'diff-table';

    // Under table-layout:fixed the browser takes column widths from the first
    // row, and the first row here is a hunk header whose expander spans three
    // columns. A colgroup states the widths outright instead.
    var cols = document.createElement('colgroup');
    ['col-num', 'col-num', 'col-mark', 'col-code'].forEach(function (cls) {
      var c = document.createElement('col');
      c.className = cls;
      cols.appendChild(c);
    });
    table.appendChild(cols);

    var tbody = document.createElement('tbody');

    function expand(from, to, gapTr) {
      var frag = document.createDocumentFragment();
      for (var i = from; i <= to; i++) frag.appendChild(lineRow(diff.rows[i]));
      gapTr.parentNode.replaceChild(frag, gapTr);
      target.dispatchEvent(new CustomEvent('mdpeek:relayout', { bubbles: true }));
    }

    if (!diff.hunks.length) {
      table.appendChild(tbody);
      target.appendChild(table);

      var empty = document.createElement('p');
      empty.className = 'diff-empty';
      empty.textContent = diff.identical
        ? 'No changes.'
        : 'No differences to show.';
      target.appendChild(empty);
      return;
    }

    var cursor = 0;
    diff.hunks.forEach(function (h) {
      if (h.from > cursor) tbody.appendChild(gapRow(diff, cursor, h.from - 1, h, expand));
      else if (h.from === 0 && cursor === 0 && h.header) {
        var head = document.createElement('tr');
        head.className = 'dl dl-gap';
        var pad = document.createElement('td');
        pad.className = 'num gap-expand';
        pad.colSpan = 3;
        head.appendChild(pad);
        var text = document.createElement('td');
        text.className = 'code gap-head';
        text.textContent = h.header + (h.section ? ' ' + h.section : '');
        head.appendChild(text);
        tbody.appendChild(head);
      }

      for (var i = h.from; i <= h.to; i++) tbody.appendChild(lineRow(diff.rows[i]));
      cursor = h.to + 1;
    });

    if (cursor < diff.rows.length) {
      tbody.appendChild(gapRow(diff, cursor, diff.rows.length - 1, null, expand));
    }

    table.appendChild(tbody);
    target.appendChild(table);
  }

  global.MdPeekDiffView = { render: render };

})(window);
