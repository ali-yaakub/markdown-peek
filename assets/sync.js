/* Markdown Peek - placing the preview against the editor's viewport.
 *
 * Proportional scrolling drifts the moment a document contains a code block, a
 * table or an image, because rendered height and source height stop agreeing.
 * This builds an index of source line to pixel offset from the data-line
 * attributes the renderer leaves behind, then interpolates between the two
 * entries that bracket the line the editor is showing.
 */
(function (global) {
  'use strict';

  var index = [];      // ascending [{line, top}]
  var container = null;

  function build(root, scroller) {
    container = scroller;
    index = [];

    var blocks = root.querySelectorAll('[data-line]');
    var base = root.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;

    for (var i = 0; i < blocks.length; i++) {
      var el = blocks[i];
      var line = parseInt(el.getAttribute('data-line'), 10);
      if (isNaN(line)) continue;

      var top = el.getBoundingClientRect().top - root.getBoundingClientRect().top + base;

      // Keep the first element that opens each line; nested blocks that share a
      // start line would otherwise push the offset down past their own content.
      if (index.length && index[index.length - 1].line === line) continue;
      if (index.length && line < index[index.length - 1].line) continue;

      index.push({ line: line, top: top });
    }

    index.push({ line: Number.MAX_SAFE_INTEGER, top: root.scrollHeight || scroller.scrollHeight });
  }

  // Pixel offset for a fractional source line, interpolated between neighbours.
  function offsetForLine(line) {
    if (!index.length) return 0;
    if (line <= index[0].line) return index[0].top;

    var lo = 0, hi = index.length - 1;
    while (lo < hi - 1) {
      var mid = (lo + hi) >> 1;
      if (index[mid].line <= line) lo = mid; else hi = mid;
    }

    var a = index[lo], b = index[hi];
    if (b.line === a.line || b.line === Number.MAX_SAFE_INTEGER) return a.top;

    var t = (line - a.line) / (b.line - a.line);
    return a.top + t * (b.top - a.top);
  }

  /**
   * @param {number} line   Source line the editor is showing (already mapped to
   *                        merged-document coordinates when diff mode is on).
   * @param {string} mode   'top' pins the line to the top edge; 'caret' keeps it
   *                        a third of the way down, which is where the eye sits.
   */
  function scrollTo(line, mode) {
    if (!container) return;

    var target = offsetForLine(line);
    if (mode === 'caret') target -= container.clientHeight / 3;
    else target -= 8;

    var max = container.scrollHeight - container.clientHeight;
    container.scrollTop = Math.max(0, Math.min(max, target));
  }

  // Nearest source line to a pixel offset, for jumping back into the editor.
  function lineAtOffset(top) {
    if (!index.length) return 0;
    for (var i = index.length - 1; i >= 0; i--) {
      if (index[i].top <= top && index[i].line !== Number.MAX_SAFE_INTEGER) return index[i].line;
    }
    return index[0].line;
  }

  global.MdPeekSync = { build: build, scrollTo: scrollTo, lineAtOffset: lineAtOffset };

})(window);
