import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";
import "./i18n";
import { reloadOnceOnPreloadError } from "./lib/chunkReload";

// Registered before the first render so every lazy route chunk is covered.
window.addEventListener("vite:preloadError", reloadOnceOnPreloadError);
createRoot(document.getElementById("root")).render(<App />);
