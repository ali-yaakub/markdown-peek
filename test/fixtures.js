/* Drives the harness with a document that exercises every rendering path. */
(function () {
  'use strict';

  var BASE = [
    '# Quarterly Review',
    '',
    'Net revenues were higher year on year, primarily reflecting higher net',
    'revenues in Global Banking.',
    '',
    '## Expenses',
    '',
    'Operating expenses were essentially unchanged.',
    '',
    '| Segment | 2Q25 | 2Q26 |',
    '| --- | ---: | ---: |',
    '| Banking | 4,120 | 4,880 |',
    '| Markets | 3,310 | 3,290 |',
    '',
    '### Notes',
    '',
    '- Provision for credit losses fell',
    '- Headcount was flat',
    '- This line will be deleted entirely',
    '',
    '> The allowance ratio stood at 0.9% of total gross loans.',
    '',
    '```python',
    'rate = 0.041',
    'print(rate)',
    '```',
    '',
    'Tasks:',
    '',
    '- [x] Close the books',
    '- [ ] File the report',
    ''
  ].join('\n');

  var CURRENT = [
    '# Quarterly Review',
    '',
    'Net revenues were a record and significantly higher year on year, primarily',
    'reflecting significantly higher net revenues in Global Banking & Markets.',
    '',
    '## Expenses',
    '',
    'Operating expenses were slightly lower, driven by lower compensation.',
    '',
    '| Segment | 2Q25 | 2Q26 |',
    '| --- | ---: | ---: |',
    '| Banking | 4,120 | 4,880 |',
    '| Markets | 3,310 | 3,540 |',
    '| Asset Management | 1,900 | 2,180 |',
    '',
    '### Notes',
    '',
    '- Provision for credit losses fell',
    '- Headcount was slightly higher',
    '',
    '> The allowance ratio stood at 0.9% of total gross loans, at amortised cost.',
    '',
    '```python',
    'rate = 0.038',
    'print(rate)',
    '```',
    '',
    'Tasks:',
    '',
    '- [x] Close the books',
    '- [x] File the report',
    '- [ ] Brief the desk',
    '',
    'See the [methodology](notes/method.md) and ![chart](img/rates.png).',
    ''
  ].join('\n');

  var diff = false;
  var dark = false;
  var sync = 'top';

  // Stands in for what the plugin reads out of Notepad++'s Scintilla style
  // table. Indices follow Lexilla's markdown lexer.
  function palette(isDark) {
    var fg = isDark ? '#d4d4d4' : '#000000';
    var bg = isDark ? '#1e1e1e' : '#ffffff';
    var s = {};
    function put(id, f, o, i) { s[id] = { f: f, b: bg, o: o ? 1 : 0, i: i ? 1 : 0 }; }
    for (var n = 0; n <= 40; n++) put(n, fg, 0, 0);
    put(2, isDark ? '#dcdcaa' : '#8b0000', 1, 0);   // strong
    put(3, isDark ? '#dcdcaa' : '#8b0000', 1, 0);
    put(4, isDark ? '#c586c0' : '#7a3e9d', 0, 1);   // emphasis
    put(5, isDark ? '#c586c0' : '#7a3e9d', 0, 1);
    for (var h = 6; h <= 11; h++) put(h, isDark ? '#569cd6' : '#0000c0', 1, 0);
    put(13, isDark ? '#4ec9b0' : '#008080', 0, 0);  // unordered list item
    put(14, isDark ? '#4ec9b0' : '#008080', 0, 0);  // ordered list item
    put(15, isDark ? '#6a9955' : '#008000', 0, 1);  // blockquote
    put(17, isDark ? '#808080' : '#808080', 0, 0);  // horizontal rule
    put(18, isDark ? '#4fc1ff' : '#0645ad', 0, 0);  // link
    put(19, isDark ? '#ce9178' : '#a31515', 0, 0);  // code
    put(20, isDark ? '#ce9178' : '#a31515', 0, 0);
    put(21, isDark ? '#ce9178' : '#a31515', 0, 0);  // code block
    s[32] = { f: fg, b: bg, o: 0, i: 0 };                                  // default
    s[33] = { f: isDark ? '#858585' : '#5a5a5a',
              b: isDark ? '#252526' : '#f0f0f0', o: 0, i: 0 };             // line numbers
    return { font: 'Consolas', size: 10, styles: s, defaultStyle: 32, gutterStyle: 33 };
  }

  // A stand-in for the lexer: enough structure to show the colouring working.
  function runsFor(text) {
    var fence = false;
    return text.split('\n').map(function (line) {
      var style = 0;
      var m;
      if (/^\s{0,3}(```|~~~)/.test(line)) { style = 21; fence = !fence; }
      else if (fence) style = 21;
      else if ((m = line.match(/^\s{0,3}(#{1,6})\s/))) style = 5 + m[1].length;
      else if (/^\s{0,3}>/.test(line)) style = 15;
      else if (/^\s{0,3}[-*+]\s/.test(line)) style = 13;
      else if (/^\s{0,3}\d+[.)]\s/.test(line)) style = 14;
      else if (/^\s{0,3}\|/.test(line)) style = 19;
      return line.length ? style + ':' + line.length : '';
    }).join('|');
  }

  function pushMode() {
    window.__mock.post({ t: 'mode', diff: diff, sync: sync, baselineSource: 'saved' });
  }

  function boot() {
    window.__mock.post({ t: 'theme', dark: dark, editor: palette(dark) });
    pushMode();
    window.__mock.post({
      t: 'baseline', ok: true, source: 'saved', text: BASE, runs: runsFor(BASE)
    });
    window.__mock.post({
      t: 'doc', path: 'C:\\work\\quarterly-review.md', text: CURRENT,
      markdown: true, tooBig: false, bytes: CURRENT.length, dirty: true,
      runs: runsFor(CURRENT)
    });
    window.__mock.post({ t: 'view', first: 0, caret: 0, screen: 40, total: 34 });
  }

  document.getElementById('btn-diff').onclick = function () { diff = !diff; pushMode(); };
  document.getElementById('btn-dark').onclick = function () {
    dark = !dark;
    window.__mock.post({ t: 'theme', dark: dark, editor: palette(dark) });
  };
  document.getElementById('btn-caret').onclick = function () {
    sync = sync === 'top' ? 'caret' : 'top'; pushMode();
    document.getElementById('log').textContent = 'sync: ' + sync;
  };
  document.getElementById('btn-scroll').onclick = function () {
    window.__mock.post({ t: 'view', first: 22, caret: 24, screen: 40, total: 34 });
  };

  boot();
})();
