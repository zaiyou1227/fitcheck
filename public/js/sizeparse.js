/* ===========================================================
   尺寸表解析 + 匹配引擎
   -----------------------------------------------------------
   设计目标：不绑定任何平台。输入 HTML 或文本，输出规范化尺寸表，
   再和用户身体数据比对打分。所以它不只服务大码。

   三段：
   1. 解析 parseTable(textOrHtml) → { rows, fields, confidence }
   2. 匹配 match(product, body, options) → 每个尺码的结论
   3. 汇总 rank(products) → 按可穿性排序
   =========================================================== */

(function (global) {
  "use strict";

  // ---------- 字段词典 ----------
  // key 统一，aliases 覆盖平台常见叫法
  var FIELDS = [
    { k: "shoulder", t: "肩宽", aliases: ["肩宽", "肩阔", "肩距"] },
    // 上胸围和胸围在衣服上是一回事，合并成同一个 key，避免同一列被重复统计
    { k: "chest",    t: "胸围", aliases: ["上胸围", "胸围", "胸阔", "胸宽"] },
    { k: "length",   t: "衣长", aliases: ["衣长", "衫长", "上衣长", "全长"] },
    { k: "sleeve",   t: "袖长", aliases: ["袖长", "袖长（肩点）", "肩袖长"] },
    { k: "sleeveCuff", t: "袖口", aliases: ["袖口", "袖口围"] },
    { k: "neck",     t: "领围", aliases: ["领围", "领宽", "领口"] },
    { k: "waist",    t: "腰围", aliases: ["腰围", "腰头", "腰宽"] },
    { k: "hip",      t: "臀围", aliases: ["臀围", "坐围", "髋围"] },
    { k: "thigh",    t: "大腿围", aliases: ["大腿围", "腿围", "大腿宽"] },
    { k: "knee",     t: "膝围", aliases: ["膝围", "膝盖围"] },
    { k: "legOpening", t: "脚口", aliases: ["脚口", "裤脚", "裤口", "脚口围"] },
    { k: "frontRise", t: "前裆", aliases: ["前裆", "前浪", "前直裆"] },
    { k: "backRise", t: "后裆", aliases: ["后裆", "后浪", "后直裆", "上裆"] },
    { k: "pantLength", t: "裤长", aliases: ["裤长", "外长", "外侧长"] },
    { k: "inseam",   t: "内长", aliases: ["内长", "内侧长", "内裆长"] },
    { k: "weight",   t: "建议体重", aliases: ["体重", "建议体重", "参考体重"] },
    { k: "height",   t: "建议身高", aliases: ["身高", "建议身高", "参考身高"] }
  ];

  var FIELD_BY_ALIAS = {};
  FIELDS.forEach(function (f) {
    f.aliases.forEach(function (a) { FIELD_BY_ALIAS[a] = f; });
  });

  // 查字段：先精确匹配，再剥掉括号/单位/星号后匹配
  // 真实表格里全是 "胸围(cm)"、"腰围（厘米）"、"肩宽*" 这种写法
  function lookupField(rawName) {
    var s = String(rawName || "").trim();
    if (!s) return null;
    if (FIELD_BY_ALIAS[s]) return FIELD_BY_ALIAS[s];

    var cleaned = s
      .replace(/[（(][^）)]*[）)]/g, "")   // 括号内容
      .replace(/[\s*＊:：]/g, "")          // 空白、星号、冒号
      .replace(/\d+(?:\.\d+)?/g, "");      // 残留数字

    if (FIELD_BY_ALIAS[cleaned]) return FIELD_BY_ALIAS[cleaned];

    // 模糊：包含某个别名即可（取最长的别名，避免"胸围"命中"上胸围"的歧义）
    var best = null, bestLen = 0;
    Object.keys(FIELD_BY_ALIAS).forEach(function (a) {
      if (cleaned.indexOf(a) >= 0 && a.length > bestLen) {
        best = FIELD_BY_ALIAS[a];
        bestLen = a.length;
      }
    });
    return best;
  }

  // 品类关键词 → 用于推断这件商品是裤/上衣/外套
  var CATEGORY_RULES = [
    { cat: "pants",   re: /裤|牛仔|休闲裤|运动裤|西裤|阔腿|直筒|工装裤|短裤/ },
    { cat: "coat",    re: /外套|夹克|大衣|风衣|羽绒|棉服|马甲|卫衣|毛衣/ },
    { cat: "top",     re: /衬衫|T恤|t恤|上衣|针织|打底|polo|POLO|短袖|长袖/ }
  ];

  // 尺码标签归一
  var SIZE_RE = /^(?:[2-9]?X{0,4}[LSM]|X{1,5}L|S|M|L|XL|XXL|XXXL|[2-9]XL|均码|均一|F|FREE|\d{2,3}(?:码)?|\d{2,3}\/\d{2,3}|[A-Z]\d{0,2})$/i;

  function normLabel(s) {
    return String(s || "").trim().toUpperCase().replace(/\s+/g, "");
  }

  function isSizeLabel(s) {
    var t = normLabel(s);
    if (!t) return false;
    if (SIZE_RE.test(t)) return true;
    // 170/88A 这类国标尺码
    if (/^\d{3}\/\d{2,3}[A-C]?$/i.test(t)) return true;
    return false;
  }

  // ---------- 单位与数值 ----------
  // 返回厘米值；识别 "72-74"、"74±1"、"2尺4"、"30英寸"
  function parseValue(raw) {
    if (raw === null || raw === undefined) return null;
    var s = String(raw).trim();
    if (!s || /^[-—–/]+$/.test(s)) return null;

    // 2尺4 / 2.4尺 / 2尺8寸（必须在通用数字提取之前判断）
    var chi = s.match(/(\d+(?:\.\d+)?)\s*尺\s*(\d+(?:\.\d+)?)?/);
    if (chi) {
      var zhang = parseFloat(chi[1]);
      var cun = chi[2] ? parseFloat(chi[2]) : 0;
      return round1(zhang * 33.33 + cun * 3.333);
    }
    // 英寸
    var inch = s.match(/(\d+(?:\.\d+)?)\s*(?:英寸|inch|in\b|")/i);
    if (inch) return round1(parseFloat(inch[1]) * 2.54);
    // 厘米（显式）
    var cm = s.match(/(\d+(?:\.\d+)?)\s*(?:cm|厘米|公分)/i);
    if (cm) return round1(parseFloat(cm[1]));

    // 区间 / 近似：取第一个数
    var num = s.match(/-?\d+(?:\.\d+)?/);
    if (!num) return null;
    var v = parseFloat(num[0]);
    if (!isFinite(v) || v <= 0) return null;
    return round1(v);
  }

  function round1(x) { return Math.round(x * 10) / 10; }

  // ---------- HTML → 文本网格 ----------
  // 不依赖 document，用正则做轻量清洗，方便在 Node 里测
  function htmlToText(html) {
    var s = String(html || "");
    // 去掉脚本、样式、注释
    s = s.replace(/<script[\s\S]*?<\/script>/gi, " ");
    s = s.replace(/<style[\s\S]*?<\/style>/gi, " ");
    s = s.replace(/<!--[\s\S]*?-->/g, " ");
    // 块级元素转换行
    s = s.replace(/<\/?(?:div|p|li|tr|br|h[1-6]|section|article|table|thead|tbody|ul|ol)[^>]*>/gi, "\n");
    // td/th 转换行符制表
    s = s.replace(/<\/?(?:td|th)[^>]*>/gi, "\t");
    // 其余标签去掉
    s = s.replace(/<[^>]+>/g, " ");
    // 实体
    s = s.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
         .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"');
    // 空白归一
    s = s.replace(/[ \u00a0]+/g, " ");
    s = s.replace(/\n\s*\n+/g, "\n");
    return s.trim();
  }

  // HTML 里的表格优先解析（结构最可靠）
  function parseHtmlTable(html) {
    var tables = String(html || "").match(/<table[\s\S]*?<\/table>/gi) || [];
    var best = null;
    tables.forEach(function (tb) {
      var rows = [];
      var trs = tb.match(/<tr[\s\S]*?<\/tr>/gi) || [];
      trs.forEach(function (tr) {
        var cells = [];
        var re = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi, m;
        while ((m = re.exec(tr)) !== null) {
          var txt = htmlToText(m[1]).replace(/\n/g, " ").trim();
          cells.push(txt);
        }
        if (cells.length) rows.push(cells);
      });
      // 至少要 2 行 2 列
      if (rows.length >= 2 && rows[0].length >= 2) {
        var score = rows.length * rows[0].length;
        if (!best || score > best.score) best = { rows: rows, score: score };
      }
    });
    return best ? best.rows : null;
  }

  // ---------- 矩阵 → 结构化 ----------
  // 支持两种常见布局：
  //  A) 首行是字段名（横向），首列是尺码
  //  B) 首列是字段名（纵向），首行是尺码
  function matrixToTable(rows) {
    if (!rows || !rows.length) return null;

    var head = rows[0].map(function (c) { return String(c).trim(); });
    var firstCol = rows.map(function (r) { return String(r[0] || "").trim(); });

    var fieldsInHead = head.filter(function (h) { return lookupField(h); }).length;
    var fieldsInFirstCol = firstCol.filter(function (c) { return lookupField(c); }).length;
    var sizesInFirstCol = firstCol.filter(isSizeLabel).length;

    // A) 横向：首行含字段名
    if (fieldsInHead >= 1 && fieldsInHead >= fieldsInFirstCol) {
      return readHorizontal(rows);
    }
    // B) 纵向：首列含字段名，其余列是尺码
    if (fieldsInFirstCol >= 1) {
      return readVertical(rows);
    }
    // C) 首列是尺码（没有字段名行）——无法确定语义，返回列名
    if (sizesInFirstCol >= 2) {
      return { sizeCol: 0, columns: head, rows: rows.slice(0), layout: "size-first" };
    }
    return null;
  }

  function readHorizontal(rows) {
    var head = rows[0];
    // 找到每个字段所在的列
    var colField = {};
    head.forEach(function (h, i) {
      var f = lookupField(h);
      if (f && colField[i] === undefined) colField[i] = f.k;
    });
    // 尺码列：通常是第一列或表头写着"尺码/规格/码数"
    var sizeCol = 0;
    head.forEach(function (h, i) {
      if (/^(尺码|码数|规格|size|型号)$/i.test(h)) sizeCol = i;
    });

    var out = [];
    rows.slice(1).forEach(function (r) {
      var label = String(r[sizeCol] || "").trim();
      if (!label) return;
      if (!isSizeLabel(label) && !/^\d{2,3}$/.test(label)) return;
      var vals = {};
      Object.keys(colField).forEach(function (i) {
        var v = parseValue(r[i]);
        if (v !== null) vals[colField[i]] = v;
      });
      if (Object.keys(vals).length) out.push({ size: label, values: vals });
    });
    return out.length >= 1 ? { rows: out, layout: "horizontal" } : null;
  }

  function readVertical(rows) {
    var head = rows[0];
    // 第一列是字段名
    var fieldRows = [];
    rows.forEach(function (r) {
      var name = String(r[0] || "").trim();
      var f = lookupField(name);
      if (f) fieldRows.push({ idx: rows.indexOf(r), key: f.k, name: name });
    });
    if (!fieldRows.length) return null;

    // 其它列是尺码
    var sizeCols = [];
    for (var c = 1; c < head.length; c++) {
      var h = String(head[c] || "").trim();
      if (h) sizeCols.push({ col: c, label: h });
    }
    // 有些表第一行是"项目/尺码/S/M/L"，第一格可能是空
    sizeCols = sizeCols.filter(function (s) {
      return isSizeLabel(s.label) || /^\d{2,3}$/.test(s.label) || /^[A-Za-z0-9/]+$/.test(s.label);
    });
    if (!sizeCols.length) return null;

    var out = sizeCols.map(function (s) { return { size: s.label, values: {} }; });
    fieldRows.forEach(function (fr) {
      var row = rows[fr.idx];
      sizeCols.forEach(function (s, i) {
        var v = parseValue(row[s.col]);
        if (v !== null) out[i].values[fr.key] = v;
      });
    });
    out = out.filter(function (o) { return Object.keys(o.values).length; });
    return out.length ? { rows: out, layout: "vertical" } : null;
  }

  // ---------- 纯文本解析 ----------
  // 处理粘贴过来的"胸围 130 衣长 72"这种键值对
  function parsePlainText(text) {
    var s = String(text || "").replace(/\r/g, "");
    var lines = s.split("\n").map(function (l) { return l.trim(); }).filter(Boolean);
    if (!lines.length) return null;

    // 1) 制表符/多空格分隔 → 当作矩阵
    var matrix = lines
      .filter(function (l) { return /\t|\s{2,}/.test(l); })
      .map(function (l) { return l.split(/\t|\s{2,}/).map(function (c) { return c.trim(); }); });
    if (matrix.length >= 2) {
      var mt = matrixToTable(matrix);
      if (mt) return mt;
    }

    // 2) 同一行里 "胸围130 衣长72 肩宽58" → 单条记录
    //    数值部分要连单位一起捕获，否则 "2尺8" 会被截成 "2"；
    //    中文尺的"寸"尾数要单独吃进来
    var pairs = [];
    var NUM = "-?\\d+(?:\\.\\d+)?(?:\\s*[-~–～]\\s*\\d+(?:\\.\\d+)?)?";
    var UNIT = "(?:英寸|寸|尺|厘米|公分|mm|毫米|cm|inch|in)?";
    var re = new RegExp(
      "([\\u4e00-\\u9fa5A-Za-z]{2,6})\\s*[：:＝=]?\\s*(" + NUM + "\\s*" + UNIT + "(?:\\s*\\d+(?:\\.\\d+)?)?)",
      "gi"
    );
    var m;
    while ((m = re.exec(s)) !== null) {
      var name = m[1].trim();
      var f = lookupField(name);
      if (!f) continue;
      // "2尺 8" → "2尺8"，方便 parseValue 按中文尺解析
      var rawVal = m[2].replace(/\s+/g, "");
      pairs.push({ key: f.k, val: parseValue(rawVal) });
    }
    if (pairs.length >= 1) {
      var vals = {};
      pairs.forEach(function (p) { if (p.val !== null && vals[p.key] === undefined) vals[p.key] = p.val; });
      if (Object.keys(vals).length) {
        return { rows: [{ size: "（当前商品）", values: vals }], layout: "kv" };
      }
    }
    return null;
  }

  // ---------- 对外：解析入口 ----------
  function parse(input) {
    var raw = String(input || "").trim();
    if (!raw) return { ok: false, reason: "empty", rows: [], fields: [] };

    var result = null;
    var isHtml = /<[a-zA-Z][\s\S]*>/.test(raw);

    if (isHtml) {
      var tableRows = parseHtmlTable(raw);
      if (tableRows) {
        result = matrixToTable(tableRows);
        if (result) result.source = "html-table";
      }
      if (!result) {
        var txt = htmlToText(raw);
        result = parsePlainText(txt);
        if (result) result.source = "html-text";
      }
    } else {
      result = parsePlainText(raw);
      if (result) result.source = "text";
    }

    if (!result || !result.rows.length) {
      return { ok: false, reason: "no-table", rows: [], fields: [] };
    }

    var fieldsUsed = {};
    result.rows.forEach(function (r) {
      Object.keys(r.values).forEach(function (k) { fieldsUsed[k] = (fieldsUsed[k] || 0) + 1; });
    });

    var fieldList = Object.keys(fieldsUsed).map(function (k) {
      var def = null;
      FIELDS.forEach(function (f) { if (f.k === k) def = f; });
      return { key: k, name: def ? def.t : k, count: fieldsUsed[k] };
    });

    return {
      ok: true,
      source: result.source,
      layout: result.layout,
      rows: result.rows,
      fields: fieldList,
      confidence: confidence(result.rows, fieldList)
    };
  }

  function confidence(rows, fields) {
    // 行数越多、字段越全，越可信
    var f = fields.length;
    var r = rows.length;
    var score = 0.35 + Math.min(f, 8) * 0.06 + Math.min(r, 6) * 0.03;
    return Math.min(0.97, round1(score * 100) / 100);
  }

  // ---------- 品类推断 ----------
  function guessCategory(text) {
    var s = String(text || "");
    for (var i = 0; i < CATEGORY_RULES.length; i++) {
      if (CATEGORY_RULES[i].re.test(s)) return CATEGORY_RULES[i].cat;
    }
    return "unknown";
  }

  // 从尺码表字段反推品类
  function guessCategoryFromFields(fields) {
    var keys = fields.map(function (f) { return f.key; });
    var pantsLike = ["thigh", "frontRise", "backRise", "pantLength", "hip", "legOpening"]
      .filter(function (k) { return keys.indexOf(k) >= 0; }).length;
    var topLike = ["chest", "shoulder", "sleeve", "length"]
      .filter(function (k) { return keys.indexOf(k) >= 0; }).length;
    if (pantsLike > topLike) return "pants";
    if (topLike > 0) return "top";
    return "unknown";
  }

  // ---------- 匹配规则 ----------
  // 每个部位：min 最低松量、ideal 理想松量区间、max 最大松量、weight 权重
  // soft=true 表示"偏小不致命"（比如腰围偏小，可以当低腰穿或选弹性款）
  // onlyMin=true 表示"只能偏大"（后裆偏长只是裤腰高，不算穿不下）
  var FIT_RULES = {
    pants: {
      waist:      { name: "腰围", min: 0, ideal: [2, 8], max: 14, weight: 1.2, soft: true },
      hip:        { name: "臀围", min: 2, ideal: [3, 10], max: 18, weight: 1.1 },
      thigh:      { name: "大腿围", min: 4, ideal: [5, 12], max: 20, weight: 1.6 },
      backRise:   { name: "后裆", min: 0, ideal: [2, 8], max: 16, weight: 1.4, onlyMin: true },
      frontRise:  { name: "前裆", min: 0, ideal: [1, 6], max: 12, weight: 0.9, onlyMin: true },
      knee:       { name: "膝围", min: 4, ideal: [5, 12], max: 20, weight: 0.7, soft: true },
      legOpening: { name: "脚口", min: 4, ideal: [6, 18], max: 40, weight: 0.4, onlyMin: true },
      pantLength: { name: "裤长", min: -3, ideal: [-1, 2], max: 6, weight: 0.8, soft: true }
    },
    top: {
      chest:    { name: "胸围", min: 3, ideal: [5, 12], max: 22, weight: 1.6 },
      shoulder: { name: "肩宽", min: -0.5, ideal: [0, 2.5], max: 5, weight: 1.2, soft: true },
      sleeve:   { name: "袖长", min: -1.5, ideal: [0, 3], max: 10, weight: 0.6, onlyMin: true },
      length:   { name: "衣长", min: -5, ideal: [-2, 6], max: 20, weight: 0.7, onlyMin: true },
      neck:     { name: "领围", min: 0.5, ideal: [1, 4], max: 8, weight: 0.5, onlyMin: true }
    },
    coat: {
      chest:    { name: "胸围", min: 5, ideal: [7, 16], max: 28, weight: 1.6 },
      shoulder: { name: "肩宽", min: 0, ideal: [0.5, 3], max: 6, weight: 1.2, soft: true },
      sleeve:   { name: "袖长", min: -1.5, ideal: [0, 3], max: 10, weight: 0.6, onlyMin: true },
      length:   { name: "衣长", min: -5, ideal: [-2, 8], max: 24, weight: 0.6, onlyMin: true }
    }
  };

  // 身体数据（cm）→ 对应成衣指标的身体值
  // 注意：有些成衣指标无法从身体数据直接推，返回 null 表示不参与
  function bodyTargets(cat, body) {
    var t = {};
    // 腰：用腹围和腰围中较大的
    if (body.belly !== null && body.waist !== null) t.waist = Math.max(body.belly, body.waist);
    else t.waist = body.belly !== null ? body.belly : body.waist;
    t.hip = body.hip;
    t.thigh = body.thigh;
    t.knee = body.knee;
    // 后裆由立裆深推（经验值 +8）
    t.backRise = body.rise !== null ? body.rise + 8 : null;
    t.frontRise = body.rise !== null ? body.rise - 6 : null;
    t.pantLength = body.outseam;
    t.chest = body.chest;
    t.shoulder = body.shoulder;
    t.sleeve = body.armLen;
    t.neck = body.neck;
    t.length = null; // 衣长依赖身高/体型偏好，不做自动判断
    t.legOpening = null;
    return t;
  }

  // ---------- 单个尺码打分 ----------
  // 成衣实测值 − 身体净围 = 松量
  function scoreSize(cat, sizeRow, bodyCm, fabric) {
    var rules = FIT_RULES[cat] || FIT_RULES.top;
    var targets = bodyTargets(cat, bodyCm);
    var adjust = fabric === "high" ? -0.5 : (fabric === "none" ? 0 : -0.25);

    var details = [];
    var totalWeight = 0, gotWeight = 0;
    var hardFail = null;     // 真的穿不下（太小）
    var tooBig = null;       // 偏大，但仍能穿

    Object.keys(rules).forEach(function (key) {
      var rule = rules[key];
      var garmentVal = sizeRow.values[key];
      var bodyVal = targets[key];
      if (garmentVal === undefined || bodyVal === null || bodyVal === undefined) return;

      totalWeight += rule.weight;

      var ease = round1(garmentVal - bodyVal);
      var minEase = rule.min + adjust * 2;
      var maxEase = rule.max + adjust * 4;
      var idealLo = rule.ideal[0] + adjust * 2;
      var idealHi = rule.ideal[1] + adjust * 4;
      if (rule.onlyMin) maxEase = Math.max(maxEase, idealHi + 30); // 只卡下限

      var verdict, ratio;
      if (ease < minEase) {
        // 偏小：soft 项扣分但不算致命；非 soft 项直接判穿不下
        verdict = "too-small";
        ratio = rule.soft ? 0.18 : 0;
      } else if (ease > maxEase) {
        verdict = "too-big";
        ratio = 0.35;
      } else {
        verdict = "ok";
        if (ease >= idealLo && ease <= idealHi) ratio = 1;
        else if (ease < idealLo) ratio = 0.72 + 0.28 * (ease - minEase) / Math.max(0.1, idealLo - minEase);
        else ratio = 0.72 + 0.28 * (maxEase - ease) / Math.max(0.1, maxEase - idealHi);
      }

      gotWeight += rule.weight * ratio;

      details.push({
        key: key, name: rule.name, garment: garmentVal, body: bodyVal,
        ease: ease, verdict: verdict, ratio: Math.round(ratio * 100) / 100,
        weight: rule.weight,
        fatal: (verdict === "too-small" && !rule.soft) ? (rule.weight >= 1.0) : false
      });

      // 非 soft 项偏小 → 真的穿不下
      if (verdict === "too-small" && !rule.soft && rule.weight >= 1.0 && !hardFail) {
        hardFail = rule.name + " 小 " + Math.abs(ease).toFixed(1) + "cm";
      }
      // 偏大 → 只是号大，不算穿不下
      if (verdict === "too-big" && rule.weight >= 1.0 && !tooBig) {
        tooBig = rule.name + " 大 " + ease.toFixed(1) + "cm";
      }
    });

    var score = gotWeight > 0 ? gotWeight / totalWeight : 0;

    var label;
    // 判定顺序：先"根本穿不下"，再"号不对"，最后才是"能穿"
    if (hardFail) label = "穿不下";
    else if (tooBig && score < 0.82) label = "偏大";
    else if (score >= 0.82) label = "很合适";
    else if (score >= 0.62) label = "可以穿";
    else label = "偏紧";

    return {
      size: sizeRow.size,
      score: Math.round(score * 100) / 100,
      label: label,
      hardFail: hardFail,
      tooBig: tooBig,
      details: details
    };
  }

  // ---------- 商品级匹配 ----------
  function match(product, bodyCm, options) {
    var opts = options || {};
    var cat = product.category && product.category !== "unknown"
      ? product.category
      : guessCategoryFromFields(product.parsed.fields || []);
    var fabric = opts.fabric || "none";

    var scored = (product.parsed.rows || []).map(function (row) {
      return scoreSize(cat, row, bodyCm, fabric);
    });
    scored.sort(function (a, b) { return b.score - a.score; });

    var best = scored.length ? scored[0] : null;
    var fitting = scored.filter(function (s) { return s.label === "很合适" || s.label === "可以穿"; });

    return {
      category: cat,
      best: best,
      all: scored,
      fittingCount: fitting.length,
      verdict: !best ? "无法判断" : best.label
    };
  }

  // ---------- 批量排序 ----------
  function rank(products, bodyCm, options) {
    var out = products.map(function (p) {
      var m = match(p, bodyCm, options);
      return {
        product: p,
        match: m,
        sortKey: m.best ? m.best.score : 0,
        fitOk: m.best ? (m.best.label === "很合适" || m.best.label === "可以穿") : false
      };
    });
    out.sort(function (a, b) {
      if (a.fitOk !== b.fitOk) return a.fitOk ? -1 : 1;
      return b.sortKey - a.sortKey;
    });
    return out;
  }

  // ---------- 对外 ----------
  global.SizeParse = {
    FIELDS: FIELDS,
    FIT_RULES: FIT_RULES,
    parse: parse,
    parseHtmlTable: parseHtmlTable,
    htmlToText: htmlToText,
    matrixToTable: matrixToTable,
    parseValue: parseValue,
    guessCategory: guessCategory,
    guessCategoryFromFields: guessCategoryFromFields,
    bodyTargets: bodyTargets,
    scoreSize: scoreSize,
    match: match,
    rank: rank,
    isSizeLabel: isSizeLabel
  };
})(typeof window !== "undefined" ? window : globalThis);
