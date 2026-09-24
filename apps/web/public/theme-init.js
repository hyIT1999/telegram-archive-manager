// Applies the saved theme before the app boots so the page never flashes the wrong one.
// Loaded as a blocking classic script from <head> (an external file keeps the CSP free of
// 'unsafe-inline'). Keep in sync with ThemeService: storage key 'tam-theme'; modes light | dark | system.
(function () {
  var mode = 'system';
  try {
    mode = localStorage.getItem('tam-theme') || 'system';
  } catch {
    // Storage can be blocked (privacy mode); fall back to the OS preference.
  }
  var dark =
    mode === 'dark' ||
    (mode !== 'light' &&
      !!window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
})();
