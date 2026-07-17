// 極簡 service worker：快取靜態外殼（HTML/CSS/JS/圖示），讓 App 重新開啟時秒開。
// 字典 API 與翻譯 API 一律直接連網路，絕不使用快取（確保查詢結果永遠是最新的）。

const CACHE_NAME = "vocab-static-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./config.js",
  "./app.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
        )
      )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = request.url;

  // 字典 / 翻譯 API：一律走網路，不快取，確保資料即時
  if (
    url.includes("api.dictionaryapi.dev") ||
    url.includes("api.mymemory.translated.net") ||
    url.includes("generativelanguage.googleapis.com")
  ) {
    event.respondWith(fetch(request));
    return;
  }

  // 導覽請求（開啟頁面本身）：優先網路，離線時退回快取
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("./index.html"))
    );
    return;
  }

  // 其他靜態資源：快取優先
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      });
    })
  );
});
