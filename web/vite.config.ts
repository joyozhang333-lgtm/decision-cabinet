import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiProxyTarget = process.env.VITE_API_PROXY_TARGET ?? "http://127.0.0.1:8000";

export default defineConfig(({ mode }) => {
  const demoMode = mode === "demo";

  return {
    base: demoMode ? "/decision-cabinet/demo/" : "/",
    plugins: [
      react(),
      ...(demoMode ? [{
        name: "decision-cabinet-demo-seo",
        transformIndexHtml() {
          return {
            tags: [
              { tag: "link", attrs: { rel: "canonical", href: "https://joyozhang333-lgtm.github.io/decision-cabinet/demo/" }, injectTo: "head" },
              { tag: "link", attrs: { rel: "alternate", hreflang: "zh-CN", href: "https://joyozhang333-lgtm.github.io/decision-cabinet/demo/" }, injectTo: "head" },
              { tag: "meta", attrs: { property: "og:url", content: "https://joyozhang333-lgtm.github.io/decision-cabinet/demo/" }, injectTo: "head" },
              { tag: "meta", attrs: { property: "og:image", content: "https://joyozhang333-lgtm.github.io/decision-cabinet/social-preview.png" }, injectTo: "head" },
              { tag: "meta", attrs: { name: "twitter:image", content: "https://joyozhang333-lgtm.github.io/decision-cabinet/social-preview.png" }, injectTo: "head" },
              {
                tag: "script",
                attrs: { type: "application/ld+json" },
                children: JSON.stringify({
                  "@context": "https://schema.org",
                  "@type": "SoftwareApplication",
                  name: "决策内阁 · Decision Cabinet",
                  applicationCategory: "BusinessApplication",
                  operatingSystem: "Web",
                  softwareVersion: "0.3.0",
                  url: "https://joyozhang333-lgtm.github.io/decision-cabinet/demo/",
                  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
                  description: "开源 AI 决策支持系统在线演示，帮助用户看清事实、选择、代价、风险与局势演化。",
                }),
                injectTo: "head",
              },
            ],
          };
        },
      }] : []),
    ],
    server: {
      port: 5173,
      proxy: {
        "/api": apiProxyTarget,
      },
    },
  };
});
