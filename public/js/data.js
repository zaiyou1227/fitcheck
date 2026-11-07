/* ===========================================================
   数据层
   - 唯一入口是 localStorage 里的一个 key：dachu.v1
   - 所有数值都带上单位存储（单位跟着数值走），换设备/换单位都不丢真值
   - 自带导出 / 导入 / 链接分享，避免“清个缓存全没了”
   =========================================================== */

(function (global) {
  "use strict";

  var KEY = "dachu.v1";
  var SCHEMA = 1;

  // ---------- 单位 ----------
  // 长度基准：cm ；重量基准：kg
  var LEN_FACTOR = { cm: 1, in: 2.54, cun: 100 / 30 };
  var WT_FACTOR  = { kg: 1, jin: 0.5 };
  var LEN_LABEL  = { cm: "cm", in: "in", cun: "寸" };
  var WT_LABEL   = { kg: "kg", jin: "斤" };
  var LEN_NAME   = { cm: "厘米", in: "英寸", cun: "市寸" };
  var WT_NAME    = { kg: "公斤", jin: "斤" };
  var LB_PER_KG  = 2.20462;

  // ---------- 部位定义 ----------
  var PARTS = [
    { grp: "颈肩", items: [
      { k: "neck",    t: "颈围", alias: "脖围 / 领围（净）", unit: "len",
        d: "脖子最粗处一圈。衬衫领围 ≈ 颈围 + 1.5cm" },
      { k: "shoulder", t: "肩宽", alias: "肩宽 / 肩距", unit: "len",
        d: "左肩峰到右肩峰，不绕脖子。对应上衣的「肩宽」" },
      { k: "shoulderRound", t: "肩围", alias: "肩一圈", unit: "len",
        d: "可选。肩头绕一圈，判断肩部够不够宽松" }
    ]},
    { grp: "躯干", items: [
      { k: "chest", t: "胸围", alias: "胸围 / 上胸围", unit: "len",
        d: "胸口最丰满处一圈，软尺水平。上衣胸围要留松量" },
      { k: "waist", t: "腰围", alias: "腰围（最细处）", unit: "len",
        d: "躯干最细处，不是裤腰位置。裤腰位置看下面的「腹围」" },
      { k: "belly", t: "腹围", alias: "肚子围 / 中围", unit: "len",
        d: "腰以下肚子最凸处一圈。大体重常腹围 > 腰围，裤腰按它算" },
      { k: "hip",   t: "臀围", alias: "臀围 / 坐围", unit: "len",
        d: "臀部最丰满处一圈" }
    ]},
    { grp: "手臂", items: [
      { k: "armLen", t: "臂长（肩点→腕）", alias: "sleeve length（西式）", unit: "len",
        d: "从肩峰沿手臂外侧量到手腕骨。对应「肩点量」袖长" },
      { k: "armLenBack", t: "全袖长（后颈→腕）", alias: "中式袖长 / 后中袖长", unit: "len",
        d: "从后颈点经肩点到手腕骨。比上面长 9–12cm，买前问清量法" },
      { k: "upperArm", t: "上臂围", alias: "臂根围 / 袖肥（净）", unit: "len",
        d: "手臂最粗处一圈。对应袖子的「袖肥」，要留 3–5cm" },
      { k: "forearm", t: "前臂围", alias: "小臂围", unit: "len",
        d: "可选。小臂最粗处。袖口太紧会卡在这" },
      { k: "wrist",  t: "手腕围", alias: "腕围", unit: "len",
        d: "可选。对应袖口尺寸" }
    ]},
    { grp: "腿", items: [
      { k: "thigh", t: "大腿围", alias: "腿围 / 大腿根围", unit: "len",
        d: "大腿根部最粗处，单腿一圈。★ 最容易翻车的项" },
      { k: "knee",  t: "膝围", alias: "膝盖围", unit: "len",
        d: "膝盖一圈。锥形裤 / 紧身裤要看" },
      { k: "calf",  t: "小腿围", alias: "小腿肚围", unit: "len",
        d: "小腿最粗处一圈。可选，锥形裤必看" },
      { k: "ankle", t: "脚踝围", alias: "踝围", unit: "len",
        d: "脚踝最细处一圈。紧身裤 / 收口裤要看" },
      { k: "rise",  t: "立裆深", alias: "直裆 / 上裆", unit: "len",
        d: "坐着量：裤腰位置到椅面的垂直距离。★ 换算后裆长用" },
      { k: "backRise", t: "后臀深", alias: "后浪（身上）", unit: "len",
        d: "坐在硬椅上，从后腰中点到椅面的垂直距离" },
      { k: "inseam", t: "内长（腿长）", alias: "内长 / inseam", unit: "len",
        d: "裆底沿内侧量到脚踝" },
      { k: "outseam", t: "外长", alias: "裤长（身上）", unit: "len",
        d: "腰侧到脚踝外侧。对应「裤长」" }
    ]},
    { grp: "体重", items: [
      { k: "weight", t: "体重", alias: "重量", unit: "wt",
        d: "只用来记录和判断尺码档位，不直接参与成衣推算" }
    ]}
  ];

  var PART_MAP = {};
  PARTS.forEach(function (g) {
    g.items.forEach(function (it) { PART_MAP[it.k] = it; });
  });

  // ---------- 默认结构 ----------
  function blank() {
    return {
      schema: SCHEMA,
      savedAt: null,
      units: { len: "cm", wt: "kg" },
      items: {},          // { chest: { v: 130, u: "cm" }, weight: { v: 150, u: "kg" } }
      prefs: { fabric: "none" },
      guide: {},          // 筛店清单 { flat: true, ... }
      shorts: []          // 自定义短记（预留给以后）
    };
  }

  var cache = null;

  function available() {
    try {
      var t = "__dachu_probe__";
      global.localStorage.setItem(t, "1");
      global.localStorage.removeItem(t);
      return true;
    } catch (e) { return false; }
  }

  function read() {
    if (cache) return cache;
    var data = blank();
    if (available()) {
      try {
        var raw = global.localStorage.getItem(KEY);
        if (raw) {
          var o = JSON.parse(raw);
          data = normalize(o);
        }
      } catch (e) { /* 损坏就当作空档案，不让页面崩 */ }
    }
    cache = data;
    return cache;
  }

  function normalize(o) {
    var d = blank();
    if (!o || typeof o !== "object") return d;
    d.savedAt = typeof o.savedAt === "string" ? o.savedAt : null;
    if (o.units && LEN_FACTOR[o.units.len]) d.units.len = o.units.len;
    if (o.units && WT_FACTOR[o.units.wt])   d.units.wt  = o.units.wt;
    if (o.prefs && o.prefs.fabric) d.prefs.fabric = String(o.prefs.fabric);
    if (o.guide && typeof o.guide === "object") {
      Object.keys(o.guide).forEach(function (k) {
        if (o.guide[k] === true) d.guide[k] = true;
      });
    }
    if (o.items && typeof o.items === "object") {
      Object.keys(o.items).forEach(function (k) {
        var it = o.items[k];
        if (!it || typeof it !== "object") return;
        var v = Number(it.v);
        if (!isFinite(v) || v <= 0) return;
        var def = PART_MAP[k];
        if (!def) return;
        var u = it.u;
        var ok = def.unit === "wt" ? WT_FACTOR[u] : LEN_FACTOR[u];
        if (!ok) u = def.unit === "wt" ? d.units.wt : d.units.len;
        d.items[k] = { v: v, u: u };
      });
    }
    return d;
  }

  function write(data) {
    data.schema = SCHEMA;
    cache = data;
    if (!available()) return false;
    try {
      global.localStorage.setItem(KEY, JSON.stringify(data));
      return true;
    } catch (e) { return false; }
  }

  // ---------- 取值（统一换成基准单位） ----------
  function raw(k) {
    var d = read();
    var v = d.items[k];
    return v && isFinite(v.v) && v.v > 0 ? v : null;
  }

  function getCm(k) {
    var v = raw(k);
    if (!v) return null;
    var def = PART_MAP[k];
    var f = def.unit === "wt" ? WT_FACTOR[v.u] : LEN_FACTOR[v.u];
    return f ? v.v * f : null;
  }

  function getKg(k) {
    var v = raw(k);
    if (!v) return null;
    return v.v * (WT_FACTOR[v.u] || 1);
  }

  function has(k) { return getCm(k) !== null; }

  // ---------- 写入 ----------
  function setItem(k, value, unit) {
    var d = read();
    var def = PART_MAP[k];
    if (!def) return;
    var v = Number(value);
    if (!isFinite(v) || v <= 0) {
      delete d.items[k];
    } else {
      var u = unit;
      var ok = def.unit === "wt" ? WT_FACTOR[u] : LEN_FACTOR[u];
      if (!ok) u = def.unit === "wt" ? d.units.wt : d.units.len;
      d.items[k] = { v: v, u: u };
    }
    d.savedAt = new Date().toISOString();
    write(d);
  }

  function setUnit(kind, unit) {
    var d = read();
    if (kind === "len" && LEN_FACTOR[unit]) d.units.len = unit;
    if (kind === "wt" && WT_FACTOR[unit])  d.units.wt  = unit;
    write(d);
  }

  function setPref(k, v) {
    var d = read();
    if (k === "fabric") d.prefs.fabric = v;
    write(d);
  }

  function getPref(k) { return read().prefs[k]; }

  function setGuide(key, on) {
    var d = read();
    if (on) d.guide[key] = true; else delete d.guide[key];
    d.savedAt = new Date().toISOString();
    write(d);
  }

  function clearAll() {
    cache = blank();
    if (available()) {
      try { global.localStorage.removeItem(KEY); } catch (e) {}
    }
  }

  // ---------- 单位换算显示 ----------
  // 把 cm 值格式化成三单位一行的字符串
  function convCm(cm) {
    if (cm === null || !isFinite(cm)) return "";
    return "= " + fmt(cm) + " cm · " + fmt(cm / LEN_FACTOR.in) + " in · " +
           fmt(cm / LEN_FACTOR.cun) + " 寸";
  }
  function convKg(kg) {
    if (kg === null || !isFinite(kg)) return "";
    return "= " + fmt(kg) + " 公斤 · " + fmt(kg / WT_FACTOR.jin) + " 斤 · " +
           fmt(kg * LB_PER_KG) + " 磅";
  }

  function fmt(x) {
    if (x === null || !isFinite(x)) return "";
    var r = Math.round(x * 10) / 10;
    return String(r).replace(/\.0$/, "");
  }
  function fmtHalf(x) {
    var r = Math.round(x * 2) / 2;
    return String(r).replace(/\.0$/, "");
  }

  // 按当前单位给出"输入框里应显示的值"
  // 关键：如果当前单位等于用户当初输入的单位，直接回显原值，保证切换单位能原路返回
  function displayValue(k) {
    var v = raw(k);
    if (!v) return "";
    var def = PART_MAP[k];
    var cur = def.unit === "wt" ? read().units.wt : read().units.len;
    if (v.u === cur) return fmt(v.v);
    var f = def.unit === "wt" ? WT_FACTOR[v.u] : LEN_FACTOR[v.u];
    var base = v.v * f;
    var out = def.unit === "wt" ? base / WT_FACTOR[cur] : base / LEN_FACTOR[cur];
    return fmt(out);
  }

  // ---------- 导出 / 导入 ----------
  function exportJSON() {
    var d = read();
    d.savedAt = new Date().toISOString();
    return JSON.stringify(d, null, 2);
  }

  function importJSON(text) {
    var o = JSON.parse(text);
    var d = normalize(o);
    return write(d);
  }

  // ---------- 链接分享（压缩后放 hash） ----------
  function encodeShare() {
    var d = read();
    var payload = {
      s: SCHEMA,
      u: d.units,
      p: d.prefs,
      i: {}
    };
    Object.keys(d.items).forEach(function (k) {
      var it = d.items[k];
      payload.i[k] = [it.v, it.u];
    });
    var json = JSON.stringify(payload);
    if (global.LZString) return "v1." + global.LZString.compressToEncodedURIComponent(json);
    return "j1." + encodeURIComponent(json);
  }

  function decodeShare(token) {
    if (!token) return null;
    try {
      var json;
      if (token.indexOf("v1.") === 0) {
        if (!global.LZString) return null;
        json = global.LZString.decompressFromEncodedURIComponent(token.slice(3));
      } else if (token.indexOf("j1.") === 0) {
        json = decodeURIComponent(token.slice(3));
      } else {
        return null;
      }
      if (!json) return null;
      var p = JSON.parse(json);
      var d = blank();
      d.units = p.u || d.units;
      d.prefs = p.p || d.prefs;
      Object.keys(p.i || {}).forEach(function (k) {
        var pair = p.i[k];
        if (Array.isArray(pair) && isFinite(pair[0]) && PART_MAP[k]) {
          d.items[k] = { v: Number(pair[0]), u: pair[1] };
        }
      });
      return normalize(d);
    } catch (e) { return null; }
  }

  // ---------- 对外 ----------
  global.DachuData = {
    PARTS: PARTS,
    PART_MAP: PART_MAP,
    LEN_FACTOR: LEN_FACTOR,
    WT_FACTOR: WT_FACTOR,
    LEN_LABEL: LEN_LABEL,
    WT_LABEL: WT_LABEL,
    LEN_NAME: LEN_NAME,
    WT_NAME: WT_NAME,

    read: read,
    raw: raw,
    getCm: getCm,
    getKg: getKg,
    has: has,
    setItem: setItem,
    setUnit: setUnit,
    setPref: setPref,
    getPref: getPref,
    setGuide: setGuide,
    clearAll: clearAll,
    available: available,

    convCm: convCm,
    convKg: convKg,
    fmt: fmt,
    fmtHalf: fmtHalf,
    displayValue: displayValue,

    exportJSON: exportJSON,
    importJSON: importJSON,
    encodeShare: encodeShare,
    decodeShare: decodeShare,

    KEY: KEY
  };
})(window);
