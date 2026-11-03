import ReactDOM from "react-dom/client";
import Track from "./src/rider/Track.jsx";
import "./src/tailwind.css";
import "./src/index.css";
import { applyAppearance } from "./src/lib/appearance.js";

// The "follow a shared trip" page (opened from a link a rider sent).
// Never run inside another site's frame, the same guard main.jsx uses (a host that ignores `_headers` would
// otherwise let a link be framed invisibly behind someone else's page).
if (window.top !== window.self) {
  document.body.textContent = "Open NostrRide in its own tab.";
  document.body.style.cssText = "font-family:system-ui,sans-serif;padding:2rem";
  throw new Error("NostrRide: refusing to run inside a frame");
}
applyAppearance(); // light or dark, as saved on this device
ReactDOM.createRoot(document.getElementById("root")).render(<Track />);
