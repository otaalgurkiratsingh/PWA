// Runs before first paint (loaded synchronously in <head>). Light is the default on first launch.
(function () {
  var pref = 'light';
  try {
    var saved = localStorage.getItem('rozana.theme');
    if (saved === 'dark' || saved === 'system' || saved === 'light') pref = saved;
  } catch (e) {
    // storage unavailable: stay light
  }
  var dark = pref === 'dark' || (pref === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
})();
