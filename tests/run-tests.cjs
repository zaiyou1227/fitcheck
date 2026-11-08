/* ===========================================================
   集成测试：用 jsdom 加载真实页面（经本地 HTTP 服务），模拟用户操作
   覆盖：数据层换算、单位切换、推算、分享链接、筛店持久化、静态资源
   用法：node tests/run-tests.cjs
   =========================================================== */

const fs = require("fs");
const path = require("path");
const http = require("http");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..");
const PUB = path.join(ROOT, "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  const file = path.join(PUB, p);
  if (!file.startsWith(PUB) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end("not found"); return;
  }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
  res.end(fs.readFileSync(file));
});

let fails = 0;
let passes = 0;
function check(label, cond, extra) {
  if (cond) { passes++; console.log("PASS  " + label); }
  else { fails++; console.log("FAIL  " + label + (extra ? "  -> " + extra : "")); }
}

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

const sleep = ms => new Promise(r => setTimeout(r, ms));

// 加载页面并等外部脚本执行完
async function loadPage(base, file, store) {
  const html = fs.readFileSync(path.join(PUB, file), "utf8");
  const errors = [];
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    resources: "usable",
    url: base + "/" + file,
    pretendToBeVisual: true,
    beforeParse(window) {
      Object.defineProperty(window, "localStorage", { value: store, configurable: true });
      window.addEventListener("error", e => errors.push(e.message));
      window.HTMLElement.prototype.scrollIntoView = function () {};
      window.confirm = () => true;
      Object.defineProperty(window.navigator, "clipboard", {
        value: { writeText: () => Promise.resolve() }, configurable: true
      });
      window.document.execCommand = () => true;
      window.URL.createObjectURL = () => "blob:mock";
      window.URL.revokeObjectURL = () => {};
    }
  });

  // 等页面脚本就绪（DachuData 挂载 + DOMContentLoaded 之后的问题都解决）
  for (let i = 0; i < 100; i++) {
    if (dom.window.DachuData && dom.window.document.querySelector(".nav")) break;
    await sleep(30);
  }
  return { window: dom.window, document: dom.window.document, errors, dom };
}

function type(window, el, v) {
  el.value = String(v);
  el.dispatchEvent(new window.Event("input", { bubbles: true }));
}
function click(window, el) {
  el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
}
function rows(doc, id) {
  return Array.from(doc.querySelectorAll("#" + id + " tr")).map(tr => ({
    k: tr.children[0] ? tr.children[0].textContent : "",
    v: tr.children[1] ? tr.children[1].textContent : ""
  }));
}
function rowMap(doc, id) {
  const m = {};
  rows(doc, id).forEach(r => { m[r.k] = r.v; });
  return m;
}

async function main() {
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const BASE = "http://127.0.0.1:" + server.address().port;
  console.log("test server: " + BASE);

  // ============================================================
  console.log("\n=== 1. data.js 纯逻辑 ===");
  {
    const store = makeStorage();
    const { window } = await loadPage(BASE, "index.html", store);
    const D = window.DachuData;

    check("模块已暴露", !!D && !!D.PARTS);
    check("部位总数 21", Object.keys(D.PART_MAP).length === 21,
      String(Object.keys(D.PART_MAP).length));

    check("1in = 2.54cm", Math.abs(D.LEN_FACTOR.in - 2.54) < 1e-9);
    check("1寸 = 3.333cm", Math.abs(D.LEN_FACTOR.cun - 100 / 30) < 1e-9);
    check("1斤 = 0.5kg", D.WT_FACTOR.jin === 0.5);

    check("convCm 三单位",
      D.convCm(130).includes("51.2 in") && D.convCm(130).includes("39 寸"), D.convCm(130));
    check("convKg 含磅", D.convKg(150).includes("330.7 磅"), D.convKg(150));

    D.setItem("chest", 130, "cm");
    check("写入后读回 130", D.getCm("chest") === 130, String(D.getCm("chest")));
    D.setItem("weight", 300, "jin");
    check("300斤 = 150kg", D.getKg("weight") === 150, String(D.getKg("weight")));

    D.setUnit("len", "in");
    check("切英寸后 cm 真值不变", D.getCm("chest") === 130, String(D.getCm("chest")));
    check("显示值转为 51.2", D.displayValue("chest") === "51.2", D.displayValue("chest"));
    D.setUnit("len", "cm");
    check("切回 cm 显示 130", D.displayValue("chest") === "130", D.displayValue("chest"));

    D.clearAll();
    check("清空后无数据", D.getCm("chest") === null);
  }

  // ============================================================
  console.log("\n=== 2. 档案页 profile.html ===");
  let shareUrl = "";
  {
    const store = makeStorage();
    const { window, document, errors } = await loadPage(BASE, "profile.html", store);

    check("无脚本错误", errors.length === 0, errors.join("; "));
    check("21 个输入框", document.querySelectorAll("input[data-k]").length === 21,
      String(document.querySelectorAll("input[data-k]").length));

    type(window, document.getElementById("f_belly"), 138);
    type(window, document.getElementById("f_hip"), 148);
    type(window, document.getElementById("f_thigh"), 85);
    type(window, document.getElementById("f_rise"), 32);
    type(window, document.getElementById("f_chest"), 130);
    type(window, document.getElementById("f_shoulder"), 56);

    const p = rowMap(document, "pantsBody");
    console.log("    pants: " + JSON.stringify(p));
    check("裤腰围 138+6-1 → 143-146", p["裤腰围 ★"] === "143–146 cm", p["裤腰围 ★"]);
    check("大腿围 85*1.1+7.5 → 101–105", p["裤大腿围 ★"] === "101–105 cm", p["裤大腿围 ★"]);
    check("后裆 32+8 → 39–42", p["后裆长 ★"] === "39–42 cm", p["后裆长 ★"]);

    const t = rowMap(document, "topBody");
    console.log("    top:   " + JSON.stringify(t));
    check("上衣胸围 130+8 → 136–143", t["上衣胸围 ★"] === "136–143 cm", t["上衣胸围 ★"]);
    check("上衣肩宽 56-1 → 55–58.5", t["上衣肩宽 ★"] === "55–58.5 cm", t["上衣肩宽 ★"]);

    check("数据写入了 localStorage", !!store.getItem("dachu.v1"));
    check("档案卡有内容", document.getElementById("card").value.includes("我的身体尺寸档案"));
    check("档案卡含硬要求",
      document.getElementById("card").value.includes("报不出来我就不买了"));

    click(window, document.querySelector('#uLenSeg button[data-v="in"]'));
    check("切英寸后腹围显示 54.3",
      document.getElementById("f_belly").value === "54.3",
      document.getElementById("f_belly").value);
    check("切单位后结果不变",
      rowMap(document, "pantsBody")["裤腰围 ★"] === "143–146 cm",
      rowMap(document, "pantsBody")["裤腰围 ★"]);

    type(window, document.getElementById("f_thigh"), 33.5);   // 85.09cm
    check("英寸输入后大腿目标仍 101–105",
      rowMap(document, "pantsBody")["裤大腿围 ★"] === "101–105 cm",
      rowMap(document, "pantsBody")["裤大腿围 ★"]);

    click(window, document.querySelector('#uLenSeg button[data-v="cm"]'));
    check("切回厘米后大腿仍在 85 附近（±0.2cm，浮点往返）",
      Math.abs(parseFloat(document.getElementById("f_thigh").value) - 85) <= 0.2,
      document.getElementById("f_thigh").value);

    click(window, document.querySelector('#uWtSeg button[data-v="jin"]'));
    type(window, document.getElementById("f_weight"), 300);
    const convW = document.querySelector('[data-conv="weight"]').textContent;
    check("300斤 显示 150 公斤", convW.includes("150 公斤"), convW);

    click(window, document.querySelector('#fabricSeg button[data-v="high"]'));
    check("高弹面料改变大腿余量",
      rowMap(document, "pantsBody")["裤大腿围 ★"] !== "101–105 cm",
      rowMap(document, "pantsBody")["裤大腿围 ★"]);

    check("有备份面板", document.querySelectorAll("[data-act]").length > 0);
    click(window, document.querySelector('[data-act="link"]'));
    await sleep(60);
    shareUrl = document.querySelector('[data-act="linktext"]').textContent;
    check("分享链接已生成", shareUrl.includes("share.html#"), shareUrl.slice(0, 40));
    check("分享 token 不过长", shareUrl.length < 1800, String(shareUrl.length));
  }

  // ============================================================
  console.log("\n=== 3. 分享链接往返 ===");
  {
    const store = makeStorage();
    const { window, document } = await loadPage(BASE, "profile.html", store);
    const D = window.DachuData;

    type(window, document.getElementById("f_chest"), 120);
    type(window, document.getElementById("f_belly"), 140);
    type(window, document.getElementById("f_thigh"), 80);
    type(window, document.getElementById("f_rise"), 30);

    const token = D.encodeShare();
    console.log("    token len = " + token.length);
    check("token 前缀 v1", token.startsWith("v1."), token.slice(0, 4));

    const decoded = D.decodeShare(token);
    check("能解码", !!decoded);
    check("解码后 chest=120", decoded && decoded.items.chest.v === 120);
    check("解码后保留单位", decoded && decoded.items.chest.u === "cm");

    check("坏 token 返回 null", D.decodeShare("v1.garbage") === null);
    check("空 token 返回 null", D.decodeShare("") === null);

    // share.html 正常渲染（无 hash 时显示提示）
    const p2 = await loadPage(BASE, "share.html", makeStorage());
    check("share.html 无错误", p2.errors.length === 0, p2.errors.join("; "));
    check("无数据时给出提示",
      p2.document.body.textContent.includes("没有读到数据"),
      p2.document.body.textContent.slice(0, 60));
  }

  // ============================================================
  console.log("\n=== 4. 裤子页 pants.html ===");
  {
    const store = makeStorage();
    {
      const seed = await loadPage(BASE, "profile.html", store);
      const sd = seed.document, sw = seed.window;
      type(sw, sd.getElementById("f_belly"), 138);
      type(sw, sd.getElementById("f_thigh"), 85);
      type(sw, sd.getElementById("f_rise"), 32);
      type(sw, sd.getElementById("f_hip"), 148);
    }

    const { window, document, errors } = await loadPage(BASE, "pants.html", store);
    check("无脚本错误", errors.length === 0, errors.join("; "));

    const p = rowMap(document, "pantsBody");
    console.log("    " + JSON.stringify(p));
    check("读到腹围 → 裤腰围 143–146", p["裤腰围 ★"] === "143–146 cm", p["裤腰围 ★"]);
    check("后裆 39–42", p["后裆长 ★"] === "39–42 cm", p["后裆长 ★"]);
    check("客服话术已生成", document.getElementById("card").value.includes("老板你好"));

    click(window, document.querySelector('#srcSeg button[data-v="ref"]'));
    check("旧裤子模式显示", document.getElementById("refCard").style.display !== "none");

    type(window, document.getElementById("r_riseB"), 42);
    type(window, document.getElementById("r_thigh"), 36);
    const refMap = rowMap(document, "pantsBody");
    console.log("    ref: " + JSON.stringify(refMap));
    check("旧裤子后裆 41–44", refMap["后裆长 ★"] === "41–44 cm", refMap["后裆长 ★"]);
    check("旧裤子大腿 36*2=72 → 72–76",
      refMap["裤大腿围 ★"] === "72–76 cm", refMap["裤大腿围 ★"]);

    click(window, document.querySelector('#refModeSeg button[data-v="full"]'));
    check("整圈口径 36 不乘 2 → 36–40",
      rowMap(document, "pantsBody")["裤大腿围 ★"] === "36–40 cm",
      rowMap(document, "pantsBody")["裤大腿围 ★"]);

    click(window, document.querySelector('#refModeSeg button[data-v="half"]'));
    type(window, document.getElementById("cmpRise"), 29);
    const cmpTxt = document.getElementById("cmpOut").textContent;
    check("不合格后裆给出警告", cmpTxt.includes("勒裆") || cmpTxt.includes("短"),
      cmpTxt.slice(0, 50));
  }

  // ============================================================
  console.log("\n=== 5. 筛店页 guide.html ===");
  {
    const store = makeStorage();
    const { window, document, errors } = await loadPage(BASE, "guide.html", store);
    check("无脚本错误", errors.length === 0, errors.join("; "));
    check("9 条标准", document.querySelectorAll(".item").length === 9,
      String(document.querySelectorAll(".item").length));
    check("初始 0 分", document.getElementById("scoreTxt").textContent === "0 / 12 分",
      document.getElementById("scoreTxt").textContent);

    ["flat", "self", "after"].forEach(id => {
      click(window, document.querySelector('.item[data-id="' + id + '"]'));
    });
    check("关键项 3/3", document.getElementById("keyTxt").textContent === "关键项 3 / 3",
      document.getElementById("keyTxt").textContent);
    check("6 分时不该通过",
      !document.getElementById("verdict").className.includes("v-good"),
      document.getElementById("verdict").className);

    ["photo", "season", "fast"].forEach(id => {
      click(window, document.querySelector('.item[data-id="' + id + '"]'));
    });
    check("9 分且关键齐全 → 可长期买",
      document.getElementById("verdict").className.includes("v-good"),
      document.getElementById("verdict").textContent.slice(0, 24));

    check("勾选写入 localStorage", !!store.getItem("dachu.v1"));
    const reload = await loadPage(BASE, "guide.html", store);
    check("重开页面后勾选还在",
      reload.document.querySelector('.item[data-id="flat"]').classList.contains("on"));

    check("默认真实成本 807", document.getElementById("trueOut").textContent === "807 元",
      document.getElementById("trueOut").textContent);
    click(window, document.querySelector('#fitSeg button[data-v="0.45"]'));
    check("45% 时成本 1339", document.getElementById("trueOut").textContent === "1339 元",
      document.getElementById("trueOut").textContent);
    check("低成功率给出警告",
      document.getElementById("advice").textContent.includes("别赌"),
      document.getElementById("advice").textContent.slice(0, 20));
  }

  // ============================================================
  console.log("\n=== 6. 静态资源与 PWA ===");
  {
    const must = [
      "index.html", "profile.html", "pants.html", "compare.html", "guide.html",
      "help.html", "share.html",
      "css/app.css", "js/data.js", "js/sizeparse.js", "js/app.js",
      "js/vendor-lz-string.min.js",
      "manifest.webmanifest", "sw.js",
      "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png",
      "icons/apple-touch-icon.png",
      "img/help-home.png", "img/help-profile.png", "img/help-compare.png",
      "download/offline.html"
    ];
    must.forEach(f => check("存在 " + f, fs.existsSync(path.join(PUB, f))));

    // 手机使用说明页
    const helpHtml = fs.readFileSync(path.join(PUB, "help.html"), "utf8");
    check("说明页含 iPhone 步骤", helpHtml.includes("iPhone"));
    check("说明页含 Android 步骤", helpHtml.includes("Android"));
    check("说明页含「添加到主屏幕」", helpHtml.includes("添加到主屏幕"));
    check("说明页引用 3 张截图", (helpHtml.match(/img\/help-[a-z]+\.png/g) || []).length === 3,
      String((helpHtml.match(/img\/help-[a-z]+\.png/g) || []).length));
    check("说明页有站点地址", helpHtml.includes("zaiyou1227.github.io/fitcheck"));

    // 首页要有说明页入口
    const idxHtml = fs.readFileSync(path.join(PUB, "index.html"), "utf8");
    check("首页链接到说明页", idxHtml.includes('href="help.html"'));

    // 离线版：必须是自包含的
    {
      const off = fs.readFileSync(path.join(PUB, "download/offline.html"), "utf8");
      check("离线版没有外部 script", !/<script[^>]+src=/i.test(off));
      check("离线版没有外部样式", !/<link[^>]+rel="stylesheet"/i.test(off));
      check("离线版内联了数据层", off.includes('var KEY = "dachu.v1"'));
      check("离线版内联了解析引擎", off.includes("SizeParse"));
      check("离线版体积合理（<200KB）", Buffer.byteLength(off) < 200 * 1024,
        Math.round(Buffer.byteLength(off) / 1024) + "KB");
      check("首页提供离线版下载", idxHtml.includes("download/offline.html"));
      check("说明页提供离线版下载", helpHtml.includes("download/offline.html"));
    }

    // 说明页截图尺寸合理（宽高比接近手机）
    {
      const b = fs.readFileSync(path.join(PUB, "img/help-home.png"));
      const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
      check("截图是竖版手机比例", w === 780 && h === 1688, w + "x" + h);
    }

    const manifest = JSON.parse(fs.readFileSync(path.join(PUB, "manifest.webmanifest"), "utf8"));
    check("manifest 有 name", !!manifest.name);
    check("manifest 有 192 图标", manifest.icons.some(i => i.sizes === "192x192"));
    check("manifest 有 512 图标", manifest.icons.some(i => i.sizes === "512x512"));
    check("manifest display standalone", manifest.display === "standalone");

    const sw = fs.readFileSync(path.join(PUB, "sw.js"), "utf8");
    check("sw 缓存了 7 个页面",
      ["index.html", "profile.html", "pants.html", "compare.html", "guide.html",
       "help.html", "share.html"]
        .every(f => sw.includes(f)));
    check("sw 缓存了解析引擎", sw.includes("sizeparse.js"));
    check("sw 缓存了说明页截图", sw.includes("img/help-home.png"));
    check("sw 缓存了离线版", sw.includes("download/offline.html"));

    ["index.html", "profile.html", "pants.html", "compare.html", "guide.html"].forEach(f => {
      const s = fs.readFileSync(path.join(PUB, f), "utf8");
      check(f + " 引用 app.css", s.includes("css/app.css"));
      check(f + " 引用 data.js", s.includes("js/data.js"));
      check(f + " 引用 app.js", s.includes("js/app.js"));
      check(f + " 声明 viewport", s.includes('name="viewport"'));
      check(f + " 有主题色", s.includes('name="theme-color"'));
    });

    check("compare.html 引用解析引擎",
      fs.readFileSync(path.join(PUB, "compare.html"), "utf8").includes("js/sizeparse.js"));

    ["index.html", "profile.html", "pants.html", "guide.html", "share.html"].forEach(f => {
      const s = fs.readFileSync(path.join(PUB, f), "utf8");
      // 排除 href="/" 这种首页链接；只查以 / 开头的静态资源
      const bad = /(src|href)="\/(?!\/)[\w.-]/.test(s);
      check(f + " 没有绝对路径资源", !bad);
    });

    // 图标尺寸正确
    const size = f => {
      const b = fs.readFileSync(path.join(PUB, f));
      return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
    };
    const i192 = size("icons/icon-192.png");
    const i512 = size("icons/icon-512.png");
    check("icon-192 尺寸正确", i192.w === 192 && i192.h === 192, JSON.stringify(i192));
    check("icon-512 尺寸正确", i512.w === 512 && i512.h === 512, JSON.stringify(i512));
  }

  // ============================================================
  console.log("\n=== 7. 批量比对页 compare.html ===");
  {
    const store = makeStorage({
      schema: 1, units: { len: "cm", wt: "kg" }, prefs: { fabric: "none" },
      items: {
        waist: { v: 125, u: "cm" }, belly: { v: 138, u: "cm" },
        hip: { v: 148, u: "cm" }, thigh: { v: 85, u: "cm" }, rise: { v: 32, u: "cm" }
      },
      guide: {}
    });
    const { window, document, errors } = await loadPage(BASE, "compare.html", store);
    check("无脚本错误", errors.length === 0, errors.join("; "));
    check("引擎已加载", !!window.SizeParse);
    check("五个导航项", document.querySelectorAll(".nav a").length === 5,
      String(document.querySelectorAll(".nav a").length));
    check("三个输入页签", document.querySelectorAll(".tabs button[data-tab]").length === 3);

    document.getElementById("htmlInput").value =
      "尺码\t裤长\t腰围\t臀围\t大腿围\t后裆\n" +
      "3XL\t100\t116\t126\t72\t36\n" +
      "4XL\t102\t124\t134\t78\t38\n" +
      "5XL\t104\t132\t142\t84\t40\n" +
      "6XL\t106\t140\t152\t92\t44";
    document.querySelector("#parseBtn").click();
    await sleep(150);

    check("生成结果卡片", document.querySelectorAll(".result").length === 1,
      String(document.querySelectorAll(".result").length));
    const txt = document.getElementById("results").textContent;
    check("给出可穿结论", /很合适|可以穿/.test(txt), txt.slice(0, 80));
    check("结果里出现建议尺码", /建议/.test(txt), txt.slice(0, 80));
    check("有明细展开按钮", !!document.querySelector("[data-toggle]"));
  }

  console.log("\n" + (fails === 0
    ? "ALL PASS  (" + passes + " 项)"
    : fails + " FAILURES / " + (passes + fails) + " 项"));

  server.close();
  process.exit(fails === 0 ? 0 : 1);
}

main().catch(err => {
  console.error(err);
  server.close();
  process.exit(1);
});
