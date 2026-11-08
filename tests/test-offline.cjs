/* 离线单文件版的可用性测试：file:// 场景，无网络 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const FILE = path.join(__dirname, "..", "public", "download", "offline.html");
const html = fs.readFileSync(FILE, "utf8");

let fails = 0, passes = 0;
function check(label, cond, extra) {
  if (cond) { passes++; console.log("PASS  " + label); }
  else { fails++; console.log("FAIL  " + label + (extra !== undefined ? "  -> " + extra : "")); }
}

// 模拟 file://：localStorage 可能被浏览器拒绝
const store = new Map();
const storage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(String(k), String(v)),
  removeItem: k => store.delete(k)
};

const errors = [];
const dom = new JSDOM(html, {
  runScripts: "dangerously",
  url: "file:///C:/Users/test/尺码助手-离线版.html",
  beforeParse(w) {
    Object.defineProperty(w, "localStorage", { value: storage, configurable: true });
    w.addEventListener("error", e => errors.push(e.message));
    w.alert = m => errors.push("alert:" + m);
  }
});
const w = dom.window, d = w.document;

check("无脚本错误", errors.length === 0, errors.join("; "));
check("DachuData 已加载", !!w.DachuData);
check("SizeParse 已加载", !!w.SizeParse);
check("没有外部 script 标签", d.querySelectorAll("script[src]").length === 0,
  String(d.querySelectorAll("script[src]").length));
check("没有外部 stylesheet", d.querySelectorAll('link[rel="stylesheet"]').length === 0);

// 档案字段
check("档案字段渲染", d.querySelectorAll("#fieldsHost input").length === 8,
  String(d.querySelectorAll("#fieldsHost input").length));

// 填数
function type(id, v) {
  const el = d.getElementById(id);
  el.value = String(v);
  el.dispatchEvent(new w.Event("input", { bubbles: true }));
}
type("o_belly", 84); type("o_hip", 96); type("o_thigh", 56); type("o_rise", 26); type("o_chest", 96);

const derived = d.getElementById("derived").textContent;
check("推算出现裤腰围", derived.includes("裤腰围"), derived.slice(0, 60));
check("推算出现后裆长", derived.includes("后裆长"), derived.slice(0, 80));
check("推算出现上衣胸围", derived.includes("上衣胸围"), derived.slice(0, 120));

// 比对
d.getElementById("tableInput").value =
  "日系直筒休闲裤\n" +
  "尺码\t裤长\t腰围\t臀围\t大腿围\t后裆\n" +
  "S\t98\t72\t94\t56\t32\n" +
  "M\t100\t76\t98\t58\t33\n" +
  "L\t102\t80\t102\t60\t34\n" +
  "XL\t104\t86\t107\t63\t35";
d.getElementById("parse2").click();

const res = d.getElementById("results2").textContent;
check("生成了结果卡片", d.querySelectorAll(".res2").length === 1,
  String(d.querySelectorAll(".res2").length));
check("结论是能穿", /很合适|可以穿/.test(res), res.slice(0, 80));
check("建议 XL", /建议\s*XL/.test(res), res.slice(0, 80));
check("标题解析正确", res.includes("日系直筒休闲裤"), res.slice(0, 40));
check("尺码徽标是 S/M/L/XL",
  ["S", "M", "L", "XL"].every(s => {
    return Array.from(d.querySelectorAll(".sz2")).some(el => el.textContent.trim().indexOf(s + " ") === 0);
  }), "missing");

// 多商品
d.getElementById("tableInput").value =
  "A裤\n尺码\t腰围\t大腿围\t后裆\nS\t72\t56\t32\n---\nB裤\n尺码\t腰围\t大腿围\t后裆\nXL\t86\t63\t35";
d.getElementById("parse2").click();
check("多个商品都解析", d.querySelectorAll(".res2").length === 2,
  String(d.querySelectorAll(".res2").length));

console.log("\n" + (fails === 0
  ? "ALL PASS  (" + passes + " 项)"
  : fails + " FAILURES / " + (passes + fails) + " 项"));
process.exit(fails === 0 ? 0 : 1);
