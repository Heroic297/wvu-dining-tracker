import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

if (!window.location.hash) {
  window.location.hash = "#/";
}

// Apply dark mode by default (matches Layout.tsx initial state)
document.documentElement.classList.add("dark");

createRoot(document.getElementById("root")!).render(<App />);
