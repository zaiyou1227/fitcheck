/* 把 5 个页面合并成一个自包含的 HTML 文件
   用法：node scripts/build-single.cjs
   输出：public/download/single.html
*/
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PUB = path.join(ROOT, "public");
const OUT_DIR = path.join(PUB, "download");
const OUT = path.join(OUT_DIR, "single.html");

const PAGES = [
  { key: "profile", label: "尺码", file: "profile.html" },
  { key: "pants",   label: "裤子", file: "pants.html" },
  { key: "compare", label: "比对", file: "compare.html" },
  { key: "guide",   label: "筛店", file: "guide.html" },
  { key: "help",    label: "说明", file: "help.html" }
];

// 这些 id 在多个页面里重复，合并前统一加前缀
const DUP_IDS = ["card", "copyBtn", "fabricSeg", "flags", "pantsBody", "srcHint"];

// id 除了在 getElementById 里出现，还可能作为参数传进函数（如 fillTable("pantsBody", …)）
const EXTRA_FIX = {
  profile: [
    ['fillTable("pantsBody"', 'fillTable("profile_pantsBody"'],
    ["fillTable('pantsBody'", "fillTable('profile_pantsBody'"]
  ]
};

function read(rel) {
  return fs.readFileSync(path.join(PUB, rel), "utf8");
}

// 从整页 HTML 里取出 body 内容和内联脚本
function splitPage(html) {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (!bodyMatch) throw new Error("no body");
  let body = bodyMatch[1];

  // 页面级 <style> 可能写在 <head> 里，要从整份文档取
  const styles = [];
  html.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (m, css) => {
    styles.push(css);
    return "";
  });

  // 收集并移除所有 script
  const inlineScripts = [];
  body = body.replace(/<script([^>]*)>([\s\S]*?)<\/script>/gi, (m, attrs, content) => {
    if (/src\s*=/.test(attrs)) return "";           // 外链脚本直接丢掉
    inlineScripts.push(content);
    return "";
  });

  // body 里如果还有 <style> 也一起收走
  body = body.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (m, css) => {
    styles.push(css);
    return "";
  });

  return { body: body.trim(), script: inlineScripts.join("\n"), styles };
}

// 只给冲突的 id 加前缀
function prefixIds(text, prefix) {
  let out = text;
  DUP_IDS.forEach(id => {
    out = out.split('id="' + id + '"').join('id="' + prefix + '_' + id + '"');
    out = out.split('for="' + id + '"').join('for="' + prefix + '_' + id + '"');
    out = out.split('getElementById("' + id + '")').join('getElementById("' + prefix + '_' + id + '")');
    out = out.split("getElementById('" + id + "')").join("getElementById('" + prefix + "_" + id + "')");
    // 选择器里的 "#id"，后面不能紧跟字母数字，避免 card 命中 cardXXX
    out = out.replace(new RegExp('"#' + id + '(?![\\w-])', "g"), '"#' + prefix + '_' + id);
    out = out.replace(new RegExp("'#" + id + "(?![\\w-])", "g"), "'#" + prefix + "_" + id);
    out = out.replace(new RegExp("`#" + id + "(?![\\w-])", "g"), "`#" + prefix + "_" + id);
  });
  return out;
}

// 把 <img src="img/xxx.png"> 换成内联 base64
function inlineImages(html) {
  return html.replace(/(<img[^>]+src=")([^"]+)(")/gi, (m, pre, src, post) => {
    if (/^data:/.test(src)) return m;
    const f = path.join(PUB, src);
    if (!fs.existsSync(f)) return m;
    const ext = path.extname(f).slice(1).toLowerCase();
    const mime = ext === "png" ? "image/png" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/svg+xml";
    const b64 = fs.readFileSync(f).toString("base64");
    return pre + "data:" + mime + ";base64," + b64 + post;
  });
}

function stripBoot(js) {
  return js
    .replace(/\bUIx\.boot\(\);/g, "")
    .replace(/\bUI\.boot\(\);/g, "")
    // 单文件里没有独立的 service worker 文件，别注册
    .replace(/navigator\.serviceWorker\.register\([^)]*\)[^;]*;/g, "void 0;");
}

// ---------- 组装 ----------
const css = read("css/app.css");
const dataJs = read("js/data.js");
const sizeJs = read("js/sizeparse.js");
const appJs = read("js/app.js");

let pageStyles = "";
let pageBodies = "";
let pageScripts = "";

PAGES.forEach(p => {
  const html = read(p.file);
  const parts = splitPage(html);
  const body = inlineImages(prefixIds(parts.body, p.key));
  let script = stripBoot(prefixIds(parts.script, p.key));
  (EXTRA_FIX[p.key] || []).forEach(([from, to]) => {
    script = script.split(from).join(to);
  });

  parts.styles.forEach(s => { pageStyles += "\n/* " + p.key + " */\n" + s; });

  pageBodies +=
    '\n<section class="pg" data-page="' + p.key + '"' + (p.key === "profile" ? "" : " hidden") + '>\n' +
    body + "\n</section>\n";

  // 包一层，避免页面间的变量互相污染
  pageScripts += "\n/* ---- page: " + p.key + " ---- */\ntry {\n" + script + "\n} catch (e) { console.error('" + p.key + "', e); }\n";
});

function safe(js) {
  return js.replace(/<\/script>/gi, "<\\/script>");
}

const nav = PAGES.map(p =>
  '<button data-page="' + p.key + '"' + (p.key === "profile" ? ' aria-selected="true"' : '') + '>' + p.label + '</button>'
).join("");

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#1f6f4a">
<title>尺码助手 · 单文件版</title>
<style>
${css}
/* ---- 页面级样式 ---- */
${pageStyles}
/* ---- 单文件版外壳 ---- */
.snav{
  position:sticky;top:0;z-index:60;
  display:flex;gap:4px;
  background:rgba(255,255,255,.96);
  backdrop-filter:blur(10px);
  -webkit-backdrop-filter:blur(10px);
  border-bottom:1px solid var(--line);
  padding:8px 10px calc(8px + env(safe-area-inset-bottom,0px));
}
.snav button{
  flex:1;min-height:42px;padding:6px 4px;
  border:1px solid var(--line);background:#fdfdfb;
  border-radius:10px;font-size:13px;font-family:inherit;
  color:var(--sub);cursor:pointer;
}
.snav button[aria-selected="true"]{background:var(--ink);color:#fff;border-color:var(--ink)}
.pg[hidden]{display:none}
body{padding-bottom:24px}
.wrap{padding-top:14px}
</style>
</head>
<body>

<nav class="snav">${nav}</nav>

<div id="pages">
${pageBodies}
</div>

<script>${safe(dataJs)}</script>
<script>${safe(sizeJs)}</script>
<script>${safe(appJs)}</script>
<script>
${safe(pageScripts)}
</script>
<script>
(function () {
  "use strict";
  var nav = document.querySelector(".snav");
  function show(key) {
    document.querySelectorAll(".pg").forEach(function (s) {
      s.hidden = s.dataset.page !== key;
    });
    nav.querySelectorAll("button").forEach(function (b) {
      b.setAttribute("aria-selected", b.dataset.page === key ? "true" : "false");
    });
    window.scrollTo(0, 0);
    try { localStorage.setItem("fitcheck.lastPage", key); } catch (e) {}
    // 各页面监听 focus 来重算，切页时触发一次，保证数据是最新的
    window.dispatchEvent(new Event("focus"));
  }
  nav.addEventListener("click", function (ev) {
    var b = ev.target.closest("button[data-page]");
    if (b) show(b.dataset.page);
  });
  var last = "profile";
  try { last = localStorage.getItem("fitcheck.lastPage") || "profile"; } catch (e) {}
  if (!document.querySelector('.pg[data-page="' + last + '"]')) last = "profile";
  show(last);
})();
</script>
</body>
</html>`;

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT, html, "utf8");
console.log("built: " + path.relative(ROOT, OUT) + "  " + Math.round(fs.statSync(OUT).size / 1024) + "KB");

// 自检
const bad = [];
if (/<script[^>]+src=/i.test(html)) bad.push("外部 script");
if (/<link[^>]+rel=["']stylesheet/i.test(html)) bad.push("外部 stylesheet");
if (/<img[^>]+src="(?!data:)/i.test(html)) bad.push("外部图片");
if (bad.length) { console.error("外部依赖: " + bad.join(", ")); process.exit(1); }
console.log("自检通过：无外部依赖");
