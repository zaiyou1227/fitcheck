/* 批量比对页测试：解析、匹配、排序、书签采集 */
const fs = require("fs");
const path = require("path");
const http = require("http");
const { JSDOM } = require("jsdom");

const PUB = path.join(__dirname, "..", "public");
const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".webmanifest": "application/manifest+json",
  ".png": "image/png", ".svg": "image/svg+xml"
};
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  const f = path.join(PUB, p);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" });
  res.end(fs.readFileSync(f));
});

let fails = 0, passes = 0;
function check(label, cond, extra) {
  if (cond) { passes++; console.log("PASS  " + label); }
  else { fails++; console.log("FAIL  " + label + (extra !== undefined ? "  -> " + extra : "")); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

function makeStorage(seed) {
  const map = new Map();
  if (seed) map.set("dachu.v1", JSON.stringify(seed));
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(String(k), String(v)); },
    removeItem: k => { map.delete(k); },
    clear: () => map.clear(),
    key: () => null,
    get length() { return map.size; },
    _map: map
  };
}

async function loadPage(base, file, store) {
  const html = fs.readFileSync(path.join(PUB, file), "utf8");
  const errors = [];
  const dom = new JSDOM(html, {
    runScripts: "dangerously", resources: "usable",
    url: base + "/" + file, pretendToBeVisual: true,
    beforeParse(window) {
      Object.defineProperty(window, "localStorage", { value: store, configurable: true });
      window.addEventListener("error", e => errors.push(e.message));
      window.HTMLElement.prototype.scrollIntoView = function () {};
      window.confirm = () => true;
      Object.defineProperty(window.navigator, "clipboard", {
        value: { writeText: () => Promise.resolve() }, configurable: true
      });
      window.document.execCommand = () => true;
      window.fetch = () => Promise.reject(new Error("blocked"));
    }
  });
  for (let i = 0; i < 120; i++) {
    if (dom.window.SizeParse && dom.window.DachuData && dom.window.document.querySelector(".nav")) break;
    await sleep(30);
  }
  return { window: dom.window, document: dom.window.document, errors, dom };
}

// 300 斤体型
const bigProfile = {
  schema: 1, units: { len: "cm", wt: "kg" }, prefs: { fabric: "none" },
  items: {
    waist: { v: 125, u: "cm" }, belly: { v: 138, u: "cm" }, hip: { v: 148, u: "cm" },
    thigh: { v: 85, u: "cm" }, rise: { v: 32, u: "cm" },
    chest: { v: 130, u: "cm" }, shoulder: { v: 56, u: "cm" },
    outseam: { v: 105, u: "cm" }
  },
  guide: {}
};
// 普通体型（验证"不只服务大码"）
const normalProfile = {
  schema: 1, units: { len: "cm", wt: "kg" }, prefs: { fabric: "none" },
  items: {
    waist: { v: 78, u: "cm" }, belly: { v: 82, u: "cm" }, hip: { v: 96, u: "cm" },
    thigh: { v: 56, u: "cm" }, rise: { v: 26, u: "cm" },
    chest: { v: 92, u: "cm" }, shoulder: { v: 44, u: "cm" },
    outseam: { v: 98, u: "cm" }
  },
  guide: {}
};

const PANTS_A = "尺码\t裤长\t腰围\t臀围\t大腿围\t后裆\n3XL\t100\t116\t126\t72\t36\n4XL\t102\t124\t134\t78\t38\n5XL\t104\t132\t142\t84\t40";
const PANTS_B = "尺码\t裤长\t腰围\t臀围\t大腿围\t后裆\n6XL\t106\t140\t152\t92\t44\n7XL\t108\t148\t160\t98\t46";
const TOP_C = "尺码\t胸围\t肩宽\t衣长\nL\t104\t45\t70\nXL\t112\t47\t72\n2XL\t124\t50\t74";

async function main() {
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const BASE = "http://127.0.0.1:" + server.address().port;
  console.log("server: " + BASE);

  // ============================================================
  console.log("\n=== 1. 页面加载 ===");
  {
    const store = makeStorage(bigProfile);
    const { window, document, errors } = await loadPage(BASE, "compare.html", store);
    check("无脚本错误", errors.length === 0, errors.join("; "));
    check("引擎已加载", !!window.SizeParse);
    check("五个导航项", document.querySelectorAll(".nav a").length === 5,
      String(document.querySelectorAll(".nav a").length));
    check("身体摘要有内容", document.getElementById("bodySummary").textContent.includes("腹围"));
    check("初始无结果", document.getElementById("results").textContent.includes("还没有商品"));
    check("三个输入页签", document.querySelectorAll(".tabs button[data-tab]").length === 3);

    // 解析两个商品
    document.getElementById("htmlInput").value = PANTS_A + "\n---\n" + PANTS_B;
    document.querySelector("#parseBtn").click();
    await sleep(100);

    const txt = document.getElementById("results").textContent;
    check("结果出现 2 个商品", document.getElementById("countTag").textContent.includes("2 个商品"),
      document.getElementById("countTag").textContent);
    check("有商品卡片", document.querySelectorAll(".result").length === 2,
      String(document.querySelectorAll(".result").length));
    check("有尺码徽标", document.querySelectorAll(".fit").length > 0);
    check("第一个标了 best", document.querySelector(".result").classList.contains("best"),
      document.querySelector(".result").className);

    // 300 斤 → B（6XL）应该排第一
    const first = document.querySelector(".result h3").textContent;
    console.log("    第一名: " + first);
    check("第一名是可穿的那个商品", /很合适|可以穿/.test(first), first);

    // 展开明细
    const toggle = document.querySelector("[data-toggle]");
    check("有「看每项差多少」按钮", !!toggle);
    if (toggle) {
      toggle.click();
      await sleep(50);
      const detail = document.querySelector(".detail.on");
      check("明细展开", !!detail);
      check("明细列出部位", detail && /腹围|腰围|大腿围|后裆/.test(detail.textContent),
        detail ? detail.textContent.slice(0, 60) : "");
    }
  }

  // ============================================================
  console.log("\n=== 2. 普通体型：同一批商品结论反过来 ===");
  {
    const store = makeStorage(normalProfile);
    const { document, errors } = await loadPage(BASE, "compare.html", store);
    check("无脚本错误", errors.length === 0, errors.join("; "));

    document.getElementById("htmlInput").value = PANTS_A;
    document.querySelector("#parseBtn").click();
    await sleep(100);

    const cards = Array.from(document.querySelectorAll(".result"));
    check("有结果卡片", cards.length === 1, String(cards.length));
    const badge = document.querySelector(".result .badge");
    console.log("    普通体型结论: " + (badge ? badge.textContent : "-"));
    check("普通体型不该判「很合适」", !badge || badge.textContent !== "很合适",
      badge ? badge.textContent : "无");
    check("普通体型应判偏大/穿不下",
      !badge || /偏大|穿不下|偏紧/.test(badge.textContent),
      badge ? badge.textContent : "无");
  }

  // ============================================================
  console.log("\n=== 3. 上衣也能比对 ===");
  {
    const store = makeStorage(bigProfile);
    const { document } = await loadPage(BASE, "compare.html", store);
    document.getElementById("htmlInput").value = TOP_C;
    document.querySelector("#parseBtn").click();
    await sleep(100);
    const badge = document.querySelector(".result .badge");
    const txt = document.getElementById("results").textContent;
    console.log("    上衣结论: " + (badge ? badge.textContent : "-"));
    check("识别为上衣品类", txt.includes("上衣"), txt.slice(0, 80));
    check("300斤穿 2XL 上衣应穿不下或偏紧",
      !badge || /穿不下|偏紧/.test(badge.textContent), badge ? badge.textContent : "无");
  }

  // ============================================================
  console.log("\n=== 4. 无身体数据时给提示 ===");
  {
    const store = makeStorage({ schema: 1, units: { len: "cm", wt: "kg" }, items: {}, guide: {} });
    const { document } = await loadPage(BASE, "compare.html", store);
    check("提示去录数据", document.getElementById("bodySummary").textContent.includes("还没录身体数据"));
    document.getElementById("htmlInput").value = PANTS_A;
    document.querySelector("#parseBtn").click();
    await sleep(100);
    check("结果区提示先录数据",
      document.getElementById("results").textContent.includes("先去「尺码档案」"),
      document.getElementById("results").textContent.slice(0, 60));
  }

  // ============================================================
  console.log("\n=== 5. 书签采集（postMessage）===");
  {
    const store = makeStorage(bigProfile);
    const { window, document } = await loadPage(BASE, "compare.html", store);
    window.postMessage({
      type: "DACHU_TABLE",
      title: "测试品牌加肥加大休闲裤",
      text: PANTS_B,
      url: "https://example.com/p/1"
    }, "*");
    await sleep(150);
    const txt = document.getElementById("results").textContent;
    check("采集后有结果", document.querySelectorAll(".result").length === 1,
      String(document.querySelectorAll(".result").length));
    check("标题来自消息", txt.includes("测试品牌加肥加大休闲裤"), txt.slice(0, 60));
    check("采集结果判为可穿", /很合适|可以穿/.test(txt), txt.slice(0, 120));
  }

  // ============================================================
  console.log("\n=== 6. 重复商品去重 ===");
  {
    const store = makeStorage(bigProfile);
    const { document } = await loadPage(BASE, "compare.html", store);
    document.getElementById("htmlInput").value = PANTS_A + "\n---\n" + PANTS_A;
    document.querySelector("#parseBtn").click();
    await sleep(100);
    check("同一个尺寸表只算一个商品", document.querySelectorAll(".result").length === 1,
      String(document.querySelectorAll(".result").length));
  }

  console.log("\n" + (fails === 0
    ? "ALL PASS  (" + passes + " 项)"
    : fails + " FAILURES / " + (passes + fails) + " 项"));

  server.close();
  process.exit(fails === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); server.close(); process.exit(1); });
