/* 把站点打包成一个离线单文件 HTML
   用法：node scripts/build-offline.cjs
   输出：public/download/尺码助手-离线版.html
*/
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PUB = path.join(ROOT, "public");
const OUT_DIR = path.join(PUB, "download");
const OUT = path.join(OUT_DIR, "offline.html");

function read(rel) {
  return fs.readFileSync(path.join(PUB, rel), "utf8");
}

let template = read("offline.template.html");
const css = read("css/app.css");
const dataJs = read("js/data.js");
const sizeJs = read("js/sizeparse.js");

// 防止内联脚本里出现 </script> 提前截断
function safeInline(js) {
  return js.replace(/<\/script>/gi, "<\\/script>");
}

template = template.replace("/*INLINE_CSS*/", css);
template = template.replace("/*INLINE_DATA*/", safeInline(dataJs));
template = template.replace("/*INLINE_SIZEPARSE*/", safeInline(sizeJs));

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT, template, "utf8");

const kb = Math.round(fs.statSync(OUT).size / 1024);
console.log("built: " + path.relative(ROOT, OUT) + "  " + kb + "KB");

// 自检：不能有任何外部引用
const bad = [];
if (/<script[^>]+src=/i.test(template)) bad.push("外部 script");
if (/<link[^>]+rel=["']stylesheet/i.test(template)) bad.push("外部 stylesheet");
if (/url\((['"]?)https?:/i.test(template)) bad.push("外部字体/图片");
if (/\bfetch\(/.test(template)) bad.push("fetch 调用");

if (bad.length) {
  console.error("警告：离线文件里出现外部依赖 -> " + bad.join(", "));
  process.exit(1);
}
console.log("自检通过：无外部依赖");
