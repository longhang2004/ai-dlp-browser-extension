import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "../ui/page.css";
import { App } from "./App.js";

const mountPoint = document.querySelector("#root");
if (!(mountPoint instanceof HTMLElement)) {
  throw new Error("Options mount point is unavailable.");
}

createRoot(mountPoint).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
