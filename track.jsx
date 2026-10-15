import ReactDOM from "react-dom/client";
import Track from "./src/rider/Track.jsx";
import "./src/tailwind.css";
import "./src/index.css";

// The "follow a shared trip" page (opened from a link a rider sent).
ReactDOM.createRoot(document.getElementById("root")).render(<Track />);
