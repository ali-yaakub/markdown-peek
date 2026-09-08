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

  function pushMode() {
    window.__mock.post({ t: 'mode', diff: diff, sync: sync, baselineSource: 'saved' });
  }

  function boot() {
    window.__mock.post({ t: 'theme', dark: dark });
    pushMode();
    window.__mock.post({ t: 'baseline', ok: true, source: 'saved', text: BASE });
    window.__mock.post({
      t: 'doc', path: 'C:\\work\\quarterly-review.md', text: CURRENT,
      markdown: true, tooBig: false, bytes: CURRENT.length, dirty: true
    });
    window.__mock.post({ t: 'view', first: 0, caret: 0, screen: 40, total: 34 });
  }

  document.getElementById('btn-diff').onclick = function () { diff = !diff; pushMode(); };
  document.getElementById('btn-dark').onclick = function () {
    dark = !dark; window.__mock.post({ t: 'theme', dark: dark });
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
