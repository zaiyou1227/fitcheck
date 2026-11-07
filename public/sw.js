/* Service Worker：离线可用
   策略：
   - 导航请求（HTML）：网络优先，失败回退缓存 → 保证更新能拿到，断网也不白屏
   - 静态资源（css/js/图标）：缓存优先，后台更新 → 打开快、离线稳
   改版本号即可让老缓存失效。 */

const VERSION = "v1.0.0";
const CACHE = "dachu-" + VERSION;

const CORE = [
  "./",
  "./index.html",
  "./profile.html",
  "./pants.html",
  "./guide.html",
  "./share.html",
  "./css/app.css",
  "./js/data.js",
  "./js/app.js",
  "./js/vendor-lz-string.min.js",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      // 单个资源失败不应导致整体安装失败
      return Promise.all(
        CORE.map(function (url) {
          return cache.add(new Request(url, { cache: "reload" })).catch(function () {});
        })
      );
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE; })
            .map(function (k) { return caches.delete(k); })
      );
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  const req = event.request;

  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // HTML：网络优先
  const isNav = req.mode === "navigate" ||
                (req.headers.get("accept") || "").indexOf("text/html") >= 0;

  if (isNav) {
    event.respondWith(
      fetch(req).then(function (res) {
        const copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return res;
      }).catch(function () {
        return caches.match(req).then(function (hit) {
          return hit || caches.match("./index.html");
        });
      })
    );
    return;
  }

  // 静态资源：缓存优先 + 后台更新
  event.respondWith(
    caches.match(req).then(function (hit) {
      const network = fetch(req).then(function (res) {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return hit; });

      return hit || network;
    })
  );
});
