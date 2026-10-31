import ReactDOM from "react-dom/client";
import App from "./src/app/App.jsx";
import "./src/tailwind.css";
import "./src/index.css";
import { applyAppearance } from "./src/lib/appearance.js";
import { registerServiceWorker } from "./src/lib/notify.js";

// Mounts the app into the page. (This file sits in the app's own folder so the dev server can serve it; the app itself
// lives in src/app, with its two faces in src/rider and src/driver.)
// NOTE: React.StrictMode is intentionally NOT used here. In development
// StrictMode mounts every component twice, which makes Leaflet create
// and destroy each map twice and can crash the map. Leaving it off keeps
// the maps stable while you run `npm run dev`.
// Never run inside another site's frame: the app signs events and moves money on a tap, and a framed page can be covered by an
// invisible layer that turns a click on "Accept" into a click on something else. The built pages also carry a `frame-ancestors`
// header (csp.mjs); this is the guard for hosts that do not send it.
if (window.top !== window.self) {
  document.documentElement.innerHTML = '<body style="font-family:system-ui,sans-serif;padding:2rem">Open NostrRide in its own tab.</body>';
  throw new Error("NostrRide: refusing to run inside a frame");
}
registerServiceWorker();
applyAppearance(); // light or dark, as saved on this device
ReactDOM.createRoot(document.getElementById("root")).render(<App />);
