// Puts the saved dark looks on the page BEFORE it is first drawn, so a reload does not flash white.
// A plain script from the app's own files (the page's Content-Security-Policy allows no inline script).
// It reads the same saved choices as src/lib/appearance.js ("nostrride_dark" for the application, "nostrride_darkMap" for the map).
try {
  if (JSON.parse(localStorage.getItem("nostrride_dark")) === true) {
    document.documentElement.classList.add("dark");
    var bar = document.querySelector('meta[name="theme-color"]');
    if (bar) bar.setAttribute("content", "#0a0a0a");
  }
} catch (e) { /* no saved choice, or storage is blocked: the light look stays */ }
try {
  if (JSON.parse(localStorage.getItem("nostrride_darkMap")) === true) document.documentElement.classList.add("dark-map");
} catch (e) { /* the light map stays */ }
