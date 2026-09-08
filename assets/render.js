/* Markdown Peek - Markdown to HTML, with the source line carried through.
 *
 * Every block element leaves the renderer carrying data-line and data-endline.
 * Scroll sync reads those attributes to place the preview against the editor's
 * viewport. Nothing else in the plugin needs to know how Markdown parses.
 */
(function (global) {
  'use strict';

  var DOC_HOST = 'https://mdpeek.doc/';

  var md = global.markdownit({
    html: true,        // inline HTML is part of GFM; the page's CSP stops it running
    linkify: true,     // GFM extended autolinks
    breaks: false,
    typographer: false,
    langPrefix: 'language-'
  });

  /* --------------------------------------------------- source line map --- */

  md.core.ruler.push('mdpeek_lines', function (state) {
    var tokens = state.tokens;
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      if (!t.map || t.type === 'inline' || t.nesting < 0) continue;
      t.attrSet('data-line', String(t.map[0]));
      t.attrSet('data-endline', String(t.map[1]));
    }
    return true;
  });

  // Tokens rendered by a custom rule rather than renderToken drop their attrs on
  // the floor, so those three get wrapped in a carrier div instead.
  ['fence', 'code_block', 'html_block'].forEach(function (name) {
    var prev = md.renderer.rules[name];
    md.renderer.rules[name] = function (tokens, idx, opts, env, slf) {
      var out = prev
        ? prev(tokens, idx, opts, env, slf)
        : slf.renderToken(tokens, idx, opts);
      var t = tokens[idx];
      var line = t.attrGet ? t.attrGet('data-line') : null;
      if (line === null || line === undefined) return out;
      return '<div class="mdp-blk" data-line="' + line +
             '" data-endline="' + (t.attrGet('data-endline') || line) + '">' + out + '</div>';
    };
  });

  /* --------------------------------------------------------- task lists -- */

  // GFM task lists are an extension rather than core Markdown, and the whole of
  // the syntax that matters is a checkbox at the head of a list item.
  function applyTaskLists(root) {
    var items = root.querySelectorAll('li');
    for (var i = 0; i < items.length; i++) {
      var li = items[i];
      var first = li.firstElementChild && li.firstElementChild.tagName === 'P'
        ? li.firstElementChild
        : li;
      if (!first.firstChild || first.firstChild.nodeType !== 3) continue;

      var m = first.firstChild.nodeValue.match(/^\[([ xX])\]\s+/);
      if (!m) continue;

      first.firstChild.nodeValue = first.firstChild.nodeValue.slice(m[0].length);

      var box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = m[1] !== ' ';
      box.disabled = true;
      box.className = 'mdp-task';
      first.insertBefore(box, first.firstChild);
      li.classList.add('mdp-task-item');
    }
  }

  /* ----------------------------------------------------- relative paths -- */

  // Relative links resolve against the plugin's own asset host by default, which
  // is never what the document meant. Point them at the document's folder, which
  // the native side maps for exactly this purpose.
  function rewriteRelative(root) {
    function fix(nodes, attr) {
      for (var i = 0; i < nodes.length; i++) {
        var raw = nodes[i].getAttribute(attr);
        if (!raw) continue;
        if (/^([a-z]+:|\/\/|#)/i.test(raw)) continue;
        nodes[i].setAttribute(attr, DOC_HOST + raw.replace(/^\.\//, '').replace(/^\//, ''));
      }
    }
    fix(root.querySelectorAll('img[src]'), 'src');
    fix(root.querySelectorAll('a[href]'), 'href');
  }

  /* -------------------------------------------------------------- render - */

  /**
   * @param {string} source      Markdown to render.
   * @param {HTMLElement} target Container to fill.
   */
  function render(source, target) {
    target.innerHTML = md.render(source);
    applyTaskLists(target);
    rewriteRelative(target);
  }

  global.MdPeekRender = { render: render, md: md };

})(window);
