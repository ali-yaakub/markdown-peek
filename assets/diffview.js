/* Markdown Peek - the unified diff view.
 *
 * Renders the row list from diff.js as GitHub renders a source diff: two line
 * number gutters, a marker column, full-width tinted rows, word-level marks
 * inside edited lines, and @@ headers over the regions that were collapsed.
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

  function lineRow(row) {
    var tr = document.createElement('tr');
    tr.className = 'dl dl-' + row.kind;

    tr.appendChild(cell('num num-old', row.oldLine === null ? '' : String(row.oldLine + 1)));
    tr.appendChild(cell('num num-new', row.newLine === null ? '' : String(row.newLine + 1)));
    tr.appendChild(cell('mark', MARK[row.kind]));

    var code = document.createElement('td');
    code.className = 'code';
    code.innerHTML = row.html === '' ? '&nbsp;' : row.html;
    tr.appendChild(code);

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
