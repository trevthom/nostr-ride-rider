import ReactDOM from "react-dom/client";
import Track from "./src/rider/Track.jsx";
import "./src/tailwind.css";
import "./src/index.css";
import { applyAppearance } from "./src/lib/appearance.js";

// The "follow a shared trip" page (opened from a link a rider sent).
applyAppearance(); // light or dark, as saved on this device
ReactDOM.createRoot(document.getElementById("root")).render(<Track />);
