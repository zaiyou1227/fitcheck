/* 用本地 HTTP 服务 + headless Edge 截图，核对真实渲染 */
const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");

const PUB = path.join(__dirname, "..", "public");
const OUT = path.join(__dirname, "..", "shots");
fs.mkdirSync(OUT, { recursive: true });

const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".webmanifest": "application/manifest+json",
  ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json"
};

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0].split("#")[0]);
  if (p === "/") p = "/index.html";
  const f = path.join(PUB, p);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" });
  res.end(fs.readFileSync(f));
});

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9401;
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const BASE = "http://127.0.0.1:" + server.address().port;
  console.log("server: " + BASE);

  const proc = spawn(EDGE, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars",
    "--disable-application-cache", "--disk-cache-size=1",
    "--remote-debugging-port=" + PORT,
    "--user-data-dir=" + path.join(OUT, "edge-profile"),
    "about:blank"
  ], { stdio: "ignore" });

  let target = null;
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch("http://127.0.0.1:" + PORT + "/json/list")).json();
      target = list.find(t => t.type === "page");
      if (target) break;
    } catch (e) {}
    await sleep(250);
  }
  if (!target) { console.error("no target"); proc.kill(); server.close(); process.exit(1); }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let id = 0;
  const send = (m, p) => new Promise((res, rej) => {
    pending.set(++id, { res, rej });
    ws.send(JSON.stringify({ id, method: m, params: p || {} }));
  });
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
    }
  };
  await new Promise(r => { ws.onopen = r; });
  await send("Page.enable");
  await send("Runtime.enable");

  async function viewport(w, h, mobile) {
    await send("Emulation.setDeviceMetricsOverride", {
      width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile: !!mobile
    });
  }
  async function go(url) {
    await send("Page.navigate", { url });
    await sleep(1400);
  }
  async function shot(name, full) {
    const r = await send("Page.captureScreenshot", {
      format: "png", captureBeyondViewport: !!full
    });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, "base64"));
    console.log("saved " + name);
  }
  async function evalJs(expr) {
    const r = await send("Runtime.evaluate", {
      expression: expr, returnByValue: true, awaitPromise: true
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  }

  // ---- 手机版：首页 ----
  await viewport(390, 844, true);
  await go(BASE + "/index.html");
  await shot("m1-home.png", true);
  console.log("  home overflowX: " + await evalJs(
    "document.documentElement.scrollWidth > document.documentElement.clientWidth + 1"));

  // 填数据 → 档案页
  await go(BASE + "/profile.html");
  await evalJs(`(function(){
    function type(id,v){var el=document.getElementById(id);el.value=String(v);
      el.dispatchEvent(new Event('input',{bubbles:true}));}
    type('f_belly',138); type('f_hip',148); type('f_thigh',85); type('f_rise',32);
    type('f_chest',130); type('f_shoulder',56); type('f_waist',125);
    type('f_neck',45); type('f_upperArm',45); type('f_armLenBack',70);
    type('f_outseam',105); type('f_weight',150);
    window.scrollTo(0,0);
    return document.querySelectorAll('#pantsBody tr').length;
  })()`);
  await sleep(400);
  await shot("m2-profile.png", true);
  console.log("  profile overflowX: " + await evalJs(
    "document.documentElement.scrollWidth > document.documentElement.clientWidth + 1"));

  // 裤子页
  await go(BASE + "/pants.html");
  await shot("m3-pants.png", true);
  console.log("  pants overflowX: " + await evalJs(
    "document.documentElement.scrollWidth > document.documentElement.clientWidth + 1"));

  // 筛店页
  await go(BASE + "/guide.html");
  await evalJs(`['flat','self','after','photo','season','fast'].forEach(function(id){
    document.querySelector('.item[data-id="'+id+'"]').click();
  }); window.scrollTo(0,0);`);
  await sleep(400);
  await shot("m4-guide.png", true);

  // ---- 桌面版 ----
  await viewport(1280, 1400, false);
  await go(BASE + "/profile.html");
  await sleep(300);
  await shot("d1-profile.png", true);
  await go(BASE + "/pants.html");
  await shot("d2-pants.png", true);
  await go(BASE + "/guide.html");
  await shot("d3-guide.png", true);

  // ---- 关键尺寸检查 ----
  await viewport(390, 844, true);
  await go(BASE + "/profile.html");
  const metrics = await evalJs(`(function(){
    var btn = document.querySelector('.btn');
    var nav = document.querySelector('.nav');
    var inp = document.getElementById('f_belly');
    var r = function(el){ var b = el.getBoundingClientRect(); return {w:Math.round(b.width),h:Math.round(b.height)}; };
    return JSON.stringify({
      btn: r(btn), nav: r(nav), input: r(inp),
      navBottom: nav.getBoundingClientRect().bottom,
      viewportH: window.innerHeight,
      fontSize: getComputedStyle(inp).fontSize
    });
  })()`);
  console.log("  metrics: " + metrics);

  ws.close();
  proc.kill();
  server.close();
  process.exit(0);
})().catch(e => { console.error(e); proc.kill(); server.close(); process.exit(1); });
