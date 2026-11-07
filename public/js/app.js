/* ===========================================================
   共享 UI：底部导航、toast、单位换算组件、数据备份入口
   =========================================================== */

(function (global) {
  "use strict";

  var D = global.DachuData;

  // ---------- 导航 ----------
  var NAV = [
    { href: "index.html",   label: "首页", icon: "home" },
    { href: "profile.html", label: "尺码档案", icon: "ruler" },
    { href: "pants.html",   label: "裤子", icon: "pants" },
    { href: "guide.html",   label: "筛店", icon: "shop" }
  ];

  var ICON = {
    home: '<path d="M3.2 10.4 12 3.4l8.8 7v9.2a1 1 0 0 1-1 1h-5.2v-6.1H9.4v6.1H4.2a1 1 0 0 1-1-1z"/>',
    ruler: '<path d="M3.6 14.8 14.8 3.6l5.6 5.6L9.2 20.4z"/><path d="M7.2 11.2l1.7 1.7M10 8.4l1.7 1.7M12.8 5.6l1.7 1.7"/>',
    pants: '<path d="M8.2 3.2h7.6l1.1 17.6h-3.5l-1.4-10.6-1.4 10.6H7.1z"/><path d="M8.2 3.2v2.2h7.6V3.2"/>',
    shop: '<path d="M4 9.4h16l-1 11.4H5z"/><path d="M8.4 9.4V6.6a3.6 3.6 0 0 1 7.2 0v2.8"/>'
  };

  function renderNav() {
    var here = (global.location.pathname.split("/").pop() || "index.html").toLowerCase();
    var nav = document.createElement("nav");
    nav.className = "nav";
    nav.setAttribute("aria-label", "主导航");
    nav.innerHTML = NAV.map(function (n) {
      var cur = (n.href === here) ? ' aria-current="page"' : "";
      return '<a href="' + n.href + '"' + cur + '>' +
        '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICON[n.icon] + '</svg>' +
        '<span>' + n.label + '</span></a>';
    }).join("");
    document.body.appendChild(nav);
    // 桌面端标签只显示文字图标已足够；移动端保持图标+文字
  }

  // ---------- Toast ----------
  var toastEl = null, toastTimer = null;
  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "toast";
      toastEl.setAttribute("role", "status");
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove("show");
    }, 2200);
  }

  // ---------- 通用：复制文本（兼容不支持 clipboard 的浏览器） ----------
  function copyText(text) {
    if (global.navigator.clipboard && global.navigator.clipboard.writeText) {
      return global.navigator.clipboard.writeText(text).then(function () { return true; })
        .catch(function () { return fallbackCopy(text); });
    }
    return Promise.resolve(fallbackCopy(text));
  }
  function fallbackCopy(text) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "-1000px";
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }

  // ---------- 单位切换条 ----------
  // 渲染一个可复用的「长度单位 / 体重单位」选择条
  function mountUnitBar(host, onChange) {
    var d = D.read();
    var bar = document.createElement("div");
    bar.className = "card";
    bar.style.marginBottom = "14px";
    bar.innerHTML =
      '<div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center">' +
        '<span style="font-size:12px;color:var(--sub)">长度</span>' +
        '<div class="seg" id="uLenSeg" role="group" aria-label="长度单位">' +
          btn("cm", "厘米 cm") + btn("in", "英寸 in") + btn("cun", "市寸 寸") +
        '</div>' +
        '<span style="flex:1"></span>' +
        '<span style="font-size:12px;color:var(--sub)">体重</span>' +
        '<div class="seg" id="uWtSeg" role="group" aria-label="体重单位">' +
          btn("kg", "公斤 kg") + btn("jin", "斤") +
        '</div>' +
      '</div>';
    host.appendChild(bar);

    function btn(v, label) {
      return '<button data-v="' + v + '" aria-pressed="false" style="flex:0 0 auto;min-width:84px">' +
        label + '</button>';
    }
    function sync() {
      var cur = D.read();
      bar.querySelectorAll("#uLenSeg button").forEach(function (b) {
        b.setAttribute("aria-pressed", b.dataset.v === cur.units.len ? "true" : "false");
      });
      bar.querySelectorAll("#uWtSeg button").forEach(function (b) {
        b.setAttribute("aria-pressed", b.dataset.v === cur.units.wt ? "true" : "false");
      });
    }
    bar.addEventListener("click", function (ev) {
      var b = ev.target.closest("button");
      if (!b) return;
      if (b.closest("#uLenSeg")) D.setUnit("len", b.dataset.v);
      else D.setUnit("wt", b.dataset.v);
      sync();
      if (onChange) onChange();
    });
    sync();
    return { sync: sync };
  }

  // ---------- 数据备份面板 ----------
  function mountBackup(host, afterImport) {
    var box = document.createElement("div");
    box.className = "card";
    box.style.marginTop = "14px";
    box.innerHTML =
      '<h2>数据备份 <span class="tag">换手机 / 清缓存前必做</span></h2>' +
      '<p class="hint">数据只存在当前浏览器里。导出成文件或链接，换设备、清缓存都能找回。</p>' +
      '<div class="btnrow">' +
        '<button class="btn" data-act="export">导出文件</button>' +
        '<button class="btn ghost" data-act="link">复制分享链接</button>' +
        '<button class="btn ghost" data-act="import">导入文件</button>' +
      '</div>' +
      '<input type="file" accept="application/json,.json" hidden data-act="file">' +
      '<div class="note-box mid" style="display:none" data-act="linkbox">' +
        '<b>链接已复制。</b>这条链接里带着你的尺寸数据，发到微信/备忘录存起来，' +
        '换设备打开就能恢复。<b style="color:var(--warn)">别公开发布</b>。' +
        '<div style="margin-top:8px;word-break:break-all;font-family:var(--mono);font-size:11px" ' +
        'data-act="linktext"></div>' +
      '</div>';
    host.appendChild(box);

    var fileInput = box.querySelector('[data-act="file"]');
    var linkBox = box.querySelector('[data-act="linkbox"]');

    box.addEventListener("click", function (ev) {
      var b = ev.target.closest("[data-act]");
      if (!b) return;
      var act = b.dataset.act;

      if (act === "export") {
        var blob = new Blob([D.exportJSON()], { type: "application/json" });
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        var stamp = new Date().toISOString().slice(0, 10);
        a.href = url;
        a.download = "dachu-backup-" + stamp + ".json";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
        toast("已导出备份文件");
      }

      if (act === "link") {
        var base = global.location.href.replace(/[^/]*$/, "");
        var link = base + "share.html#" + D.encodeShare();
        copyText(link).then(function (ok) {
          if (ok) {
            linkBox.style.display = "";
            linkBox.querySelector('[data-act="linktext"]').textContent = link;
            toast("分享链接已复制");
          } else {
            linkBox.style.display = "";
            linkBox.querySelector('[data-act="linktext"]').textContent = link;
            toast("自动复制失败，请手动复制下面的链接");
          }
        });
      }

      if (act === "import") fileInput.click();
    });

    fileInput.addEventListener("change", function () {
      var f = fileInput.files && fileInput.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          D.importJSON(String(reader.result));
          toast("导入成功，数据已恢复");
          if (afterImport) afterImport();
        } catch (e) {
          toast("导入失败：文件格式不对");
        }
      };
      reader.readAsText(f);
      fileInput.value = "";
    });
  }

  // ---------- 启动 ----------
  function boot() {
    renderNav();
  }

  global.UI = {
    boot: boot,
    toast: toast,
    copyText: copyText,
    mountUnitBar: mountUnitBar,
    mountBackup: mountBackup
  };
})(window);
