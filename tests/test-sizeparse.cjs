/* 解析 + 匹配引擎测试：用真实商品页会遇到的结构与数据 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const PUB = path.join(__dirname, "..", "public");
const SRC = fs.readFileSync(path.join(PUB, "js/sizeparse.js"), "utf8");

let fails = 0, passes = 0;
function check(label, cond, extra) {
  if (cond) { passes++; console.log("PASS  " + label); }
  else { fails++; console.log("FAIL  " + label + (extra !== undefined ? "  -> " + extra : "")); }
}
function eq(label, actual, expected) {
  check(label, JSON.stringify(actual) === JSON.stringify(expected),
    "got " + JSON.stringify(actual) + " want " + JSON.stringify(expected));
}
function near(label, actual, expected, tol) {
  check(label, Math.abs(actual - expected) <= (tol || 0.6), "got " + actual + " want ~" + expected);
}

const ctx = { console, Math, JSON, isFinite, parseFloat, Object, Array, String, Number, RegExp };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(SRC, ctx, { filename: "sizeparse.js" });
const SP = ctx.SizeParse;

console.log("\n=== 1. 数值解析（单位/区间/中文尺） ===");
eq("72cm → 72", SP.parseValue("72cm"), 72);
eq("72 厘米 → 72", SP.parseValue("72 厘米"), 72);
eq("72±1 → 72", SP.parseValue("72±1"), 72);
eq("72-74 → 取首个 72", SP.parseValue("72-74"), 72);
near("2尺4 → 80", SP.parseValue("2尺4"), 80);
near("2.4尺 → 80", SP.parseValue("2.4尺"), 80);
near("2尺8 → 93.3", SP.parseValue("2尺8"), 93.3);
near("3尺2 → 106.7", SP.parseValue("3尺2"), 106.7);
near('28" → 71.1', SP.parseValue('28"'), 71.1);
near("28 inch → 71.1", SP.parseValue("28 inch"), 71.1);
eq("空 → null", SP.parseValue("—"), null);
eq("斜杠 → null", SP.parseValue("/"), null);
eq("无数字 → null", SP.parseValue("均码"), null);

console.log("\n=== 2. 尺码标签识别 ===");
["S","M","L","XL","XXL","XXXL","4XL","5XL","6XL","均码","170/88A","2XL"].forEach(function (s) {
  check("识别 " + s, SP.isSizeLabel(s));
});
["胸围","尺码","合计","备注","面料"].forEach(function (s) {
  check("不误判 " + s, !SP.isSizeLabel(s));
});

console.log("\n=== 3. 横向表格（首行字段，首列尺码）===");
const horizontalHtml = `
<table>
  <tr><th>尺码</th><th>肩宽</th><th>胸围</th><th>衣长</th><th>袖长</th></tr>
  <tr><td>XL</td><td>48</td><td>118</td><td>72</td><td>60</td></tr>
  <tr><td>2XL</td><td>50</td><td>124</td><td>74</td><td>61</td></tr>
  <tr><td>3XL</td><td>52</td><td>132</td><td>76</td><td>62</td></tr>
</table>`;
{
  const r = SP.parse(horizontalHtml);
  check("解析成功", r.ok, JSON.stringify(r));
  eq("布局为 horizontal", r.layout, "horizontal");
  eq("3 个尺码", r.rows.length, 3);
  eq("第一个尺码是 XL", r.rows[0].size, "XL");
  eq("XL 肩宽 48", r.rows[0].values.shoulder, 48);
  eq("XL 衣长 72", r.rows[0].values.length, 72);
  eq("XL 袖长 60", r.rows[0].values.sleeve, 60);
  check("识别出 4 个字段（胸围/上胸围已合并为一个）", r.fields.length === 4, JSON.stringify(r.fields));
  check("置信度 > 0.6", r.confidence > 0.6, r.confidence);
}

console.log("\n=== 4. 纵向表格（首列字段，首行尺码）===");
const verticalHtml = `
<table>
  <tr><td>项目</td><td>M</td><td>L</td><td>XL</td><td>2XL</td></tr>
  <tr><td>胸围</td><td>104</td><td>110</td><td>116</td><td>124</td></tr>
  <tr><td>衣长</td><td>68</td><td>70</td><td>72</td><td>74</td></tr>
  <tr><td>肩宽</td><td>44</td><td>46</td><td>48</td><td>50</td></tr>
  <tr><td>袖长</td><td>58</td><td>59</td><td>60</td><td>61</td></tr>
</table>`;
{
  const r = SP.parse(verticalHtml);
  check("解析成功", r.ok, JSON.stringify(r));
  eq("布局为 vertical", r.layout, "vertical");
  eq("4 个尺码", r.rows.length, 4);
  eq("XL 衣长 72", r.rows[2].values.length, 72);
  eq("2XL 肩宽 50", r.rows[3].values.shoulder, 50);
}

console.log("\n=== 5. 淘宝常见：带单位、带区间、全角括号 ===");
const messyHtml = `
<table>
  <thead><tr><th>尺码</th><th>裤长(cm)</th><th>腰围（cm）</th><th>臀围</th><th>大腿围</th><th>前裆</th><th>后裆</th></tr></thead>
  <tbody>
    <tr><td>3XL</td><td>102-104</td><td>96-100</td><td>120-124</td><td>68-72</td><td>32</td><td>42</td></tr>
    <tr><td>4XL</td><td>104-106</td><td>100-104</td><td>124-128</td><td>72-76</td><td>33</td><td>43</td></tr>
  </tbody>
</table>`;
{
  const r = SP.parse(messyHtml);
  check("解析成功", r.ok, JSON.stringify(r));
  eq("2 个尺码", r.rows.length, 2);
  eq("3XL 裤长取区间下端 102", r.rows[0].values.pantLength, 102);
  eq("3XL 腰围 96", r.rows[0].values.waist, 96);
  eq("3XL 后裆 42", r.rows[0].values.backRise, 42);
  eq("3XL 前裆 32", r.rows[0].values.frontRise, 32);
  check("字段名带单位也能识别", r.fields.some(f => f.key === "waist"));
  check("裤长字段带单位也识别", r.fields.some(f => f.key === "pantLength"));
}

console.log("\n=== 6. 纯文本粘贴（用户复制详情页）===");
const plain = `胸围 130
衣长 76
肩宽 52
袖长 62`;
{
  const r = SP.parse(plain);
  check("解析成功", r.ok, JSON.stringify(r));
  eq("布局 kv", r.layout, "kv");
  eq("衣长 76", r.rows[0].values.length, 76);
  eq("肩宽 52", r.rows[0].values.shoulder, 52);
  eq("袖长 62", r.rows[0].values.sleeve, 62);
}

console.log("\n=== 7. 单行键值对 ===");
{
  const r = SP.parse("腰围：110cm 臀围：128cm 大腿围：76cm 后裆：44cm");
  check("解析成功", r.ok, JSON.stringify(r));
  eq("腰围 110", r.rows[0].values.waist, 110);
  eq("后裆 44", r.rows[0].values.backRise, 44);
}

console.log("\n=== 8. 中文尺单位（淘宝老链接常见）===");
{
  const r = SP.parse("腰围 2尺8 臀围 3尺2");
  check("解析成功", r.ok, JSON.stringify(r));
  near("2尺8 → 93.3", r.rows[0].values.waist, 93.3);
  near("3尺2 → 106.7", r.rows[0].values.hip, 106.7);
}

console.log("\n=== 9. 垃圾输入不该报错 ===");
["", "   ", "今天天气不错", "<div>加载中</div>", "价格 199 元"].forEach(function (bad) {
  const r = SP.parse(bad);
  check("不崩: " + JSON.stringify(bad).slice(0, 20), !!r && r.ok === false, JSON.stringify(r));
});

console.log("\n=== 10. 品类推断 ===");
eq("裤长+后裆 → pants", SP.guessCategoryFromFields([{ key: "pantLength" }, { key: "backRise" }]), "pants");
eq("胸围+袖长 → top", SP.guessCategoryFromFields([{ key: "chest" }, { key: "sleeve" }]), "top");
eq("标题含裤子 → pants", SP.guessCategory("男士加肥加大休闲裤"), "pants");
eq("标题含夹克 → coat", SP.guessCategory("加肥加大夹克外套"), "coat");

console.log("\n=== 11. 匹配：大码身体 vs 自洽的尺码表 ===");
const bigBody = {
  waist: 125, belly: 138, hip: 148, thigh: 85, rise: 32,
  chest: 130, shoulder: 56, neck: 45, armLen: 62, outseam: 105
};
// 数据自洽：6XL 是唯一腰围够得着 138 腹围的码
const pantsTable = {
  ok: true, layout: "horizontal",
  fields: [{ key: "waist" }, { key: "hip" }, { key: "thigh" }, { key: "backRise" }, { key: "pantLength" }],
  rows: [
    { size: "3XL", values: { waist: 116, hip: 126, thigh: 72, backRise: 36, pantLength: 100 } },
    { size: "4XL", values: { waist: 124, hip: 134, thigh: 78, backRise: 38, pantLength: 102 } },
    { size: "5XL", values: { waist: 132, hip: 142, thigh: 84, backRise: 40, pantLength: 104 } },
    { size: "6XL", values: { waist: 140, hip: 152, thigh: 92, backRise: 44, pantLength: 106 } }
  ]
};
{
  const m = SP.match({ parsed: pantsTable, category: "pants", title: "大码男裤" }, bigBody, { fabric: "none" });
  eq("品类 pants", m.category, "pants");
  console.log("    各尺码: " + m.all.map(s => s.size + "=" + s.score + "(" + s.label + ")").join(", "));
  eq("最佳是 6XL", m.best.size, "6XL");
  check("6XL 判为可穿", m.best.label === "很合适" || m.best.label === "可以穿", m.best.label);
  const s3 = m.all.find(s => s.size === "3XL");
  eq("3XL 穿不下", s3.label, "穿不下");
  check("3XL 给出生硬的失败原因", /腰围|臀围|大腿/.test(s3.hardFail || ""), s3.hardFail);
}

console.log("\n=== 12. 普通身材 vs 同一张表（应该全部偏大）===");
const normalBody = {
  waist: 78, belly: 82, hip: 96, thigh: 56, rise: 26,
  chest: 92, shoulder: 44, neck: 38, armLen: 58, outseam: 98
};
{
  const m = SP.match({ parsed: pantsTable, category: "pants" }, normalBody, { fabric: "none" });
  console.log("    各尺码: " + m.all.map(s => s.size + "=" + s.score + "(" + s.label + ")").join(", "));
  check("没有真正合身的码（最多偏紧）", m.fittingCount <= 1, m.fittingCount);
  check("结论是偏大或偏紧，不是刚好", /偏大|偏紧/.test(m.best.label), m.best.label);
}

console.log("\n=== 13. 匹配：上衣 ===");
const topTable = {
  ok: true, layout: "horizontal",
  fields: [{ key: "chest" }, { key: "shoulder" }, { key: "sleeve" }, { key: "length" }],
  rows: [
    { size: "L",   values: { chest: 104, shoulder: 45, sleeve: 59, length: 70 } },
    { size: "XL",  values: { chest: 112, shoulder: 47, sleeve: 60, length: 72 } },
    { size: "2XL", values: { chest: 124, shoulder: 50, sleeve: 61, length: 74 } },
    { size: "3XL", values: { chest: 138, shoulder: 54, sleeve: 62, length: 76 } }
  ]
};
{
  const mBig = SP.match({ parsed: topTable, category: "top" }, bigBody, { fabric: "none" });
  console.log("    大码: " + mBig.all.map(s => s.size + "=" + s.score + "(" + s.label + ")").join(", "));
  eq("大码最佳是 3XL", mBig.best.size, "3XL");
  check("3XL 可穿", mBig.best.label === "很合适" || mBig.best.label === "可以穿", mBig.best.label);

  const mNorm = SP.match({ parsed: topTable, category: "top" }, normalBody, { fabric: "none" });
  console.log("    普通: " + mNorm.all.map(s => s.size + "=" + s.score + "(" + s.label + ")").join(", "));
  eq("普通身材最佳是 L", mNorm.best.size, "L");
}

console.log("\n=== 14. 弹性面料放宽 ===");
{
  // 5XL 腰围 132 vs 腹围 138 → 差 6cm，无弹穿不下、高弹勉强
  const mNone = SP.match({ parsed: pantsTable, category: "pants" }, bigBody, { fabric: "none" });
  const mHigh = SP.match({ parsed: pantsTable, category: "pants" }, bigBody, { fabric: "high" });
  const a = mNone.all.find(s => s.size === "5XL");
  const b = mHigh.all.find(s => s.size === "5XL");
  console.log("    无弹 5XL=" + a.score + "(" + a.label + ") 高弹 5XL=" + b.score + "(" + b.label + ")");
  check("高弹面料下 5XL 评分不降", b.score >= a.score, b.score + " vs " + a.score);
}

console.log("\n=== 15. 批量排序 ===");
const products = [
  { title: "商品A 只有小码", category: "pants", parsed: {
      ok: true, fields: [{ key: "waist" }], rows: [
        { size: "M", values: { waist: 76 } }, { size: "L", values: { waist: 82 } }
      ] } },
  { title: "商品B 有 6XL", category: "pants", parsed: {
      ok: true, fields: [{ key: "waist" }, { key: "thigh" }, { key: "backRise" }], rows: [
        { size: "6XL", values: { waist: 142, thigh: 94, backRise: 45 } }
      ] } },
  { title: "商品C 数据不全", category: "unknown", parsed: {
      ok: true, fields: [{ key: "length" }], rows: [
        { size: "XL", values: { length: 72 } }
      ] } }
];
{
  const ranked = SP.rank(products, bigBody, { fabric: "none" });
  console.log("    排序: " + ranked.map(r => r.product.title + ":" + (r.match.best ? r.match.best.label : "-")).join(" > "));
  eq("第一名是商品B", ranked[0].product.title, "商品B 有 6XL");
  check("商品B 判为可穿", ranked[0].fitOk, ranked[0].match.best.label);
  eq("最后一名是数据不全的 C", ranked[ranked.length - 1].product.title, "商品C 数据不全");
}

console.log("\n=== 16. 真实感文本：整段详情页复制 ===");
const realPage = `
男士加肥加大宽松休闲裤 大码特体
面料：棉 98% 氨纶 2%
尺码表
尺码	裤长	腰围	臀围	大腿围	前裆	后裆
3XL	102	116	126	72	32	36
4XL	104	124	134	78	33	38
5XL	106	132	142	84	34	40
6XL	108	140	152	92	35	44
温馨提示：手工测量误差 1-3cm
`;
{
  const r = SP.parse(realPage);
  check("解析成功", r.ok, JSON.stringify(r).slice(0, 200));
  eq("4 个尺码", r.rows.length, 4);
  const m = SP.match({ parsed: r, category: SP.guessCategory(realPage) }, bigBody, { fabric: "some" });
  console.log("    推断品类: " + m.category + " | 各码: " +
    m.all.map(s => s.size + "=" + s.score).join(", "));
  eq("品类推断为 pants", m.category, "pants");
  eq("6XL 可穿", m.best.size, "6XL");
}

console.log("\n" + (fails === 0
  ? "ALL PASS  (" + passes + " 项)"
  : fails + " FAILURES / " + (passes + fails) + " 项"));
process.exit(fails === 0 ? 0 : 1);
