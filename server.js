// Agent Ofis — Claude oturumlarını ve projeleri sanal bir ofiste gösteren yerel sunucu.
// Bağımlılık yok: `node server.js` → http://127.0.0.1:4777
// Yalnızca bu makinedeki dosyaları okur (~/.claude/sessions, ~/.claude/projects, proje klasörleri).
// Dışarıya hiçbir şey göndermez; varsayılan olarak yalnızca 127.0.0.1'i dinler.

'use strict';
const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const PORT = Number(process.env.PORT || 4777);
const HOME = os.homedir();
const CLAUDE = path.join(HOME, '.claude');
const SESSIONS_DIR = path.join(CLAUDE, 'sessions');
const PROJECTS_DIR = path.join(CLAUDE, 'projects');
const PUBLIC = path.join(__dirname, 'public');
const CONFIG_FILE = path.join(__dirname, 'ofis.config.json');

const DEFAULT_CONFIG = {
  projectRoots: ['~/Projects', '~/Projeler', '~/Developer', '~/code', '~/src'],
  // Bir oturum "şu an aktif" sayılsın diye transcript dosyasına en son kaç sn önce yazılmış olmalı
  activeWindowSec: 90,
  // Ofiste masası olan "son kullanılan" oturum sayısı (canlı olanlar her zaman masada)
  recentDays: 14,
  // true: aynı Wi-Fi'deki cihazlar (telefon) gizli bağlantıyla girebilir (varsayılan kapalı)
  lan: false,
};

function loadConfig() {
  let cfg = { ...DEFAULT_CONFIG };
  try { cfg = { ...cfg, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) }; } catch { /* varsayılan */ }
  cfg.projectRoots = cfg.projectRoots.map((p) => p.replace(/^~(?=\/|$)/, HOME));
  return cfg;
}

// ---------- yardımcılar ----------
const exists = (p) => fsp.access(p).then(() => true, () => false);
// Zaman aşımlı varlık kontrolü (takılırsa 'bilinmiyor' = null)
const existsQuick = (p) => Promise.race([exists(p), new Promise((r) => setTimeout(() => r(null), 300))]);
const isAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const run = (cmd, args, opts = {}) => new Promise((resolve) => {
  execFile(cmd, args, { timeout: 4000, killSignal: 'SIGKILL', maxBuffer: 2 << 20, ...opts }, (err, stdout) => resolve(err ? null : String(stdout)));
});
const tsOf = (t) => (t ? Date.parse(t) : 0);
const shortHome = (p) => (p && p.startsWith(HOME) ? '~' + p.slice(HOME.length) : p);

function prettyProjectName(cwd) {
  if (!cwd) return 'Bilinmeyen';
  if (cwd.includes('/scratch-workspaces/')) return 'Sohbet çalışma alanı';
  const wt = cwd.match(/^(.*)\/\.claude\/worktrees\/[^/]+/);
  return path.basename(wt ? wt[1] : cwd);
}
function projectKey(cwd) {
  if (!cwd) return 'unknown';
  if (cwd.includes('/scratch-workspaces/')) return 'scratch';
  const wt = cwd.match(/^(.*)\/\.claude\/worktrees\/[^/]+/);
  return wt ? wt[1] : cwd;
}

// Bir aracın girdisinden okunabilir tek satır
function describeTool(name, input) {
  input = input || {};
  const short = (s, n = 80) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  const base = (p) => (p ? path.basename(String(p)) : '');
  if (name === 'Bash') return short(input.description || input.command);
  if (name === 'Read' || name === 'Write' || name === 'Edit' || name === 'NotebookEdit') return base(input.file_path || input.notebook_path);
  if (name === 'Grep' || name === 'Glob') return short(input.pattern);
  if (name === 'Agent' || name === 'Task') return short(input.description || input.prompt);
  if (name === 'WebSearch') return short(input.query);
  if (name === 'WebFetch') return short(input.url);
  if (name === 'Skill') return short(input.skill);
  const firstStr = Object.values(input).find((v) => typeof v === 'string');
  return short(firstStr || '');
}

// Araç adını ofis "rolüne" çevir — karakterin şapkası/rengi ve baloncuğu bundan gelir
function toolRole(name) {
  const n = (name || '').toLowerCase();
  if (/outlook|mail|gmail|send_message|create_draft|forward|reply/.test(n)) return 'eposta';
  if (/teams|slack|chat_message/.test(n)) return 'mesaj';
  if (/jira|confluence|atlassian|linear|asana|notion/.test(n)) return 'is-takip';
  if (/calendar|event|meeting/.test(n)) return 'takvim';
  if (/sharepoint|drive|file|upload|download/.test(n) && n.startsWith('mcp__')) return 'dosya';
  if (/browser|chrome|navigate|screenshot|computer/.test(n)) return 'tarayici';
  if (/websearch|webfetch|web-fetch/.test(n)) return 'arastirma';
  if (/^(edit|write|notebookedit)$/.test(n)) return 'kod';
  if (/^(read|grep|glob)$/.test(n)) return 'okuma';
  if (n === 'bash') return 'terminal';
  if (n === 'agent' || n === 'task' || n === 'workflow') return 'yonetici';
  if (/artifact|figma|canva|adobe|design/.test(n)) return 'tasarim';
  return 'genel';
}

// Araç çağrısını Türkçe, insan diliyle tek cümleye çevir ("Outlook'ta e-posta arıyor: fatura")
function humanize(name, input) {
  input = input || {};
  const d = describeTool(name, input);
  const withD = (verb) => (d ? `${verb}: ${d}` : verb);
  const n = String(name || '');
  const map = {
    Bash: 'Komut çalıştırıyor', Read: 'Dosya okuyor', Edit: 'Dosyayı düzenliyor', Write: 'Dosya yazıyor',
    NotebookEdit: 'Not defterini düzenliyor', Grep: 'Kodda arıyor', Glob: 'Dosya arıyor',
    Agent: 'Alt agent görevlendirdi', Task: 'Alt agent görevlendirdi', Workflow: 'Çoklu agent iş akışı başlattı',
    WebSearch: "Web'de arıyor", WebFetch: 'Web sayfası okuyor', Skill: 'Beceri yüklüyor',
    ToolSearch: 'Araç yüklüyor', Artifact: 'Sayfa yayımlıyor', AskUserQuestion: 'Sana soru soruyor',
    SendUserFile: 'Sana dosya gönderiyor', ScheduleWakeup: 'Kendine hatırlatma kuruyor', SendMessage: 'Başka bir agent ile konuşuyor',
  };
  if (map[n]) return withD(map[n]);
  const m = n.match(/^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/);
  const tool = m ? m[2] : n;
  const t = tool.toLowerCase();
  const rules = [
    [/send_mail|send_draft|send_message$/, 'E-posta gönderiyor'], [/email_search|search_threads|get_thread|get_message/, 'E-postalarda arıyor'],
    [/create_draft|reply_draft|update_draft/, 'E-posta taslağı hazırlıyor'], [/forward/, 'E-posta iletiyor'],
    [/teams_send|reply_channel|chat_message$/, "Teams'te mesaj yazıyor"], [/teams_|chat_message_search/, "Teams'te mesajlara bakıyor"],
    [/calendar|event|availability|meeting/, 'Takvimle çalışıyor'], [/sharepoint/, "SharePoint'te dosyalarla çalışıyor"],
    [/jira|issue/, "Jira'da çalışıyor"], [/confluence/, "Confluence'ta çalışıyor"], [/notion/, "Notion'da çalışıyor"],
    [/navigate/, 'Tarayıcıda sayfa açıyor'], [/screenshot|computer/, 'Tarayıcıda ekranla çalışıyor'], [/browser_batch|read_page|get_page_text|find|form_input/, 'Tarayıcıda çalışıyor'],
    [/javascript/, 'Tarayıcıda sayfayı inceliyor'], [/preview_start/, 'Uygulamayı başlatıyor'], [/preview/, 'Önizleme sunucusunu yönetiyor'],
    [/update_plan/, 'Görev listesini güncelliyor'], [/wrap_up/, 'İşi özetliyor'], [/start_session/, 'Yeni oturum başlatıyor'],
    [/figma|design|canva/, 'Tasarım üzerinde çalışıyor'], [/pdf/, 'PDF ile çalışıyor'],
  ];
  for (const [re, verb] of rules) if (re.test(t)) return withD(verb);
  const server = m ? m[1].replace(/^[0-9a-f-]{20,}$/, 'bağlayıcı') : '';
  return withD(`${server ? server + ' · ' : ''}${tool.replace(/_/g, ' ')} kullanıyor`);
}

// ---------- transcript özetleri (mtime'a göre önbellekli) ----------
const summaryCache = new Map(); // file -> {mtimeMs, size, summary}

function parseLine(line) { try { return JSON.parse(line); } catch { return null; } }

async function readTail(file, bytes) {
  const fh = await fsp.open(file, 'r');
  try {
    const { size } = await fh.stat();
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    await fh.read(buf, 0, buf.length, start);
    let text = buf.toString('utf8');
    if (start > 0) text = text.slice(text.indexOf('\n') + 1);
    return text;
  } finally { await fh.close(); }
}

async function summarizeTranscript(file) {
  let st;
  try { st = await fsp.stat(file); } catch { return null; }
  const cached = summaryCache.get(file);
  if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) return cached.summary;

  // Dosya yalnızca sonuna eklenerek büyür: önceki özet varsa sadece yeni satırlar okunur.
  const incremental = !!(cached && cached.offset && st.size > cached.size);
  const s = incremental ? cached.summary : {
    file, sessionId: path.basename(file, '.jsonl'), mtimeMs: st.mtimeMs, sizeBytes: st.size,
    title: null, agentName: null, lastPrompt: null, firstPrompt: null, cwd: null, gitBranch: null,
    firstTs: null, lastTs: null, userTurns: 0, toolCalls: 0, tools: {}, roles: {}, lastTool: null, recent: [],
    model: null,
  };
  s.mtimeMs = st.mtimeMs; s.sizeBytes = st.size;
  const pushRecent = (ev) => { s.recent.push(ev); if (s.recent.length > 80) s.recent.shift(); };

  // Transcript'ler yüzlerce MB olabilir: yalnızca baştan 256 KB (ilk istem, klasör) ve
  // sondan 1.5 MB (başlık, son istem, son araçlar) okunur.
  const handle = (line, fromHead) => {
    // ekran görüntüsü / büyük araç çıktısı satırları (yüzlerce KB) özet için gereksiz
    if (!line || line.length > 300_000) return;
    if (line.startsWith('{"type":"api-request') || line.includes('"type":"file-history')) return;
    const d = parseLine(line);
    if (!d) return;
    if (d.timestamp) { if (fromHead) { if (!s.firstTs) s.firstTs = d.timestamp; } else s.lastTs = d.timestamp; }
    if (d.cwd && (!fromHead || !s.cwd)) s.cwd = d.cwd; // son klasör kazanır
    if (d.gitBranch && !fromHead) s.gitBranch = d.gitBranch;
    switch (d.type) {
      case 'custom-title': if (d.customTitle) s.title = d.customTitle; break;
      case 'agent-name': if (d.agentName) s.agentName = d.agentName; break;
      case 'summary': if (d.summary && !s.title) s.title = d.summary; break;
      case 'last-prompt': if (d.lastPrompt) s.lastPrompt = d.lastPrompt; break;
      case 'user': {
        const c = d.message && d.message.content;
        if (typeof c === 'string' && !d.isMeta && !c.startsWith('<')) {
          if (fromHead) { if (!s.firstPrompt) s.firstPrompt = c.slice(0, 300); }
          else { s.userTurns++; pushRecent({ t: d.timestamp, kind: 'user', text: c.slice(0, 240) }); }
        }
        break;
      }
      case 'assistant': {
        if (fromHead) break;
        const m = d.message || {};
        if (m.model) s.model = m.model;
        for (const b of Array.isArray(m.content) ? m.content : []) {
          if (b.type === 'tool_use') {
            s.toolCalls++;
            s.tools[b.name] = (s.tools[b.name] || 0) + 1;
            s.lastTool = { name: b.name, detail: describeTool(b.name, b.input), human: humanize(b.name, b.input), role: toolRole(b.name), t: d.timestamp };
            s.roles[toolRole(b.name)] = (s.roles[toolRole(b.name)] || 0) + 1;
            pushRecent({ t: d.timestamp, kind: 'tool', name: b.name, role: toolRole(b.name), text: describeTool(b.name, b.input), human: humanize(b.name, b.input) });
          } else if (b.type === 'text' && b.text && b.text.trim()) {
            pushRecent({ t: d.timestamp, kind: 'say', text: b.text.trim().slice(0, 240) });
          }
        }
        break;
      }
      default: break;
    }
  };
  const HEAD = 256 * 1024, TAIL = 1536 * 1024;
  let offset = 0;
  try {
    const fh = await fsp.open(file, 'r');
    try {
      if (incremental) {
        const buf = Buffer.alloc(st.size - cached.offset);
        await fh.read(buf, 0, buf.length, cached.offset);
        const lastNl = buf.lastIndexOf(10);
        if (lastNl >= 0) for (const l of buf.subarray(0, lastNl).toString('utf8').split('\n')) handle(l, false);
        offset = cached.offset + (lastNl >= 0 ? lastNl + 1 : 0);
        summaryCache.set(file, { mtimeMs: st.mtimeMs, size: st.size, offset, summary: s });
        return s;
      }
      const headBuf = Buffer.alloc(Math.min(HEAD, st.size));
      await fh.read(headBuf, 0, headBuf.length, 0);
      const headLines = headBuf.toString('utf8').split('\n');
      if (st.size > HEAD) headLines.pop();
      for (const l of headLines) handle(l, true);
      const tailStart = Math.max(0, st.size - TAIL);
      const tailBuf = Buffer.alloc(st.size - tailStart);
      await fh.read(tailBuf, 0, tailBuf.length, tailStart);
      const lastNl = tailBuf.lastIndexOf(10);
      offset = lastNl >= 0 ? tailStart + lastNl + 1 : 0;
      const tailLines = (lastNl >= 0 ? tailBuf.subarray(0, lastNl) : tailBuf.subarray(0, 0)).toString('utf8').split('\n');
      if (tailStart > 0) tailLines.shift();
      for (const l of tailLines) handle(l, false);
      // Başlık kuyrukta yoksa: dosyada geriye doğru 'custom-title' ara (ucuz grep)
      if (!s.title && !s.agentName && st.size > TAIL) {
        const out = await run('grep', ['-m1', '-o', '"customTitle":"[^"]*"', file]);
        const m = out && out.match(/"customTitle":"([^"]*)"/);
        if (m) s.title = m[1];
      }
    } finally { await fh.close(); }
  } catch { return null; }
  s.partial = st.size > HEAD + TAIL;

  if (!s.title) {
    try { s.title = JSON.parse(await fsp.readFile(file.replace(/\.jsonl$/, '/custom-title.json'), 'utf8')).customTitle || null; } catch { /* yok */ }
  }
  summaryCache.set(file, { mtimeMs: st.mtimeMs, size: st.size, offset, summary: s });
  return s;
}

// Bir oturumun alt agent'ları (subagents/*.jsonl + .meta.json)
const metaCache = new Map();
async function subagentsOf(file, activeWindowMs) {
  const dir = path.join(file.replace(/\.jsonl$/, ''), 'subagents');
  let names;
  try { names = await fsp.readdir(dir); } catch { return []; }
  const out = [];
  for (const n of names.filter((x) => x.endsWith('.jsonl'))) {
    const f = path.join(dir, n);
    let meta = metaCache.get(f);
    if (!meta) { meta = {}; try { meta = JSON.parse(await fsp.readFile(f.replace(/\.jsonl$/, '.meta.json'), 'utf8')); metaCache.set(f, meta); } catch { /* yok */ } }
    const st = await fsp.stat(f).catch(() => null);
    if (!st) continue;
    const active = Date.now() - st.mtimeMs < activeWindowMs;
    let lastTool = null;
    if (active) {
      const tail = await readTail(f, 64 * 1024).catch(() => '');
      for (const line of tail.split('\n').reverse()) {
        const d = parseLine(line);
        const blocks = d && d.type === 'assistant' && d.message && Array.isArray(d.message.content) ? d.message.content : [];
        const tu = blocks.reverse().find((b) => b.type === 'tool_use');
        if (tu) { lastTool = { name: tu.name, detail: describeTool(tu.name, tu.input), human: humanize(tu.name, tu.input), role: toolRole(tu.name) }; break; }
      }
    }
    out.push({ id: n.replace(/\.jsonl$/, ''), type: meta.agentType || 'agent', description: meta.description || '', mtimeMs: st.mtimeMs, active, lastTool });
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

// ---------- canlı oturum kaydı (~/.claude/sessions/<pid>.json) ----------
async function liveRegistry() {
  let names;
  try { names = await fsp.readdir(SESSIONS_DIR); } catch { return []; }
  const out = [];
  for (const n of names.filter((x) => /^\d+\.json$/.test(x))) {
    try {
      const d = JSON.parse(await fsp.readFile(path.join(SESSIONS_DIR, n), 'utf8'));
      if (!d.pid || !isAlive(d.pid)) continue;
      out.push({
        pid: d.pid, sessionId: d.sessionId, name: d.name || null, status: d.status || 'unknown',
        statusSince: d.statusUpdatedAt || d.updatedAt || null, cwd: d.cwd, entrypoint: d.entrypoint, kind: d.kind,
        hostSessionId: d.hostSessionId || null, startedAt: d.startedAt || null, version: d.version || null,
      });
    } catch { /* bozuk dosya */ }
  }
  return out;
}

// ---------- tüm transcript dosyaları ----------
async function allTranscripts() {
  let dirs;
  try { dirs = await fsp.readdir(PROJECTS_DIR); } catch { return []; }
  const files = [];
  for (const d of dirs) {
    const full = path.join(PROJECTS_DIR, d);
    let names;
    try { names = await fsp.readdir(full); } catch { continue; }
    for (const n of names) if (n.endsWith('.jsonl')) files.push({ file: path.join(full, n), dirName: d });
  }
  return files;
}

// ---------- proje klasörleri (git durumu) ----------
// git komutları büyük/iCloud'daki depolarda saniyeler sürebilir: arka planda, sırayla,
// 5 dk önbellekli çalışır; durum derlemesini asla bekletmez.
const gitCache = new Map(); // dir -> {at, info}
const gitQueue = [];
let gitBusy = false;
function gitInfo(dir) {
  const c = gitCache.get(dir);
  if (!c || Date.now() - c.at > 300_000) {
    if (!gitQueue.includes(dir)) gitQueue.push(dir);
    pumpGit();
  }
  return c ? c.info : undefined; // undefined = henüz bilinmiyor
}
async function pumpGit() {
  if (gitBusy) return;
  gitBusy = true;
  while (gitQueue.length) {
    const dir = gitQueue.shift();
    const opt = { timeout: 8000 };
    const branch = await run('git', ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD'], opt);
    let info = null;
    if (branch !== null) {
      const [status, last, remote] = await Promise.all([
        run('git', ['-C', dir, 'status', '--porcelain', '--untracked-files=normal'], opt),
        run('git', ['-C', dir, 'log', '-1', '--format=%h%x09%cI%x09%s'], opt),
        run('git', ['-C', dir, 'remote', 'get-url', 'origin'], opt),
      ]);
      const [hash, date, subject] = (last || '').trim().split('\t');
      info = {
        branch: branch.trim(),
        dirty: status === null ? null : status.split('\n').filter(Boolean).length,
        lastCommit: hash ? { hash, date, subject } : null,
        remote: remote ? remote.trim().replace(/^https:\/\/[^@]+@/, 'https://') : null,
      };
    }
    gitCache.set(dir, { at: Date.now(), info });
  }
  gitBusy = false;
}

// Klasör taraması: her kök ayrı alt süreçte, 20 sn sınırla, 2 dk'da bir arka planda.
const folderCache = new Map(); // root -> {at, list}
const folderBusy = new Set();
function refreshRoot(root) {
  if (folderBusy.has(root)) return;
  folderBusy.add(root);
  run(process.execPath, [path.join(__dirname, 'scan-folders.js'), root], { timeout: 20000 }).then((out) => {
    let list = null;
    try { list = out ? JSON.parse(out) : null; } catch { list = null; }
    const prev = folderCache.get(root);
    folderCache.set(root, { at: Date.now(), list: list || (prev ? prev.list : []), failed: !list });
    folderBusy.delete(root);
  });
}
function scanProjectFolders(cfg) {
  const out = [];
  for (const root of cfg.projectRoots) {
    const c = folderCache.get(root);
    if (!c || Date.now() - c.at > 120_000) refreshRoot(root);
    for (const f of (c ? c.list : [])) {
      out.push({ ...f, root: shortHome(root), git: f.isGit ? gitInfo(f.dir) : null });
    }
  }
  return out;
}
const knownDir = (dir) => { for (const c of folderCache.values()) if (c.list.some((f) => f.dir === dir)) return true; return null; };

// ---------- hafıza dosyaları ----------
const memCache = new Map();
async function memoryFor(dirName) {
  const mdir = path.join(PROJECTS_DIR, dirName, 'memory');
  const st = await fsp.stat(mdir).catch(() => null);
  if (!st) return [];
  const c = memCache.get(mdir);
  if (c && c.mtimeMs === st.mtimeMs) return c.list;
  const list = await readMemory(mdir);
  memCache.set(mdir, { mtimeMs: st.mtimeMs, list });
  return list;
}
async function readMemory(mdir) {
  let names;
  try { names = await fsp.readdir(mdir); } catch { return []; }
  const out = [];
  for (const n of names.filter((x) => x.endsWith('.md') && x !== 'MEMORY.md')) {
    try {
      const txt = await fsp.readFile(path.join(mdir, n), 'utf8');
      const desc = (txt.match(/^description:\s*(.+)$/m) || [])[1] || '';
      const name = (txt.match(/^name:\s*(.+)$/m) || [])[1] || n.replace(/\.md$/, '');
      out.push({ name, description: desc, file: path.join(mdir, n) });
    } catch { /* okunamadı */ }
  }
  return out;
}

// ---------- tüm durumu derle ----------
let lastState = null;
let building = null;

async function buildState() {
  const cfg = loadConfig();
  const activeWindowMs = cfg.activeWindowSec * 1000;
  const recentCutoff = Date.now() - cfg.recentDays * 86400_000;

  const [live, transcripts] = await Promise.all([liveRegistry(), allTranscripts()]);
  const folders = scanProjectFolders(cfg);
  const liveById = new Map(live.map((l) => [l.sessionId, l]));

  const sessions = [];
  const memoryDirs = new Map();
  for (const t of transcripts) {
    const s = await summarizeTranscript(t.file);
    if (!s) continue;
    const l = liveById.get(s.sessionId);
    const cwd = (l && l.cwd) || s.cwd || null;
    const writingNow = Date.now() - s.mtimeMs < activeWindowMs;
    const subs = (l || writingNow || s.mtimeMs > recentCutoff) ? await subagentsOf(t.file, activeWindowMs) : [];
    let state = 'arsiv';
    if (l) state = l.status === 'busy' ? 'calisiyor' : (l.status === 'waiting' || l.status === 'needs_input' ? 'bekliyor' : 'bosta');
    else if (writingNow) state = 'calisiyor';
    else if (s.mtimeMs > recentCutoff) state = 'kapali';
    sessions.push({
      id: s.sessionId,
      name: (l && l.name) || s.agentName || s.title || (s.firstPrompt ? s.firstPrompt.slice(0, 60) : 'İsimsiz oturum'),
      title: s.title, firstPrompt: s.firstPrompt, lastPrompt: s.lastPrompt,
      cwd, cwdShort: shortHome(cwd), project: prettyProjectName(cwd), projectKey: projectKey(cwd),
      gitBranch: s.gitBranch, model: s.model,
      state, live: !!l, pid: l ? l.pid : null, liveStatus: l ? l.status : null, statusSince: l ? l.statusSince : null,
      hostSessionId: l ? l.hostSessionId : null, entrypoint: l ? l.entrypoint : null,
      firstTs: s.firstTs, lastTs: s.lastTs, mtimeMs: s.mtimeMs, sizeBytes: s.sizeBytes,
      userTurns: s.userTurns, toolCalls: s.toolCalls,
      topTools: Object.entries(s.tools).sort((a, b) => b[1] - a[1]).slice(0, 6),
      lastTool: s.lastTool, recent: s.recent, roles: s.roles,
      subagents: subs,
      transcript: t.file,
    });
    memoryDirs.set(projectKey(cwd), t.dirName);
  }
  // Transcript'i henüz yazılmamış canlı oturumlar
  for (const l of live) {
    if (sessions.some((s) => s.id === l.sessionId)) continue;
    sessions.push({
      id: l.sessionId, name: l.name || 'Yeni oturum', cwd: l.cwd, cwdShort: shortHome(l.cwd),
      project: prettyProjectName(l.cwd), projectKey: projectKey(l.cwd),
      state: l.status === 'busy' ? 'calisiyor' : 'bosta', live: true, pid: l.pid, liveStatus: l.status,
      statusSince: l.statusSince, hostSessionId: l.hostSessionId, userTurns: 0, toolCalls: 0, topTools: [],
      subagents: [], mtimeMs: l.statusSince || Date.now(),
    });
  }
  sessions.sort((a, b) => b.mtimeMs - a.mtimeMs);

  // Projeler: transcript cwd'leri + diskteki klasörler birleşimi
  const projects = new Map();
  const ensure = (key, cwd) => {
    if (!projects.has(key)) {
      projects.set(key, {
        key, name: key === 'scratch' ? 'Sohbet çalışma alanı' : prettyProjectName(cwd || key),
        dir: key === 'scratch' ? null : key, dirShort: key === 'scratch' ? null : shortHome(key),
        sessionIds: [], liveCount: 0, busyCount: 0, lastActivity: 0, onDisk: false, git: null, hasClaudeMd: false, memory: [],
      });
    }
    return projects.get(key);
  };
  for (const s of sessions) {
    const p = ensure(s.projectKey, s.cwd);
    p.sessionIds.push(s.id);
    if (s.live) p.liveCount++;
    if (s.state === 'calisiyor') p.busyCount++;
    p.lastActivity = Math.max(p.lastActivity, s.mtimeMs || 0);
  }
  for (const f of folders) {
    const p = ensure(f.dir, f.dir);
    p.onDisk = true; p.git = f.git; p.hasClaudeMd = f.hasClaudeMd; p.root = f.root; p.isGit = f.isGit;
    p.lastActivity = Math.max(p.lastActivity, f.mtimeMs);
  }
  for (const p of projects.values()) {
    // Masaüstü gibi takılabilen yerlere ana süreçten dokunma: kök taramasında görülmediyse bilinmiyor say
    if (p.dir && !p.onDisk) p.onDisk = knownDir(p.dir) || (p.dir.startsWith(path.join(HOME, 'Desktop')) ? null : await existsQuick(p.dir));
    if (p.dir && p.onDisk && p.git === null && !p.root) p.git = gitInfo(p.dir);
    const md = memoryDirs.get(p.key);
    if (md) p.memory = await memoryFor(md);
  }
  const projectList = [...projects.values()].sort((a, b) => (b.busyCount - a.busyCount) || (b.liveCount - a.liveCount) || (b.lastActivity - a.lastActivity));

  // Genel hafıza (bu projedeki MEMORY.md tüm oturumlarda yüklenen kişisel hafıza)
  const totals = {
    projects: projectList.length,
    projectsWithSessions: projectList.filter((p) => p.sessionIds.length).length,
    sessions: sessions.length,
    live: sessions.filter((s) => s.live).length,
    busy: sessions.filter((s) => s.state === 'calisiyor').length,
    subagents: sessions.reduce((n, s) => n + (s.subagents ? s.subagents.length : 0), 0),
    activeSubagents: sessions.reduce((n, s) => n + (s.subagents ? s.subagents.filter((a) => a.active).length : 0), 0),
    toolCalls: sessions.reduce((n, s) => n + (s.toolCalls || 0), 0),
  };
  // Dikkat gerektirenler
  const alerts = [];
  const now = Date.now();
  for (const s of sessions) {
    if (s.state === 'bekliyor') alerts.push({ level: 'high', sessionId: s.id, title: 'Onayını bekliyor', text: s.name });
    if (s.live && s.state === 'bosta' && now - (s.statusSince || s.mtimeMs) > 2 * 86400_000)
      alerts.push({ level: 'low', sessionId: s.id, title: `${Math.floor((now - (s.statusSince || s.mtimeMs)) / 86400_000)} gündür açık ve boşta`, text: s.name + ' — kapatılabilir' });
    if (s.live && s.sizeBytes > 60e6)
      alerts.push({ level: 'mid', sessionId: s.id, title: `Kayıt çok büyük (${Math.round(s.sizeBytes / 1e6)} MB)`, text: s.name + ' — yeni oturuma geçmek hızlandırır' });
    if (s.state === 'calisiyor' && s.firstTs && s.lastTool && now - tsOf(s.lastTool.t) > 15 * 60_000 && !s.live)
      alerts.push({ level: 'mid', sessionId: s.id, title: 'Uzun süredir yeni adım yok', text: s.name });
  }
  for (const p of projectList) {
    if (p.git && p.git.dirty >= 20 && p.sessionIds.length)
      alerts.push({ level: 'mid', projectKey: p.key, title: `${p.git.dirty} kaydedilmemiş değişiklik`, text: p.name + ' — commit edilmemiş iş birikiyor' });
  }
  const rank = { high: 0, mid: 1, low: 2 };
  alerts.sort((a, b) => rank[a.level] - rank[b.level]);

  return { generatedAt: Date.now(), alerts, config: { ...cfg, projectRoots: cfg.projectRoots.map(shortHome) }, totals, sessions, projects: projectList };
}

async function getState(force) {
  if (!force && lastState && Date.now() - lastState.generatedAt < 1500) return lastState;
  if (!building) building = buildState().then((s) => { lastState = s; building = null; return s; }, (e) => { building = null; throw e; });
  return building;
}

// ---------- yönetim eylemleri ----------
// Yalnızca envanterde zaten bulunan yollar/oturumlar üzerinde çalışır.
function applescriptQuote(s) { return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'; }
function shQuote(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; }

async function doAction(body) {
  const state = await getState();
  const session = body.sessionId ? state.sessions.find((s) => s.id === body.sessionId) : null;
  const project = body.projectKey ? state.projects.find((p) => p.key === body.projectKey) : null;
  const dir = (session && session.cwd) || (project && project.dir);

  switch (body.action) {
    case 'open-folder':
      if (!dir) throw new Error('Klasör yok');
      await run('open', [dir]); return { ok: true };
    case 'open-vscode':
      if (!dir) throw new Error('Klasör yok');
      if ((await run('open', ['-a', 'Visual Studio Code', dir])) === null) await run('open', [dir]);
      return { ok: true };
    case 'resume-terminal': {
      if (!session || !session.cwd) throw new Error('Oturum bulunamadı');
      if (session.live) throw new Error('Bu oturum zaten açık; Claude uygulamasından devam et');
      const cmd = `cd ${shQuote(session.cwd)} && claude --resume ${shQuote(session.id)}`;
      await run('osascript', ['-e', `tell application "Terminal" to do script ${applescriptQuote(cmd)}`, '-e', 'tell application "Terminal" to activate']);
      return { ok: true, command: cmd };
    }
    case 'new-terminal': {
      if (!dir) throw new Error('Klasör yok');
      const cmd = `cd ${shQuote(dir)} && claude`;
      await run('osascript', ['-e', `tell application "Terminal" to do script ${applescriptQuote(cmd)}`, '-e', 'tell application "Terminal" to activate']);
      return { ok: true, command: cmd };
    }
    case 'reveal-transcript':
      if (!session || !session.transcript) throw new Error('Transcript yok');
      await run('open', ['-R', session.transcript]); return { ok: true };
    case 'open-claude-app':
      await run('open', ['-a', 'Claude']); return { ok: true };
    default:
      throw new Error('Bilinmeyen eylem');
  }
}

// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8' };
const sseClients = new Set();

function send(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}

// ---------- Wi-Fi (yerel ağ) erişimi ----------
// Bu Mac'ten gelen istekler serbest. Ağdaki başka cihazlar (telefon) yalnızca gizli anahtarla girebilir:
// ilk girişte ?t=<anahtar> ile gelir, anahtar 1 yıllık bir çereze yazılır.
const crypto = require('crypto');
const TOKEN_FILE = path.join(__dirname, '.ofis-token');
function getToken() {
  try { const t = fs.readFileSync(TOKEN_FILE, 'utf8').trim(); if (t.length >= 24) return t; } catch { /* yok */ }
  const t = crypto.randomBytes(18).toString('base64url');
  fs.writeFileSync(TOKEN_FILE, t, { mode: 0o600 });
  return t;
}
const TOKEN = getToken();
function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal && !/^(utun|bridge|vmnet|awdl|llw)/.test(name)) out.push(a.address);
  }
  return out;
}
const isLoopback = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
function cookieToken(req) {
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)ofis_token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  try {
    const host = (req.headers.host || '').split(':')[0];
    if (isLoopback(req)) {
      // Bu Mac: DNS rebinding'e karşı yalnızca yerel adlar
      if (!['127.0.0.1', 'localhost', ...lanAddresses()].includes(host)) { res.writeHead(403); return res.end(); }
    } else {
      // Ağdaki başka cihaz: gizli anahtar şart
      const q = url.searchParams.get('t');
      if (q && safeEq(q, TOKEN)) {
        res.writeHead(302, { location: url.pathname, 'set-cookie': `ofis_token=${encodeURIComponent(TOKEN)}; Max-Age=31536000; Path=/; HttpOnly; SameSite=Strict` });
        return res.end();
      }
      if (!safeEq(cookieToken(req), TOKEN)) {
        res.writeHead(401, { 'content-type': 'text/html; charset=utf-8' });
        return res.end('<meta name="viewport" content="width=device-width"><body style="font:16px system-ui;padding:32px;color:#333"><h2>Agent Ofis</h2><p>Giriş için Mac\'teki panelde <b>Telefondan aç</b> düğmesindeki karekodu okut.</p></body>');
      }
    }
    if (url.pathname === '/api/phone-link') {
      if (!isLoopback(req)) { res.writeHead(403); return res.end(); }
      const ips = lanAddresses();
      return send(res, 200, { lan: loadConfig().lan, urls: ips.map((ip) => `http://${ip}:${PORT}/?t=${TOKEN}`) });
    }

    if (url.pathname === '/api/state') return send(res, 200, await getState(url.searchParams.has('force')));
    if (url.pathname === '/api/stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write('retry: 3000\n\n');
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      getState().then((s) => res.write(`data: ${JSON.stringify(s)}\n\n`)).catch(() => {});
      return;
    }
    if (url.pathname === '/api/action' && req.method === 'POST') {
      const origin = req.headers.origin || '';
      if (origin && origin !== `http://${req.headers.host}`) { res.writeHead(403); return res.end(); }
      let raw = '';
      for await (const c of req) { raw += c; if (raw.length > 10_000) break; }
      try { return send(res, 200, await doAction(JSON.parse(raw || '{}'))); }
      catch (e) { return send(res, 400, { ok: false, error: e.message }); }
    }
    // statik dosyalar
    let p = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = path.normalize(path.join(PUBLIC, p));
    if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
    const data = await fsp.readFile(file).catch(() => null);
    if (!data) { res.writeHead(404); return res.end('yok'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(data);
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});

// Her 2 sn'de bir durumu yenile ve bağlı tarayıcılara gönder
if (require.main === module) setInterval(async () => {
  if (!sseClients.size) return;
  try {
    const s = await getState(true);
    const msg = `data: ${JSON.stringify(s)}\n\n`;
    for (const c of sseClients) c.write(msg);
  } catch (e) { console.error('durum hatası:', e.message); }
}, 3000);

module.exports = { buildState, summarizeTranscript, scanProjectFolders, liveRegistry, allTranscripts, loadConfig, subagentsOf };
if (require.main === module) server.listen(PORT, loadConfig().lan ? '0.0.0.0' : '127.0.0.1', () => {
  if (loadConfig().lan) console.log('Telefondan: ' + lanAddresses().map((ip) => `http://${ip}:${PORT}/?t=…`).join(' '));
  console.log(`Agent Ofis hazır → http://127.0.0.1:${PORT}`);
  getState().then((s) => console.log(`${s.totals.projects} proje, ${s.totals.sessions} oturum, ${s.totals.live} canlı`)).catch((e) => console.error(e));
});
