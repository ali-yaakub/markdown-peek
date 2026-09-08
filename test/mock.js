/* Stands in for the WebView2 host so the preview can be driven in a browser. */
(function () {
  'use strict';

  var listeners = [];

  window.__mock = {
    sent: [],
    post: function (obj) {
      var ev = { data: obj };
      listeners.forEach(function (fn) { fn(ev); });
    }
  };

  window.chrome = window.chrome || {};
  window.chrome.webview = {
    addEventListener: function (type, fn) { if (type === 'message') listeners.push(fn); },
    removeEventListener: function () {},
    postMessage: function (msg) {
      window.__mock.sent.push(msg);
      var log = document.getElementById('log');
      if (log) log.textContent = 'to host: ' + msg;
    }
  };
})();
