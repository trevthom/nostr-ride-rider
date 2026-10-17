// Puts the saved dark look on the page BEFORE it is first drawn, so a reload does not flash white.
// A plain script from the app's own files (the page's Content-Security-Policy allows no inline script).
// It reads the same saved choice as src/lib/appearance.js ("nostrride_dark").
try {
  if (JSON.parse(localStorage.getItem("nostrride_dark")) === true) {
    document.documentElement.classList.add("dark");
    var bar = document.querySelector('meta[name="theme-color"]');
    if (bar) bar.setAttribute("content", "#0a0a0a");
  }
} catch (e) { /* no saved choice, or storage is blocked: the light look stays */ }
