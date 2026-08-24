import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { installDemoApi } from "./demoApi";
import "./styles.css";

async function boot() {
  await installDemoApi();
  createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

boot().catch((error: unknown) => {
  const root = document.getElementById("root");
  if (!root) return;
  root.className = "boot-error";
  root.textContent = error instanceof Error
    ? error.message
    : "应用初始化失败，请刷新后重试。";
});
