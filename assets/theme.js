/* Markdown Peek - applying Notepad++'s live styling to the diff view.
 *
 * The plugin sends whatever is in the editor's Scintilla style table. Nothing is
 * hard-coded here: change your Notepad++ theme, or edit a style in the Style
 * Configurator, and these rules are rewritten from the new values.
 */
(function (global) {
  'use strict';

  var sheet = null;

  function ensureSheet() {
    if (!sheet) {
      sheet = document.createElement('style');
      sheet.id = 'mdp-editor-theme';
      document.head.appendChild(sheet);
    }
    return sheet;
  }

  /**
   * @param {{font:string, size:number, styles:Object, defaultStyle:number,
   *          gutterStyle:number}} p Palette as sent by the plugin.
   * @param {number} zoom Scintilla's zoom level: points added to every font
   *   size, which is how Ctrl+scroll in the editor works. Applying the same
   *   offset here keeps the two panes at one size.
   */
  function apply(p, zoom) {
    if (!p || !p.styles) return;
    last = p;

    var base = p.size || 10;
    var size = Math.max(2, base + (zoom || 0));

    var def = p.styles[p.defaultStyle] || { f: '#000000', b: '#ffffff' };
    var gut = p.styles[p.gutterStyle] || def;
    var css = [];

    // Font and the two ground colours drive the whole diff surface.
    css.push(':root{');
    css.push('--ed-font:' + JSON.stringify(p.font || 'Consolas') + ',ui-monospace,Consolas,monospace;');
    css.push('--ed-size:' + size + 'pt;');
    // The preview has no point size of its own, so it takes the same ratio.
    css.push('--preview-scale:' + (size / base).toFixed(4) + ';');
    css.push('--ed-fg:' + def.f + ';');
    css.push('--ed-bg:' + def.b + ';');
    css.push('--ed-gutter-fg:' + gut.f + ';');
    css.push('--ed-gutter-bg:' + gut.b + ';');
    css.push('}');

    // One rule per lexer style. The editor's own colouring, reproduced.
    Object.keys(p.styles).forEach(function (id) {
      var s = p.styles[id];
      var decl = 'color:' + s.f + ';';
      if (s.o) decl += 'font-weight:700;';
      if (s.i) decl += 'font-style:italic;';
      // A style whose background matches the editor default adds nothing, and
      // painting it would cover the diff tint underneath.
      if (s.b && s.b.toLowerCase() !== def.b.toLowerCase()) decl += 'background:' + s.b + ';';
      css.push('.diff-table .s' + id + '{' + decl + '}');
    });

    ensureSheet().textContent = css.join('');
  }

  var last = null;

  // Re-apply the palette already held, at a new zoom level.
  function setZoom(zoom) {
    if (last) apply(last, zoom);
  }

  global.MdPeekTheme = { apply: apply, setZoom: setZoom };

})(window);
