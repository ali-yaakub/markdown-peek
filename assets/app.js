/* Markdown Peek - the bridge between Notepad++ and the panel.
 *
 * The native plugin posts JSON describing the document, the viewport, the theme
 * and the diff baseline. Everything below decides what to do about it. Edit this
 * file, then run Plugins > Markdown Peek > Reload Preview Assets; no rebuild.
 */
(function () {
  'use strict';

  var host = (window.chrome && window.chrome.webview) || null;

  var el = {
    content: document.getElementById('content'),
    scroller: document.getElementById('scroller'),
    title: document.getElementById('title'),
    counts: document.getElementById('counts'),
    notice: document.getElementById('notice')
  };

  var state = {
    path: '',
    text: '',
    markdown: true,
    tooBig: false,
    bytes: 0,
    runs: '',
    baseline: { ok: false, text: '', source: 'saved', runs: '' },
    editor: null,
    zoom: 0,
    mode: { diff: false, sync: 'top', baselineSource: 'saved', fit: true },
    view: { first: 0, caret: 0, screen: 40, total: 1, disp: 0 },
    renderedKey: null
  };

  function send(msg) {
    if (host) host.postMessage(msg);
  }

  function say(text) {
    if (!text) { el.notice.hidden = true; return; }
    el.notice.textContent = text;
    el.notice.hidden = false;
  }

  /* ------------------------------------------------------------- render -- */

  function renderPreview() {
    window.MdPeekRender.render(state.text, el.content);
    el.counts.hidden = true;
    el.counts.textContent = '';
  }

  function renderDiff() {
    if (!state.baseline.ok) {
      renderPreview();
      say(state.mode.baselineSource === 'git'
        ? 'No git baseline for this file. It may be uncommitted, or outside a repository. Showing the preview instead.'
        : 'No saved copy on disk to compare against yet. Showing the preview instead.');
      return;
    }

    var diff = window.MdPeekDiff.unified(state.baseline.text, state.text, {
      context: 3,
      baseRuns: state.baseline.runs,
      curRuns: state.runs
    });
    window.MdPeekDiffView.render(diff, el.content);

    el.counts.textContent = '+' + diff.added + '  −' + diff.removed +
                            '  vs ' + (state.mode.baselineSource === 'git' ? 'git HEAD' : 'last save');
    el.counts.hidden = false;
  }

  function renderNow() {
    if (!state.markdown) {
      el.content.innerHTML = '';
      el.counts.hidden = true;
      say('Not a Markdown file. Add its extension to MarkdownPeek.ini to preview it.');
      return;
    }
    if (state.tooBig) {
      el.content.innerHTML = '';
      el.counts.hidden = true;
      say('Document is ' + Math.round(state.bytes / 1024) + ' KiB, above the preview limit. ' +
          'Raise maxKiB in MarkdownPeek.ini to render it.');
      return;
    }

    say('');
    document.body.classList.toggle('diff', state.mode.diff);
    // The diff is a source view. Letting it keep markdown-body would hand it the
    // prose table rules, which size a table to its content rather than the panel.
    el.content.classList.toggle('markdown-body', !state.mode.diff);

    if (state.mode.diff) renderDiff();
    else renderPreview();

    // Before the index is built, not after: the offsets it records are pixels,
    // and the fit scale moves every one of them.
    applyFit();
    window.MdPeekSync.build(el.content, el.scroller);
    applyViewport();
  }

  // Re-rendering identical output only throws away the scroll position.
  // Style runs belong in the key: restyling in the Style Configurator changes
  // nothing about the text, but everything about how the diff should look.
  function renderKey() {
    var sep = ' | ';
    return (state.mode.diff ? 'd' : 'p') + sep +
           (state.mode.diff ? state.baseline.text + sep + state.baseline.runs : '') + sep +
           state.text + sep +
           (state.mode.diff ? state.runs : '');
  }

  var pending = false;
  function scheduleRender(force) {
    if (force) state.renderedKey = null;
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () {
      pending = false;
      var key = renderKey();
      if (key === state.renderedKey) { applyViewport(); return; }
      state.renderedKey = key;
      renderNow();
    });
  }

  /* ---------------------------------------------------------------- fit -- */

  /* The two panes disagree about how much document a screen holds. Proportional
   * 14px text with a blank line between blocks is taller than the same source
   * as wrapped monospace, so pinning the top line lines up the top line and
   * nothing else: by the foot of the panel the editor is three sections ahead.
   *
   * This measures both densities and scales the preview until a screenful of
   * editor is a screenful of preview. The scale belongs to the document and the
   * window rather than the scroll position, so it is recomputed when one of
   * those changes and left alone in between. Scaling the column rewraps its
   * text, which changes the height that was just measured, so the answer is
   * iterated rather than solved.
   */
  var FIT_MIN = 0.55;      // a document of images would otherwise vanish
  var FIT_MAX = 1.15;
  var FIT_TOL = 0.004;       // a pass that moves the scale less than this is done
  var FIT_RATIO_TOL = 0.01;  // and so are two panes within 1% of each other
  var FIT_PASSES = 8;
  var FIT_POWER_GUESS = 1.5;  // until two passes have measured the real one
  var FIT_FLOOR_SCREENS = 1.5;

  var fit = 1;
  var fitKey = '';

  function setFit(k) {
    fit = k;
    if (k === 1) {
      el.content.style.zoom = '';
      return;
    }
    // zoom, not font-size: the block margins and paddings are in pixels, and a
    // font-only scale would leave the gaps between paragraphs at full size.
    // The column carries no width of its own, so it fills the panel whatever
    // the scale is; only the text inside it gets smaller.
    el.content.style.zoom = k.toFixed(4);
  }

  function clampFit(k) {
    if (!isFinite(k) || k <= 0) return 1;
    return Math.min(FIT_MAX, Math.max(FIT_MIN, Math.round(k * 1000) / 1000));
  }

  // The rendered document's own height, in the scroller's pixels. Measured off
  // the blocks rather than the element, whose padding carries a 60vh tail.
  function renderedHeight() {
    var first = el.content.firstElementChild;
    var last = el.content.lastElementChild;
    if (!first || !last) return 0;
    return last.getBoundingClientRect().bottom - first.getBoundingClientRect().top;
  }

  function applyFit() {
    // The diff is a source view, line for line against the editor at the
    // editor's own font. Scaling it would undo the thing it is for.
    if (!state.mode.fit || state.mode.diff || !state.markdown || state.tooBig) {
      if (fit !== 1) setFit(1);
      return;
    }

    if (!(state.view.screen > 0) || !(state.view.disp > 0)) return;
    var screens = state.view.disp / state.view.screen;

    // A document that fits on one screen has no bottom edge to disagree about,
    // and its ratio is decided by whichever pane has the larger margins. Left
    // at its natural size, a short note reads as a short note.
    if (screens < FIT_FLOOR_SCREENS ||
        renderedHeight() < FIT_FLOOR_SCREENS * el.scroller.clientHeight) {
      if (fit !== 1) setFit(1);
      return;
    }

    // The answer is somewhere in here, and every measurement narrows it: the
    // preview's height only rises with the scale, so a pane that is too tall
    // puts a ceiling on the answer and one that is too short puts a floor
    // under it. The step below is fast but can be wrong; the bracket is slow
    // but cannot be, so a step that leaves the bracket is replaced by a
    // bisection of it. Together they converge on any content.
    var lo = FIT_MIN;
    var hi = FIT_MAX;
    var prevFit = 0;
    var prevHeight = 0;
    var trail = window.MDPEEK_TRACE ? [] : null;

    for (var pass = 0; pass < FIT_PASSES; pass++) {
      var height = renderedHeight();
      var viewport = el.scroller.clientHeight;
      if (height <= 0 || viewport <= 0) return;

      var ratio = (screens * viewport) / height;
      if (Math.abs(1 - ratio) < FIT_RATIO_TOL) break;   // the panes agree

      if (ratio < 1) hi = Math.min(hi, fit);
      else lo = Math.max(lo, fit);

      // Height is a step function, not a curve: every paragraph loses a line at
      // its own scale, and a document of repeated text loses all of them at
      // once. When the bracket has closed on such a step there is no scale that
      // hits the target, and the closer of the two sides is the answer.
      if (hi - lo < FIT_TOL * 2) break;

      // How hard the height answers a change in scale. Text that only shrinks
      // gives an exponent of 1; text that also gains words per line, and so
      // loses rows, approaches 2. Assuming either one makes the passes
      // overshoot and swing, so it is measured from the last two of them.
      var power = FIT_POWER_GUESS;
      if (prevFit > 0 && prevHeight > 0 && Math.abs(Math.log(fit / prevFit)) > 1e-4) {
        power = Math.log(height / prevHeight) / Math.log(fit / prevFit);
        if (!isFinite(power) || power < 0.4) power = 0.4;
        else if (power > 3) power = 3;
      }

      var step = fit * Math.pow(ratio, 1 / power);
      var next = clampFit(step > lo && step < hi ? step : (lo + hi) / 2);
      if (trail) {
        trail.push(fit.toFixed(3) + '>' + next.toFixed(3) +
                   ' r=' + ratio.toFixed(3) + ' p=' + power.toFixed(2) +
                   ' [' + lo.toFixed(2) + ',' + hi.toFixed(2) + ']');
      }
      if (Math.abs(next - fit) < FIT_TOL) break;       // pinned by a bound

      prevFit = fit;
      prevHeight = height;
      setFit(next);
    }

    if (window.MDPEEK_TRACE) {
      send('log:fit ' + fit + ' editorScreens=' + screens.toFixed(2) +
           ' previewScreens=' + (renderedHeight() / el.scroller.clientHeight).toFixed(2) +
           ' panel=' + el.scroller.clientWidth + 'x' + el.scroller.clientHeight +
           (trail && trail.length ? ' | ' + trail.join(' | ') : ''));
    }
  }

  // Re-fit, and rebuild the index if the scale moved. Returns whether it did.
  function refit() {
    var before = fit;
    applyFit();
    if (fit === before) return false;
    window.MdPeekSync.build(el.content, el.scroller);
    return true;
  }

  /* ----------------------------------------------------------- viewport -- */

  function applyViewport() {
    var line = state.mode.sync === 'caret' ? state.view.caret : state.view.first;

    // Mark the scroll as ours, so the listener below does not read it back as
    // the user scrolling and send the editor chasing after it.
    ours = Date.now() + OURS_MS;
    window.MdPeekSync.scrollTo(line, state.mode.sync);
    highlightCaret();

    if (window.MDPEEK_TRACE) {
      var d = window.MdPeekSync.debug();
      send('log:view line=' + line + ' entries=' + d.entries +
           ' first=' + d.first + ' last=' + d.last +
           ' want=' + Math.round(d.lastTarget) +
           ' scrollTop=' + Math.round(d.scrollTop) +
           ' scrollH=' + d.scrollHeight + ' clientH=' + d.clientHeight);
    }
  }

  var caretEl = null;
  function highlightCaret() {
    if (caretEl) { caretEl.classList.remove('mdp-caret'); caretEl = null; }

    var target = state.view.caret;
    var blocks = el.content.querySelectorAll('[data-line]');
    var best = null;

    for (var i = 0; i < blocks.length; i++) {
      var from = parseInt(blocks[i].getAttribute('data-line'), 10);
      var to = parseInt(blocks[i].getAttribute('data-endline'), 10);
      if (isNaN(from)) continue;
      if (target >= from && target < (isNaN(to) ? from + 1 : to)) best = blocks[i];
    }
    if (best) { best.classList.add('mdp-caret'); caretEl = best; }
  }

  /* ------------------------------------------------------------- inbound -- */

  function onMessage(ev) {
    var m = ev.data;
    if (!m || !m.t) return;

    switch (m.t) {
      case 'doc':
        state.path = m.path;
        state.text = m.text || '';
        state.runs = m.runs || '';
        state.markdown = !!m.markdown;
        state.tooBig = !!m.tooBig;
        state.bytes = m.bytes || 0;
        el.title.textContent = m.path ? m.path.split('\\').pop() : 'Untitled';
        el.title.title = m.path || '';
        document.body.classList.toggle('dirty', !!m.dirty);
        scheduleRender();
        break;

      case 'baseline':
        state.baseline = { ok: !!m.ok, text: m.text || '', source: m.source, runs: m.runs || '' };
        scheduleRender(true);
        break;

      case 'mode':
        state.mode = {
          diff: !!m.diff,
          sync: m.sync || 'top',
          baselineSource: m.baselineSource || 'saved',
          fit: m.fit !== false
        };
        scheduleRender(true);
        break;

      case 'theme':
        document.body.classList.toggle('dark', !!m.dark);
        if (typeof m.zoom === 'number') state.zoom = m.zoom;
        if (m.editor) {
          state.editor = m.editor;
          window.MdPeekTheme.apply(m.editor, state.zoom);
        }
        break;

      case 'zoom':
        state.zoom = m.zoom | 0;
        window.MdPeekTheme.setZoom(state.zoom);
        // Every rendered height just changed, so the scroll index is stale.
        // Both panes moved, so the fit between them holds; re-measure anyway,
        // because the editor's line height and the preview's do not track the
        // same steps.
        applyFit();
        window.MdPeekSync.build(el.content, el.scroller);
        applyViewport();
        break;

      case 'view':
        state.view = {
          first: Number(m.first) || 0,
          caret: m.caret | 0,
          screen: m.screen | 0,
          total: m.total | 0,
          disp: m.disp | 0
        };

        // Wrapping changed, or the editor pane was resized, so the two
        // densities have to be measured against each other again. Neither
        // figure moves while the wheel is turning, so this costs nothing on
        // the scroll path.
        var key = state.view.screen + 'x' + state.view.disp;
        if (key !== fitKey) { fitKey = key; refit(); }

        // While the user is scrolling the preview, the editor is following it.
        // Applying its position back here would fight them for the scrollbar.
        if (Date.now() < theirs) break;

        // The editor lands on a whole line and reports it back. That echo of
        // our own goto would drag the preview onto the line boundary, which
        // reads as a snap under the cursor.
        if (sentLine >= 0 && Math.floor(state.view.first) === sentLine) {
          highlightCaret();
          break;
        }
        sentLine = -1;

        applyViewport();
        break;

      default:
        break;
    }
  }

  if (host) host.addEventListener('message', onMessage);

  /* --------------------------------------------------- reverse scrolling -- */

  // Two panes that each follow the other will chase each other forever. Each
  // side claims the scrollbar for a moment after it moves it, and the other
  // stands back for that long.
  var OURS_MS = 250;      // how long a programmatic scroll stays "ours"
  var THEIRS_MS = 400;    // how long the user keeps the scrollbar after touching it
  var ours = 0;
  var theirs = 0;
  var sentLine = -1;
  var queued = false;

  el.scroller.addEventListener('scroll', function () {
    if (Date.now() < ours) return;        // this scroll came from the editor
    theirs = Date.now() + THEIRS_MS;

    if (queued) return;
    queued = true;
    requestAnimationFrame(function () {
      queued = false;
      var line = Math.round(window.MdPeekSync.lineAtOffset(el.scroller.scrollTop + 8));
      if (line === sentLine || line < 0) return;
      sentLine = line;
      send('goto:' + line);
    });
  }, { passive: true });

  /* ------------------------------------------------------- interactions -- */

  // Double-clicking a block, or a diff row, puts the editor caret on the line
  // that produced it. Deleted lines carry no current line and are inert.
  el.content.addEventListener('dblclick', function (e) {
    var node = e.target;
    while (node && node !== el.content && !(node.getAttribute && node.hasAttribute('data-line'))) {
      node = node.parentElement;
    }
    if (!node || node === el.content) return;

    var line = parseInt(node.getAttribute('data-line'), 10);
    if (!isNaN(line)) send('goto:' + line);
  });

  // Expanding a collapsed hunk changes every offset below it.
  el.content.addEventListener('mdpeek:relayout', function () {
    window.MdPeekSync.build(el.content, el.scroller);
  });

  window.addEventListener('resize', function () {
    applyFit();
    window.MdPeekSync.build(el.content, el.scroller);
    applyViewport();
  });

  send('ready');
})();
