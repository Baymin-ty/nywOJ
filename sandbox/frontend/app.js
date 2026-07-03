"use strict";

// ===== 演示程序 =====
const EX = {
  hello: { lang: "c", code:
`#include <stdio.h>
int main(){ printf("Hello from the sandbox!\\n"); return 0; }
` },
  aplusb: { lang: "c", stdin: "3 4\n", expected: "7\n", code:
`#include <stdio.h>
int main(){ int a,b; scanf("%d %d",&a,&b); printf("%d\\n",a+b); return 0; }
` },
  loop: { lang: "c", code:
`int main(){ for(;;){} }   // 死循环 → TO
` },
  memhog: { lang: "c", mem: 65536, code:
`#include <stdlib.h>
#include <string.h>
int main(){ for(;;){ char*p=malloc(10*1024*1024); if(p) memset(p,1,10*1024*1024);} }
` },
  forkbomb: { lang: "c", wall: 1500, code:
`#include <unistd.h>
int main(){ for(;;) fork(); }   // 被 cgroup pids.max 挡住
` },
  escape: { lang: "c", code:
`#include <stdio.h>
int main(){
  FILE*f=fopen("/etc/shadow","r");
  if(!f){ perror("fopen /etc/shadow"); return 3; }
  char b[256]; if(fgets(b,sizeof b,f)) printf("%s",b); return 0;
}
` },
  netcall: { lang: "python", code:
`import socket
s=socket.socket(); s.settimeout(2)
try:
    s.connect(("1.1.1.1",80)); print("connected?!")
except OSError as e:
    print("联网失败（已隔离）:", e)
` },
  badsyscall: { lang: "c", code:
`#include <sys/mount.h>
#include <stdio.h>
int main(){ int r=mount("none","/mnt","tmpfs",0,0); perror("mount"); return r?5:0; }
` },
  shellprobe: { lang: "shell", code:
`echo "== whoami / id =="; id
echo "== hostname =="; hostname
echo "== ls / =="; ls /
echo "== 网卡 =="; ls /sys/class/net
echo "== 进程 =="; ls /proc | grep -E '^[0-9]+$'
` },
};

const $ = (id) => document.getElementById(id);
let ws = null;
let chart = { s: [], wall: 5000, mem: 262144, cpu: 2000, procs: 16 };
let scAgg = {}; // name -> {nr,count,blocked}

// ===== 行号编辑器 =====
const ta = $("source"), gutter = $("gutter");
function syncGutter() {
  const n = ta.value.split("\n").length;
  let s = ""; for (let i = 1; i <= n; i++) s += i + "\n";
  gutter.textContent = s;
}
ta.addEventListener("input", syncGutter);
ta.addEventListener("scroll", () => { gutter.scrollTop = ta.scrollTop; });
ta.addEventListener("keydown", (e) => {
  if (e.key === "Tab") { e.preventDefault();
    const s = ta.selectionStart, en = ta.selectionEnd;
    ta.value = ta.value.slice(0, s) + "  " + ta.value.slice(en);
    ta.selectionStart = ta.selectionEnd = s + 2; syncGutter();
  }
});

// ===== 标签页 =====
document.querySelectorAll(".tab").forEach((t) => {
  t.onclick = () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((x) => x.classList.remove("active"));
    t.classList.add("active"); $("panel-" + t.dataset.tab).classList.add("active");
  };
});

// ===== 载入示例 =====
$("example").onchange = (e) => {
  const ex = EX[e.target.value]; if (!ex) return;
  $("language").value = ex.lang;
  ta.value = ex.code; syncGutter();
  $("stdin").value = ex.stdin || "";
  $("expected").value = ex.expected || "";
  if (ex.mem) $("mem_kib").value = ex.mem;
  if (ex.wall) $("wall_time_ms").value = ex.wall;
};

// 图例
const PHASES = { setup:["⚙️","#6e7681","准备"], namespace:["🧩","#a371f7","命名空间"], filesystem:["📁","#4f9cf9","文件系统"], limits:["📊","#d29922","限额"], security:["🔒","#f85149","安全"], run:["🚀","#3fb950","运行"], teardown:["🧹","#6e7681","收尾"] };
$("legend").innerHTML = Object.entries(PHASES).map(([k,[ic,c,n]]) =>
  `<span class="lg"><i style="background:${c}"></i>${ic} ${n}</span>`).join("");

ta.value = EX.hello.code; syncGutter();

// ===== 运行 =====
$("run").onclick = async () => {
  const limits = {
    wall_time_ms: +$("wall_time_ms").value, cpu_time_ms: +$("cpu_time_ms").value,
    mem_kib: +$("mem_kib").value, stack_kib: +$("stack_kib").value, max_procs: +$("max_procs").value,
    seccomp: $("seccomp").value, seccomp_allowlist: $("seccomp_allowlist").checked,
    use_namespaces: $("use_namespaces").checked, use_cgroup: $("use_cgroup").checked,
    use_user_ns: $("use_user_ns").checked, share_net: $("share_net").checked, trace: $("trace").checked,
  };
  const body = { language: $("language").value, source: ta.value, stdin: $("stdin").value, expected_output: $("expected").value, limits };
  reset(limits);
  let res;
  try { res = await fetch("/api/submit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json()); }
  catch (e) { return setVerdict("XX", "提交失败: " + e); }
  if (res.error) return setVerdict("XX", res.error);
  openWs(res.job_id);
};

function reset(limits) {
  setVerdict("running", "运行中…");
  $("judge").className = "badge judge hidden";
  $("timeline").innerHTML = ""; $("output").innerHTML = "";
  $("sc-tbody").innerHTML = ""; $("sc-stream").innerHTML = ""; scAgg = {};
  $("verdict-card").className = "verdict-card"; $("verdict-card").innerHTML = "";
  $("fs-body").classList.add("hidden"); $("fs-empty").classList.remove("hidden");
  ["g-mem","g-cpu","g-procs"].forEach(id => $(id).textContent = "0");
  $("g-mem-sub").textContent = `/ ${fmt(limits.mem_kib)} KiB`;
  $("g-cpu-sub").textContent = `/ ${limits.cpu_time_ms} ms`;
  $("g-procs-sub").textContent = `/ ${limits.max_procs}`;
  chart = { s: [], wall: limits.wall_time_ms, mem: limits.mem_kib, cpu: limits.cpu_time_ms, procs: limits.max_procs };
  stepStart = 0;
  drawChart();
  $("run").disabled = true;
}

function openWs(jobId) {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws/${jobId}`);
  ws.onmessage = (e) => handle(JSON.parse(e.data));
  ws.onclose = () => { $("run").disabled = false; };
  ws.onerror = () => { setVerdict("XX", "WebSocket 错误"); $("run").disabled = false; };
}

function handle(ev) {
  switch (ev.kind) {
    case "step": addStep(ev); break;
    case "resource_sample": addSample(ev); break;
    case "syscall": addSyscall(ev); break;
    case "stdout": out(ev.data, false); break;
    case "stderr": out(ev.data, true); break;
    case "fs_snapshot": renderFs(ev); break;
    case "result": showResult(ev); break;
    case "judge": showJudge(ev); break;
    case "error": out("【沙箱错误】" + ev.message + "\n", true); break;
  }
}

let stepStart = 0;
function addStep(ev) {
  if (!stepStart) stepStart = performance.now();
  const dt = Math.round(performance.now() - stepStart);
  const [ic, , ] = PHASES[ev.phase] || ["•"];
  const li = document.createElement("li");
  li.className = "phase-" + ev.phase;
  li.innerHTML =
    `<div class="t-row"><span class="t-title">${ic} ${esc(ev.title)}</span><span class="t-time">+${dt}ms</span></div>`
    + `<div class="t-detail">${esc(ev.detail)}</div>`
    + `<div class="t-explain">💡 ${esc(ev.explain)}</div>`;
  li.onclick = () => li.classList.toggle("open");
  $("timeline").appendChild(li);
  const p = $("panel-timeline"); p.scrollTop = p.scrollHeight;
}

function addSyscall(ev) {
  const a = scAgg[ev.name] || (scAgg[ev.name] = { nr: ev.nr, count: 0, blocked: ev.blocked });
  a.count++; a.blocked = a.blocked || ev.blocked;
  renderScTable();
  const sp = document.createElement("span");
  sp.className = ev.blocked ? "blk" : "";
  sp.textContent = ev.name + " ";
  $("sc-stream").appendChild(sp);
}
function renderScTable() {
  const flt = ($("sc-filter").value || "").toLowerCase();
  const rows = Object.entries(scAgg).filter(([n]) => n.toLowerCase().includes(flt))
    .sort((a, b) => b[1].count - a[1].count);
  $("sc-tbody").innerHTML = rows.map(([n, a]) =>
    `<tr class="${a.blocked ? "blocked" : ""}"><td>${esc(n)}</td><td>${a.nr}</td><td class="cnt">${a.count}</td><td>${a.blocked ? "⚠ 危险" : "放行"}</td></tr>`).join("");
}
$("sc-filter").addEventListener("input", renderScTable);

function addSample(ev) {
  $("g-mem").textContent = fmt(ev.peak_kib);
  $("g-cpu").textContent = fmt(ev.cpu_ms);
  $("g-procs").textContent = ev.procs;
  setBar("g-mem-bar", ev.peak_kib / chart.mem);
  setBar("g-cpu-bar", ev.cpu_ms / chart.cpu);
  setBar("g-procs-bar", ev.procs / chart.procs);
  chart.s.push(ev); drawChart();
}
function setBar(id, frac) {
  const el = $(id); const p = Math.min(frac, 1) * 100;
  el.style.width = p + "%";
  el.style.background = p > 85 ? "var(--err)" : p > 60 ? "var(--warn)" : "var(--accent)";
}

function out(data, isErr) {
  const pre = $("output");
  pre.innerHTML += isErr ? `<span class="err">${esc(data)}</span>` : esc(data);
  pre.scrollTop = pre.scrollHeight;
}

function renderFs(ev) {
  $("fs-empty").classList.add("hidden"); $("fs-body").classList.remove("hidden");
  $("fs-meta").innerHTML =
    `<span class="m">主机名 <b>${esc(ev.hostname)}</b></span>`
    + `<span class="m">沙箱内 euid <b>${ev.euid}</b>${ev.euid === 0 ? " (userns root)" : ""}</span>`
    + `<span class="m">挂载数 <b>${ev.mounts.length}</b></span>`;
  $("fs-root").innerHTML = ev.root_entries.map(e => `<li>/${esc(e)}</li>`).join("") || "<li>(空)</li>";
  $("fs-mounts").innerHTML = ev.mounts.map(m =>
    `<li><span class="mp">${esc(m.target)}</span><span class="fs">${esc(m.fstype)}</span><span class="${m.ro ? "ro" : "rw"}">${m.ro ? "ro" : "rw"}</span></li>`).join("");
  $("fs-net").innerHTML = ev.net_ifaces.map(i => `<li>${esc(i)}</li>`).join("") || "<li>(无网卡)</li>";
  $("fs-gone").innerHTML = ev.gone.map(g => `<li>${esc(g)}</li>`).join("") || "<li>(无)</li>";
}

function showResult(r) {
  setVerdict(r.status, r.message);
  const c = $("verdict-card"); c.className = "verdict-card show";
  c.innerHTML =
    `<div class="vc-stats">`
    + stat("墙钟", r.wall_time_ms + " ms") + stat("CPU", r.cpu_time_ms + " ms")
    + stat("峰值内存", fmt(Math.max(r.cg_mem_kib, r.max_rss_kib)) + " KiB")
    + (r.exit_code != null ? stat("退出码", r.exit_code) : "")
    + (r.exit_signal != null ? stat("信号", r.exit_signal) : "")
    + (r.cg_oom ? stat("OOM", "是") : "") + (r.killed ? stat("被杀", "是") : "")
    + `</div><div class="vc-msg">${esc(r.message)}</div>`;
}
function showJudge(ev) {
  const b = $("judge"); b.className = "badge judge " + ev.verdict;
  b.textContent = ev.verdict === "AC" ? "✓ AC" : "✗ WA";
  b.title = ev.message;
  if (ev.verdict === "WA") out("\n[判题] " + ev.message + "\n", true);
}
function stat(k, v) { return `<span class="stat">${k} <b>${esc(String(v))}</b></span>`; }
function setVerdict(s, msg) {
  const el = $("verdict"); el.className = "badge verdict " + s;
  el.textContent = ({ running:"运行中", OK:"OK 通过", RE:"RE 运行错误", SG:"SG 信号杀", TO:"TO 超时", MLE:"MLE 超内存", XX:"XX 内部错误" }[s]) || s;
  el.title = msg || "";
}

// ===== 折线图 =====
function drawChart() {
  const cv = $("chart"); const ctx = cv.getContext("2d");
  const W = cv.width, H = cv.height, pad = 30;
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = "#222a38"; ctx.lineWidth = 1; ctx.fillStyle = "#6b7484"; ctx.font = "10px monospace";
  for (let i = 0; i <= 4; i++) {
    const y = pad + (H - 2 * pad) * i / 4;
    ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - pad, y); ctx.stroke();
    ctx.fillText((100 - i * 25) + "%", 4, y + 3);
  }
  const s = chart.s; if (s.length < 1) return;
  const tMax = Math.max(chart.wall, s[s.length - 1].t_ms, 1);
  const x = (t) => pad + (W - 2 * pad) * t / tMax;
  const y = (p) => pad + (H - 2 * pad) * (1 - Math.min(p, 1));
  ctx.fillText("0", pad - 4, H - pad + 12); ctx.fillText((tMax) + "ms", W - pad - 24, H - pad + 12);
  const line = (key, lim, col) => {
    if (lim <= 0) return;
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath();
    s.forEach((d, i) => { const px = x(d.t_ms), py = y(d[key] / lim); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
    ctx.stroke();
  };
  line("peak_kib", chart.mem, "#4f9cf9");
  line("cpu_ms", chart.cpu, "#f0883e");
}

function fmt(n) { return (n || 0).toLocaleString(); }
function esc(s) { return String(s).replace(/[&<>]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;" }[c])); }
