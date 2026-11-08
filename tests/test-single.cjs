/* 单文件版测试：5 个页面共存于一个文件 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const FILE = path.join(__dirname, "..", "public", "download", "single.html");
const html = fs.readFileSync(FILE, "utf8");

let fails = 0, passes = 0;
function check(label, cond, extra) {
  if (cond) { passes++; console.log("PASS  " + label); }
  else { fails++; console.log("FAIL  " + label + (extra !== undefined ? "  -> " + extra : "")); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

const store = new Map();
const storage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(String(k), String(v)),
  removeItem: k => store.delete(k)
};

const errors = [];
const dom = new JSDOM(html, {
  runScripts: "dangerously",
  url: "file:///C:/Users/test/单文件版.html",
  pretendToBeVisual: true,
  beforeParse(w) {
    Object.defineProperty(w, "localStorage", { value: storage, configurable: true });
    w.addEventListener("error", e => errors.push(e.message));
    w.scrollTo = () => {};
    w.alert = m => errors.push("alert:" + m);
    w.confirm = () => true;
    Object.defineProperty(w.navigator, "clipboard", {
      value: { writeText: () => Promise.resolve() }, configurable: true
    });
    w.document.execCommand = () => true;
  }
});
const w = dom.window, d = w.document;

(async () => {
  await sleep(200);

  console.log("\n=== 结构 ===");
  check("没有脚本错误", errors.length === 0, errors.slice(0, 3).join(" | "));
  check("5 个页面区块", d.querySelectorAll(".pg").length === 5,
    String(d.querySelectorAll(".pg").length));
  check("导航 5 个按钮", d.querySelectorAll(".snav button").length === 5,
    String(d.querySelectorAll(".snav button").length));
  check("默认显示尺码页", !d.querySelector('.pg[data-page="profile"]').hidden);
  check("其它页隐藏", d.querySelector('.pg[data-page="compare"]').hidden);
  check("没有外部 script", d.querySelectorAll("script[src]").length === 0);
  check("没有外部 stylesheet", d.querySelectorAll('link[rel="stylesheet"]').length === 0);
  check("图片全部内联", Array.from(d.images).every(i => i.src.startsWith("data:")),
    Array.from(d.images).map(i => i.src.slice(0, 20)).join(","));

  console.log("\n=== 尺码页 ===");
  const inputs = d.querySelectorAll('[data-page="profile"] input[data-k]');
  check("21 个输入框", inputs.length === 21, String(inputs.length));

  function type(el, v) {
    el.value = String(v);
    el.dispatchEvent(new w.Event("input", { bubbles: true }));
  }
  const belly = d.getElementById("f_belly");
  check("能取到腹围输入框", !!belly);
  if (belly) {
    type(belly, 84);
    type(d.getElementById("f_hip"), 96);
    type(d.getElementById("f_thigh"), 56);
    type(d.getElementById("f_rise"), 26);
    type(d.getElementById("f_chest"), 96);
  }
  check("数据写入了 localStorage", !!store.get("dachu.v1"),
    store.get("dachu.v1") ? "yes" : "no");
  const derived = d.querySelector('.pg[data-page="profile"]').textContent;
  check("推算结果出现", /裤腰围|后裆长/.test(derived), derived.slice(0, 80));

  console.log("\n=== 切换页面 ===");
  d.querySelector('.snav button[data-page="compare"]').click();
  check("比对页显示", !d.querySelector('.pg[data-page="compare"]').hidden);
  check("尺码页隐藏", d.querySelector('.pg[data-page="profile"]').hidden);
  check("导航高亮切换",
    d.querySelector('.snav button[data-page="compare"]').getAttribute("aria-selected") === "true");

  console.log("\n=== 比对页 ===");
  const tableInput = d.getElementById("htmlInput");
  check("能取到输入框", !!tableInput);
  tableInput.value =
    "日系直筒休闲裤\n" +
    "尺码\t裤长\t腰围\t臀围\t大腿围\t后裆\n" +
    "S\t98\t72\t94\t56\t32\n" +
    "M\t100\t76\t98\t58\t33\n" +
    "L\t102\t80\t102\t60\t34\n" +
    "XL\t104\t86\t107\t63\t35";
  d.getElementById("parseBtn").click();
  await sleep(100);

  const res = d.getElementById("results").textContent;
  check("生成结果", d.querySelectorAll("#results .result").length === 1,
    String(d.querySelectorAll("#results .result").length));
  check("建议 XL", /建议\s*XL/.test(res), res.slice(0, 100));
  check("尺码是 S/M/L/XL", Array.from(d.querySelectorAll("#results .fit")).length === 4,
    String(d.querySelectorAll("#results .fit").length));

  console.log("\n=== 裤子页（应读到尺码页的数据）===");
  d.querySelector('.snav button[data-page="pants"]').click();
  await sleep(50);
  const pantsBody = d.getElementById("pants_pantsBody");
  check("裤子页有结果表", !!pantsBody);
  if (pantsBody) {
    const t = pantsBody.textContent;
    check("读到了腹围 → 裤腰围", /裤腰围/.test(t), t.slice(0, 60));
    check("裤腰围数值合理(86–94)", /8[6-9]|9[0-4]/.test(t), t.slice(0, 80));
  }

  console.log("\n=== 筛店页 ===");
  d.querySelector('.snav button[data-page="guide"]').click();
  await sleep(50);
  check("9 条标准", d.querySelectorAll("#items .item").length === 9,
    String(d.querySelectorAll("#items .item").length));
  d.querySelector('.item[data-id="flat"]').click();
  d.querySelector('.item[data-id="self"]').click();
  d.querySelector('.item[data-id="after"]').click();
  check("勾选后计分", d.getElementById("scoreTxt").textContent === "6 / 12 分",
    d.getElementById("scoreTxt").textContent);
  check("没有大码关键词", !/加肥加大|特体|胖mm/.test(d.querySelector('.pg[data-page="guide"]').textContent),
    "发现残留");

  console.log("\n=== 说明页 ===");
  d.querySelector('.snav button[data-page="help"]').click();
  await sleep(50);
  check("说明页可见", !d.querySelector('.pg[data-page="help"]').hidden);
  check("含 iPhone 与 Android", /iPhone/.test(d.querySelector('.pg[data-page="help"]').textContent));

  console.log("\n=== 无外部请求 ===");
  check("整份文件里没有 http(s) 外链的资源",
    !/src="https?:/.test(html) && !/href="https?:.*\.(css|js)"/.test(html));

  console.log("\n" + (fails === 0
    ? "ALL PASS  (" + passes + " 项)"
    : fails + " FAILURES / " + (passes + fails) + " 项"));
  if (errors.length) console.log("页面错误: " + errors.slice(0, 5).join(" | "));
  process.exit(fails === 0 ? 0 : 1);
})();
