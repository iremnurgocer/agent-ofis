'use strict';
// Agent Ofis — istemci

// =====================================================================
// Durum ve yardımcılar
// =====================================================================
let S = null;                 // sunucudan gelen son durum
let route = 'genel';
let drawerId = null;
let drawerTab = 'akis';
let officeFilter = 'acik';
let zoom = 1;
let mode3d = true; try { mode3d = localStorage.getItem('ofis-3d') !== '0'; } catch { /* yok */ }
let o3Mounted = false;
const ui = { sortKey: 'mtimeMs', sortDir: -1, stateF: '', projF: '', feedRole: '', feedProj: '' };

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ts = (t) => (t ? (typeof t === 'number' ? t : Date.parse(t)) : 0);

const STATE_LABEL = { calisiyor: 'Çalışıyor', bekliyor: 'Onay bekliyor', bosta: 'Boşta', kapali: 'Kapalı', arsiv: 'Arşiv' };
const ROLE = {
  eposta: ['✉️', 'E-posta'], mesaj: ['💬', 'Mesajlaşma'], 'is-takip': ['📋', 'İş takibi'], takvim: ['📅', 'Takvim'],
  dosya: ['📁', 'Dosyalar'], tarayici: ['🌐', 'Tarayıcı'], arastirma: ['🔎', 'Araştırma'], kod: ['✏️', 'Kod yazıyor'],
  okuma: ['📖', 'İnceliyor'], terminal: ['⌘', 'Terminal'], yonetici: ['👥', 'Ekip yönetiyor'], tasarim: ['🎨', 'Tasarım'],
  genel: ['⚙️', 'Diğer'],
};
const role = (r) => ROLE[r] || ROLE.genel;
const cleanTool = (n) => String(n || '').replace(/^mcp__.+?__/, '');

function ago(ms, short) {
  if (!ms) return '—';
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 45) return 'az önce';
  if (s < 3600) return `${Math.round(s / 60)} dk${short ? '' : ' önce'}`;
  if (s < 86400) return `${Math.floor(s / 3600)} sa${short ? '' : ' önce'}`;
  const d = Math.floor(s / 86400);
  if (d < 30) return `${d} gün${short ? '' : ' önce'}`;
  return new Date(ms).toLocaleDateString('tr-TR');
}
const hhmm = (t) => (t ? new Date(ts(t)).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : '');
const mb = (b) => (b ? (b / 1e6 >= 10 ? Math.round(b / 1e6) : (b / 1e6).toFixed(1)) + ' MB' : '—');

// Oturum kimliğinden sabit bir görünüm
function hash(str) { let h = 2166136261; for (const c of String(str)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
const SKIN = ['#f3d9bf', '#e7b98f', '#c98f62', '#8d5a3b', '#f7e0c8'];
const HAIR = ['#2b1d16', '#5a3a22', '#9a5b2a', '#d6b25e', '#1f2230', '#7d2c2c', '#6e6e7a'];
const SHIRT = ['#0f766e', '#2563eb', '#dc6b4a', '#7c3aed', '#d4932b', '#15803d', '#db2777', '#0891b2', '#475569'];
function looks(id) {
  const h = hash(id);
  return { skin: SKIN[h % SKIN.length], hair: HAIR[(h >> 4) % HAIR.length], shirt: SHIRT[(h >> 8) % SHIRT.length], style: (h >> 12) % 3, phase: (h >> 16) % 100 };
}
function avatar(id, cls = '', dim = false) {
  const L = looks(id);
  const hair = L.style === 1
    ? `<path d="M8.5 14c0-6 3.4-8.6 7.5-8.6s7.5 2.6 7.5 8.6v5h-2.6v-6.2c-1.6-1.3-3-2.6-4.9-3.6-1.9 1.4-4.3 2.6-5 3.6V19H8.5z" fill="${L.hair}"/>`
    : L.style === 2
      ? `<path d="M9.2 12.6c.3-4.4 3.3-7 6.8-7s6.5 2.6 6.8 7c-2.2-1.6-4.4-2.4-6.8-2.4s-4.6.8-6.8 2.4z" fill="${L.hair}"/>`
      : `<path d="M8.8 13.4c0-5 3.2-7.8 7.2-7.8s7.2 2.8 7.2 7.8c-1.3-1.8-3.3-3.4-5.6-3.6-2.6 1.6-5.4 2.6-8.8 3.6z" fill="${L.hair}"/>`;
  return `<svg class="avatar ${cls}" viewBox="0 0 32 32" aria-hidden="true" style="${dim ? 'opacity:.55;filter:grayscale(.6)' : ''}">
    <circle cx="16" cy="16" r="16" fill="${L.shirt}" opacity=".16"/>
    <path d="M5 31c1.4-6.4 5.6-9.4 11-9.4s9.6 3 11 9.4" fill="${L.shirt}"/>
    <circle cx="16" cy="14" r="7" fill="${L.skin}"/>${hair}
    <circle cx="13.4" cy="14.6" r=".9" fill="#1f2230"/><circle cx="18.6" cy="14.6" r=".9" fill="#1f2230"/></svg>`;
}
const isPresent = (s) => s.live || s.state === 'calisiyor';

// =====================================================================
// Veri akışı
// =====================================================================
function connect() {
  const es = new EventSource('/api/stream');
  es.onopen = () => { $('#conn').classList.add('on'); $('#conn span').textContent = 'Canlı bağlı'; };
  es.onmessage = (e) => { S = JSON.parse(e.data); render(); };
  es.onerror = () => { $('#conn').classList.remove('on'); $('#conn span').textContent = 'Yeniden bağlanıyor…'; };
}

function allEvents() {
  const out = [];
  for (const s of S.sessions) for (const r of s.recent || []) out.push({ ...r, ms: ts(r.t), s });
  return out.sort((a, b) => b.ms - a.ms);
}

// =====================================================================
// Yönlendirme
// =====================================================================
const TITLES = { genel: 'Genel bakış', ofis: 'Ofis', akis: 'Canlı akış', oturumlar: 'Oturumlar', projeler: 'Projeler' };
function setRoute(r) {
  if (!TITLES[r]) r = 'genel';
  route = r;
  $$('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === r));
  $$('.view').forEach((v) => { v.hidden = v.id !== 'view-' + r; });
  $('#pageTitle').textContent = TITLES[r];
  $('#searchResults').hidden = true;
  if (window.Office3D && o3Mounted) window.Office3D.setActive(r === 'ofis' && mode3d);
  if (S) render();
}
window.addEventListener('hashchange', () => setRoute(location.hash.slice(1)));

function render() {
  if (!S) return;
  $('#navSessions').textContent = S.sessions.length;
  $('#navProjects').textContent = S.projects.filter((p) => p.sessionIds.length).length;
  $('#updated').textContent = 'Güncellendi ' + new Date(S.generatedAt).toLocaleTimeString('tr-TR');
  // Kullanıcı bir açılır listeyle uğraşırken içeriği yeniden çizme
  const busyUI = document.activeElement && document.activeElement.matches('select');
  if (route === 'genel') renderOverview();
  if (route === 'ofis') layoutOffice();
  if (route === 'akis' && !busyUI) renderFeed();
  if (route === 'oturumlar' && !busyUI) renderSessions();
  if (route === 'projeler') renderProjects();
  if (drawerId) renderDrawer();
}

// =====================================================================
// Genel bakış
// =====================================================================
function renderOverview() {
  const ses = S.sessions;
  const busy = ses.filter((s) => s.state === 'calisiyor');
  const wait = ses.filter((s) => s.state === 'bekliyor');
  const idleLive = ses.filter((s) => s.live && s.state === 'bosta');
  const ev = allEvents();
  const lastHour = ev.filter((e) => e.kind === 'tool' && Date.now() - e.ms < 3600_000).length;
  const t = S.totals;

  // son 6 saat, 15 dk'lık dilimler
  const N = 24, span = 15 * 60_000, start = Date.now() - N * span;
  const buckets = Array(N).fill(0);
  for (const e of ev) if (e.kind === 'tool' && e.ms >= start) buckets[Math.min(N - 1, Math.floor((e.ms - start) / span))]++;
  const mx = Math.max(1, ...buckets);

  const kpi = (l, v, h, go, dot) => `<div class="kpi" ${go ? `data-go="${go}"` : ''}><div class="l">${dot ? `<i class="dot ${dot}"></i>` : ''}${l}</div><div class="v">${v}</div><div class="h">${h}</div></div>`;
  $('#view-genel').innerHTML = `
    <div class="grid kpis">
      ${kpi('Çalışıyor', busy.length, 'şu an iş yapan agent', 'oturumlar:calisiyor', 'calisiyor')}
      ${kpi('Onay bekliyor', wait.length, wait.length ? 'senin cevabını bekliyor' : 'bekleyen yok', 'oturumlar:bekliyor', 'bekliyor')}
      ${kpi('Açık oturum', t.live, `${idleLive.length} tanesi boşta`, 'oturumlar:canli')}
      ${kpi('Alt agent', `${t.activeSubagents}<span style="font-size:15px;color:var(--muted)"> / ${t.subagents}</span>`, 'aktif / toplam', null)}
      ${kpi('Son 1 saat', lastHour, 'araç adımı', 'akis')}
      ${kpi('Proje', t.projectsWithSessions, `${t.sessions} oturum · diskte ${t.projects} klasör`, 'projeler')}
    </div>
    <div class="grid two">
      <div class="stack">
        <div class="card">
          <div class="card-h"><h2>Şu an çalışanlar</h2><span class="sub">${busy.length + wait.length} agent</span></div>
          <div class="card-b">${busy.length + wait.length ? `<div class="workers">${[...wait, ...busy].map(workerCard).join('')}</div>` : '<div class="empty">Şu an çalışan agent yok. Ofis sakin ☕</div>'}</div>
        </div>
        <div class="card">
          <div class="card-h"><h2>Son 6 saatin temposu</h2><span class="sub">15 dakikalık dilimlerde araç adımı · en yoğun ${mx}</span></div>
          <div class="card-b"><div class="chart">${buckets.map((n, i) => `<div class="b" style="height:${(n / mx) * 100}%" title="${hhmm(start + i * span)} · ${n} adım"></div>`).join('')}</div>
          <div class="chart-x"><span>${hhmm(start)}</span><span>${hhmm(start + span * N / 2)}</span><span>şimdi</span></div></div>
        </div>
        <div class="card">
          <div class="card-h"><h2>Açık ama boşta</h2><span class="sub">${idleLive.length} oturum · sıra sende olabilir</span></div>
          <div class="card-b">${idleLive.length ? `<ul class="rows">${idleLive.map(rowItem).join('')}</ul>` : '<div class="empty">Yok</div>'}</div>
        </div>
      </div>
      <div class="stack">
        <div class="card">
          <div class="card-h"><h2>Dikkat gerektirenler</h2><span class="sub">${S.alerts.length}</span></div>
          <div class="card-b">${S.alerts.length ? S.alerts.slice(0, 8).map(alertItem).join('') : '<div class="empty">Her şey yolunda ✓</div>'}</div>
        </div>
        <div class="card">
          <div class="card-h"><h2>Canlı akış</h2><a href="#akis" class="sub">tümünü gör →</a></div>
          <div class="card-b"><ul class="feed">${ev.slice(0, 14).map(feedItem).join('') || '<div class="empty">Henüz hareket yok</div>'}</ul></div>
        </div>
      </div>
    </div>`;
}

function nowBox(s) {
  const lt = s.lastTool;
  if (s.state === 'bekliyor') return `<div class="now"><span class="ri">⏳</span><span class="tx">Senin onayını bekliyor<small>${esc(ago(s.statusSince))}</small></span></div>`;
  if (!lt) return `<div class="now"><span class="ri">💭</span><span class="tx">Düşünüyor${s.state === 'calisiyor' ? '<span class="typing"><i></i><i></i><i></i></span>' : ''}</span></div>`;
  const [ic, lbl] = role(lt.role);
  return `<div class="now"><span class="ri">${ic}</span><span class="tx">${esc(lt.human || lt.detail)}${s.state === 'calisiyor' ? '<span class="typing"><i></i><i></i><i></i></span>' : ''}<small>${esc(lbl)} · ${esc(cleanTool(lt.name))} · ${esc(ago(ts(lt.t)))}</small></span></div>`;
}

function workerCard(s) {
  const steps = (s.recent || []).filter((r) => r.kind === 'tool').slice(-4, -1).reverse();
  const subA = (s.subagents || []).filter((a) => a.active);
  return `<div class="worker ${s.state}" data-open="${esc(s.id)}">
    <div class="w-h">${avatar(s.id)}<div style="min-width:0"><div class="w-name">${esc(s.name)}</div><div class="w-proj">${esc(s.project)}${s.gitBranch ? ' · ⎇ ' + esc(s.gitBranch) : ''}</div></div>
      <span class="pill ${s.state}" style="margin-left:auto"><i class="dot ${s.state}"></i>${STATE_LABEL[s.state]}</span></div>
    ${nowBox(s)}
    ${steps.length ? `<ul class="steps">${steps.map((r) => `<li><span class="t">${hhmm(r.t)}</span><span>${role(r.role)[0]} ${esc(r.human || r.text)}</span></li>`).join('')}</ul>` : ''}
    ${subA.length ? `<div class="w-proj">👥 ${subA.length} alt agent çalışıyor: ${esc(subA.map((a) => a.description || a.type).join(' · '))}</div>` : ''}
  </div>`;
}

function rowItem(s) {
  const lt = s.lastTool;
  return `<li data-open="${esc(s.id)}">${avatar(s.id, 'sm', !isPresent(s))}<div class="r-main"><div class="r-t">${esc(s.name)}</div>
    <div class="r-s">${esc(s.project)}${lt ? ' · son: ' + esc(lt.human || lt.detail) : ''}</div></div><span class="r-x">${esc(ago(s.statusSince || s.mtimeMs))}</span></li>`;
}

function alertItem(a) {
  const ic = a.level === 'high' ? '⏳' : a.level === 'mid' ? '⚠️' : '💤';
  return `<div class="alert ${a.level}" ${a.sessionId ? `data-open="${esc(a.sessionId)}"` : `data-projsessions="${esc(a.projectKey)}"`}><span>${ic}</span><div><b>${esc(a.title)}</b><span>${esc(a.text)}</span></div></div>`;
}

function feedItem(e) {
  const s = e.s;
  const [ic] = e.kind === 'tool' ? role(e.role) : e.kind === 'user' ? ['🙋'] : ['💬'];
  const what = e.kind === 'tool' ? (e.human || e.text) : e.kind === 'user' ? `İstek: “${e.text}”` : e.text;
  return `<li class="${e.kind}" data-open="${esc(s.id)}"><span class="ft">${hhmm(e.t)}</span><span class="fi">${ic}</span>
    <div class="fx"><span class="who">${esc(e.kind === 'user' ? 'Sen' : s.name)}</span><span class="what">${esc(String(what).slice(0, 220))}</span>
    <div class="where">${e.kind === 'user' ? esc(s.name) + ' · ' : ''}${esc(s.project)}</div></div></li>`;
}

// =====================================================================
// Canlı akış
// =====================================================================
function renderFeed() {
  const ev = allEvents().filter((e) => (!ui.feedRole || (e.kind === 'tool' && e.role === ui.feedRole) || (ui.feedRole === 'user' && e.kind === 'user'))
    && (!ui.feedProj || e.s.projectKey === ui.feedProj)).slice(0, 400);
  const projs = [...new Map(S.sessions.map((s) => [s.projectKey, s.project]))].sort((a, b) => a[1].localeCompare(b[1], 'tr'));
  let lastDay = '';
  const items = ev.map((e) => {
    const day = new Date(e.ms).toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });
    const head = day !== lastDay ? `<li class="day" style="display:block;cursor:default">${esc(day)}</li>` : '';
    lastDay = day;
    return head + feedItem(e);
  }).join('');
  $('#view-akis').innerHTML = `
    <div class="filters">
      <div class="seg" id="feedRoles">
        <button data-v="" class="${!ui.feedRole ? 'on' : ''}">Hepsi</button>
        <button data-v="user" class="${ui.feedRole === 'user' ? 'on' : ''}">🙋 İsteklerin</button>
        ${['eposta', 'mesaj', 'is-takip', 'tarayici', 'kod', 'terminal', 'yonetici'].map((r) => `<button data-v="${r}" class="${ui.feedRole === r ? 'on' : ''}">${role(r)[0]} ${role(r)[1]}</button>`).join('')}
      </div>
      <select class="sel" id="feedProj"><option value="">Tüm projeler</option>${projs.map(([k, n]) => `<option value="${esc(k)}" ${ui.feedProj === k ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
      <span class="grow"></span><span style="color:var(--muted);font-size:12px">${ev.length} olay · her oturumun son bölümünden</span>
    </div>
    <div class="card"><div class="card-b" style="padding-top:8px"><ul class="feed">${items || '<div class="empty">Eşleşen olay yok</div>'}</ul></div></div>`;
}

// =====================================================================
// Oturumlar tablosu
// =====================================================================
function sessionFilter(s, q) {
  const f = ui.stateF;
  if (f === 'canli' && !s.live) return false;
  if (f && f !== 'canli' && s.state !== f) return false;
  if (ui.projF && s.projectKey !== ui.projF) return false;
  return matchQ(s, q);
}
const matchQ = (s, q) => !q || [s.name, s.project, s.lastPrompt, s.firstPrompt, s.cwdShort, s.title].some((v) => v && v.toLocaleLowerCase('tr').includes(q));

function renderSessions() {
  const q = $('#search').value.trim().toLocaleLowerCase('tr');
  const order = { calisiyor: 0, bekliyor: 1, bosta: 2, kapali: 3, arsiv: 4 };
  const key = ui.sortKey;
  const val = (s) => (key === 'state' ? order[s.state] : key === 'name' ? s.name : (s[key] || 0));
  const list = S.sessions.filter((s) => sessionFilter(s, q)).sort((a, b) => {
    const va = val(a), vb = val(b);
    return (typeof va === 'string' ? va.localeCompare(vb, 'tr') : va - vb) * ui.sortDir || b.mtimeMs - a.mtimeMs;
  });
  const counts = (f) => S.sessions.filter((s) => (!ui.projF || s.projectKey === ui.projF) && (f === 'canli' ? s.live : !f || s.state === f)).length;
  const chips = [['', 'Hepsi'], ['canli', 'Açık'], ['calisiyor', 'Çalışıyor'], ['bekliyor', 'Onay bekliyor'], ['bosta', 'Boşta'], ['kapali', 'Son 14 gün'], ['arsiv', 'Arşiv']];
  const projs = [...new Map(S.sessions.map((s) => [s.projectKey, s.project]))].sort((a, b) => a[1].localeCompare(b[1], 'tr'));
  const th = (k, l) => `<th data-sort="${k}">${l}${ui.sortKey === k ? `<span class="arr">${ui.sortDir < 0 ? '↓' : '↑'}</span>` : ''}</th>`;
  $('#view-oturumlar').innerHTML = `
    <div class="filters">
      <div class="seg" id="stateChips">${chips.map(([v, l]) => `<button data-v="${v}" class="${ui.stateF === v ? 'on' : ''}">${l} <span style="opacity:.6">${counts(v)}</span></button>`).join('')}</div>
      <select class="sel" id="projSel"><option value="">Tüm projeler</option>${projs.map(([k, n]) => `<option value="${esc(k)}" ${ui.projF === k ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
      <span class="grow"></span><span style="color:var(--muted);font-size:12px">${list.length} oturum${q ? ` · “${esc(q)}” araması` : ''}</span>
    </div>
    <div class="table-wrap"><table>
      <thead><tr>${th('state', 'Durum')}${th('name', 'Oturum')}<th>Şu an / son eylem</th>${th('mtimeMs', 'Son hareket')}<th>Alt agent</th>${th('sizeBytes', 'Kayıt')}<th></th></tr></thead>
      <tbody>${list.map((s) => {
        const lt = s.lastTool; const subA = (s.subagents || []).filter((a) => a.active).length; const subT = (s.subagents || []).length;
        return `<tr data-open="${esc(s.id)}" class="${s.id === drawerId ? 'sel' : ''}">
          <td><span class="pill ${s.state}"><i class="dot ${s.state}"></i>${STATE_LABEL[s.state]}</span></td>
          <td><div style="display:flex;gap:10px;align-items:center">${avatar(s.id, 'sm', !isPresent(s))}<div style="min-width:0"><div class="nm">${esc(s.name)}</div><div class="sb">${esc(s.project)}${s.gitBranch ? ' · ⎇ ' + esc(s.gitBranch) : ''}</div></div></div></td>
          <td class="act"><div>${lt ? `${role(lt.role)[0]} ${esc(lt.human || lt.detail)}` : '<span style="color:var(--muted)">—</span>'}</div></td>
          <td class="num">${esc(ago(s.mtimeMs))}</td>
          <td class="num">${subT ? (subA ? `<b style="color:var(--ok)">${subA} aktif</b> / ${subT}` : subT) : '—'}</td>
          <td class="num">${mb(s.sizeBytes)}</td>
          <td style="text-align:right">${s.live ? '<button class="btn sm" data-act="open-claude-app">Uygulamada aç</button>' : (s.cwd ? `<button class="btn sm" data-act="resume-terminal" data-sid="${esc(s.id)}">Devam et</button>` : '')}</td></tr>`;
      }).join('') || '<tr><td colspan="7"><div class="empty">Eşleşen oturum yok</div></td></tr>'}</tbody>
    </table></div>`;
}

// =====================================================================
// Projeler
// =====================================================================
function renderProjects() {
  const q = $('#search').value.trim().toLocaleLowerCase('tr');
  const match = (p) => !q || [p.name, p.dirShort].some((v) => v && v.toLocaleLowerCase('tr').includes(q));
  const withS = S.projects.filter((p) => p.sessionIds.length && match(p));
  const noS = S.projects.filter((p) => !p.sessionIds.length && match(p));
  const byId = new Map(S.sessions.map((s) => [s.id, s]));
  const card = (p) => {
    const g = p.git;
    const sess = p.sessionIds.map((id) => byId.get(id)).filter(Boolean).sort((a, b) => b.mtimeMs - a.mtimeMs);
    const last = sess[0];
    const gitHtml = g ? `<div class="gitline"><span>⎇ ${esc(g.branch)} · ${g.dirty ? `<span class="w">${g.dirty} kaydedilmemiş değişiklik</span>` : 'temiz'}</span>${g.lastCommit ? `<span class="c">Son commit ${esc(ago(ts(g.lastCommit.date)))}: ${esc(g.lastCommit.subject)}</span>` : ''}</div>`
      : p.isGit && g === null ? '<div class="gitline"><span class="c" title="Arka planda çalışan sunucunun Masaüstü klasörüne erişim izni yok (Sistem Ayarları → Gizlilik → Tam Disk Erişimi → node)">git bilgisi okunamadı · macOS izin vermiyor</span></div>'
      : p.isGit === false || g === null ? (p.dir ? '<div class="gitline"><span class="c">git deposu değil</span></div>' : '')
        : (p.onDisk ? '<div class="gitline"><span class="c">git durumu okunuyor…</span></div>' : '');
    return `<div class="card proj">
      <div class="proj-h"><div style="min-width:0"><b>${esc(p.name)}</b><div class="path">${esc(p.dirShort || 'Claude uygulamasındaki sohbet çalışma alanları')}${p.onDisk === false && p.dir ? ' · <span style="color:var(--danger)">klasör bulunamadı</span>' : ''}</div></div>
        ${p.busyCount ? '<span class="pill calisiyor"><i class="dot calisiyor"></i>Çalışıyor</span>' : p.liveCount ? '<span class="pill bosta"><i class="dot bosta"></i>Açık</span>' : ''}</div>
      ${sess.length ? `<div class="stats"><div><b>${sess.length}</b>oturum</div><div><b>${p.liveCount}</b>açık</div><div><b>${sess.reduce((n, s) => n + (s.subagents || []).length, 0)}</b>alt agent</div><div><b>${(p.memory || []).length}</b>hafıza notu</div></div>` : ''}
      ${gitHtml}
      ${p.hasClaudeMd ? '<div class="r-s">📄 CLAUDE.md talimat dosyası var</div>' : ''}
      ${last ? `<div class="r-s">Son oturum: <a href="#" data-open="${esc(last.id)}">${esc(last.name)}</a> · ${esc(ago(last.mtimeMs))}</div>` : ''}
      <div class="btns">
        ${sess.length ? `<button class="btn sm" data-projsessions="${esc(p.key)}">Oturumları gör</button>` : ''}
        ${p.dir && p.onDisk !== false ? `<button class="btn sm primary" data-act="new-terminal" data-pkey="${esc(p.key)}">Yeni Claude oturumu</button>
          <button class="btn sm" data-act="open-vscode" data-pkey="${esc(p.key)}">VS Code</button>
          <button class="btn sm" data-act="open-folder" data-pkey="${esc(p.key)}">Klasör</button>` : ''}
      </div></div>`;
  };
  $('#view-projeler').innerHTML = `
    <div class="section-t" style="margin-top:0">Claude ile çalıştığın projeler <span>${withS.length}</span></div>
    <div class="projects">${withS.map(card).join('') || '<div class="empty">Yok</div>'}</div>
    <div class="section-t">Diskte olup henüz Claude oturumu olmayanlar <span>${noS.length} · taranan: ${esc(S.config.projectRoots.join(', '))}</span></div>
    <div class="projects">${noS.map(card).join('') || '<div class="empty">Yok</div>'}</div>`;
}

// =====================================================================
// Detay çekmecesi
// =====================================================================
function openDrawer(id) {
  drawerId = id; drawerTab = 'akis';
  if (route === 'ofis' && mode3d && window.Office3D && o3Mounted) window.Office3D.focus(id);
  $('#drawer').hidden = false; $('#scrim').hidden = false;
  renderDrawer();
  if (route === 'ofis') drawOffice();
  if (route === 'oturumlar') renderSessions();
}
function closeDrawer() {
  drawerId = null; $('#drawer').hidden = true; $('#scrim').hidden = true;
  if (route === 'ofis') drawOffice();
  if (route === 'oturumlar') renderSessions();
}
function actionButtons(s) {
  const b = [];
  if (s.live) b.push(['open-claude-app', 'Claude uygulamasında aç', 1]);
  else if (s.cwd) b.push(['resume-terminal', "Terminal'de devam et", 1]);
  if (s.cwd && !s.cwd.includes('/scratch-workspaces/')) { b.push(['open-vscode', 'VS Code']); b.push(['open-folder', 'Klasör']); }
  if (s.transcript) b.push(['reveal-transcript', 'Kayıt dosyası']);
  return b.map(([a, l, p]) => `<button class="btn ${p ? 'primary' : ''}" data-act="${a}" data-sid="${esc(s.id)}">${esc(l)}</button>`).join('');
}
function renderDrawer() {
  const s = S && S.sessions.find((x) => x.id === drawerId);
  const el = $('#drawer');
  if (!s) { el.innerHTML = '<div class="dr-b"><button class="close" id="drClose">×</button><div class="empty">Oturum bulunamadı</div></div>'; return; }
  const scroll = $('.dr-b', el) ? $('.dr-b', el).scrollTop : 0;
  const subs = s.subagents || [];
  const recent = (s.recent || []).slice().reverse();
  let body = '';
  if (drawerTab === 'akis') {
    body = recent.length ? `<ul class="tl">${recent.map((r) => {
      const ic = r.kind === 'tool' ? role(r.role)[0] : r.kind === 'user' ? '🙋' : '💬';
      const tx = r.kind === 'tool' ? `${esc(r.human || r.text)} <code style="color:var(--muted)">${esc(cleanTool(r.name))}</code>` : esc(r.text);
      return `<li class="${r.kind}"><span class="tm">${hhmm(r.t)}</span><span class="ic">${ic}</span><span class="tx">${tx}</span></li>`;
    }).join('')}</ul><p class="empty" style="text-align:left">Kaydın son bölümünden ${recent.length} adım gösteriliyor.</p>` : '<div class="empty">Kayıt yok</div>';
  } else if (drawerTab === 'araclar') {
    const roles = Object.entries(s.roles || {}).sort((a, b) => b[1] - a[1]);
    const mxr = Math.max(1, ...roles.map((r) => r[1]));
    const tools = s.topTools || [];
    const mxt = Math.max(1, ...tools.map((r) => r[1]));
    body = `<div class="h3" style="margin-top:0">İş türü</div><div class="bars">${roles.map(([r, n]) => `<div class="bar"><span>${role(r)[0]} ${role(r)[1]}</span><span class="track"><span class="fill" style="display:block;width:${(n / mxr) * 100}%"></span></span><span class="n">${n}</span></div>`).join('') || '<div class="empty">Yok</div>'}</div>
      <div class="h3">En çok kullanılan araçlar</div><div class="bars">${tools.map(([tl, n]) => `<div class="bar"><span class="mono" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(cleanTool(tl))}</span><span class="track"><span class="fill" style="display:block;width:${(n / mxt) * 100}%;opacity:.7"></span></span><span class="n">${n}</span></div>`).join('') || '<div class="empty">Yok</div>'}</div>
      <p class="empty" style="text-align:left">Büyük kayıtlarda yalnızca son bölüm sayılır.</p>`;
  } else if (drawerTab === 'ekip') {
    body = subs.length ? `<ul class="rows">${subs.map((a) => `<li style="cursor:default">${avatar(a.id, 'sm', !a.active)}<div class="r-main"><div class="r-t">${esc(a.description || 'Görev')}</div>
      <div class="r-s">${esc(a.type)}${a.lastTool ? ' · ' + esc(a.lastTool.human || a.lastTool.detail) : ''}</div></div>
      <span class="r-x">${a.active ? '<span class="pill calisiyor"><i class="dot calisiyor"></i>Çalışıyor</span>' : esc(ago(a.mtimeMs))}</span></li>`).join('')}</ul>`
      : '<div class="empty">Bu oturum alt agent kullanmamış.</div>';
  } else {
    body = `<dl class="kv">
      <dt>Proje</dt><dd>${esc(s.project)}</dd><dt>Klasör</dt><dd class="mono">${esc(s.cwdShort || '—')}</dd>
      ${s.gitBranch ? `<dt>Git dalı</dt><dd>${esc(s.gitBranch)}</dd>` : ''}${s.model ? `<dt>Model</dt><dd>${esc(s.model)}</dd>` : ''}
      <dt>Başladı</dt><dd>${s.firstTs ? esc(new Date(s.firstTs).toLocaleString('tr-TR')) : '—'}</dd>
      <dt>Son hareket</dt><dd>${esc(new Date(s.mtimeMs).toLocaleString('tr-TR'))} (${esc(ago(s.mtimeMs))})</dd>
      <dt>Kayıt boyutu</dt><dd>${mb(s.sizeBytes)}</dd>${s.pid ? `<dt>Süreç</dt><dd class="mono">pid ${s.pid}${s.entrypoint ? ' · ' + esc(s.entrypoint) : ''}</dd>` : ''}
      <dt>Oturum kimliği</dt><dd class="mono">${esc(s.id)}</dd></dl>
      ${s.firstPrompt ? `<div class="h3">İlk isteğin</div><div class="quote">${esc(s.firstPrompt)}</div>` : ''}`;
  }
  el.innerHTML = `
    <div class="dr-h">
      <div class="dr-top">${avatar(s.id, 'lg', !isPresent(s))}<div style="min-width:0;flex:1"><p class="dr-title">${esc(s.name)}</p>
        <div class="dr-meta"><span class="pill ${s.state}"><i class="dot ${s.state}"></i>${STATE_LABEL[s.state]}</span><span>${esc(s.project)}</span><span>· ${esc(ago(s.mtimeMs))}</span></div></div>
        <button class="close" id="drClose" aria-label="Kapat">×</button></div>
      ${s.state === 'calisiyor' || s.state === 'bekliyor' ? nowBox(s) : ''}
      ${s.lastPrompt ? `<div><div class="h3" style="margin:0 0 6px">Son isteğin</div><div class="quote" style="max-height:90px">${esc(s.lastPrompt)}</div></div>` : ''}
      <div class="btns">${actionButtons(s)}</div>
    </div>
    <div class="dr-tabs">${[['akis', 'Zaman çizelgesi'], ['araclar', 'Araçlar'], ['ekip', `Alt agent'lar (${subs.length})`], ['bilgi', 'Bilgi']].map(([k, l]) => `<button data-drtab="${k}" class="${drawerTab === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="dr-b">${body}</div>`;
  $('.dr-b', el).scrollTop = scroll;
}

// =====================================================================
// Ofis (illüstrasyon)
// =====================================================================
const CELL_W = 196, CELL_H = 214, ROOM_PAD = 14, HEAD_H = 46, GAP = 22;
let rooms = [], hit = [], hoverId = null, worldW = 0, worldH = 0, tick = 0, ctx = null;
const dark = () => (document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches);

function officeSessions() {
  return S.sessions.filter((s) => {
    if (officeFilter === 'calisan') return s.state === 'calisiyor' || s.state === 'bekliyor';
    if (officeFilter === 'acik') return s.live || s.state === 'calisiyor';
    return s.live || s.state === 'calisiyor' || s.state === 'kapali';
  });
}

function rooms3d() {
  const groups = new Map();
  for (const s of officeSessions()) { if (!groups.has(s.projectKey)) groups.set(s.projectKey, []); groups.get(s.projectKey).push(s); }
  return [...groups.entries()].map(([key, list]) => ({
    key, name: (S.projects.find((p) => p.key === key) || {}).name || list[0].project,
    // masalar yer değiştirmesin: başlangıç zamanına göre sabit sıra
    list: list.slice().sort((a, b) => (ts(a.firstTs) || a.mtimeMs) - (ts(b.firstTs) || b.mtimeMs)),
  })).sort((a, b) => (b.list.some((s) => s.live) - a.list.some((s) => s.live)) || a.name.localeCompare(b.name, 'tr'));
}
function mount3d() {
  if (o3Mounted || !window.Office3D) return;
  o3Mounted = true;
  window.Office3D.mount($('#office3d'), {
    onSelect: (id) => openDrawer(id),
    onHover: (id, x, y) => {
      const tip = $('#tooltip3d');
      const s = id && S.sessions.find((v) => v.id === id);
      if (!s) { tip.hidden = true; return; }
      const lt = s.lastTool, subA = (s.subagents || []).filter((a) => a.active);
      tip.innerHTML = `<div class="tt">${esc(s.name)}</div><div class="ts">${STATE_LABEL[s.state]} · ${esc(s.project)} · ${esc(ago(s.mtimeMs))}</div>
        ${lt ? `<div style="margin-top:6px">${role(lt.role)[0]} ${esc(lt.human || lt.detail)}</div>` : ''}
        ${subA.length ? `<div class="ts" style="margin-top:4px">👥 ${esc(subA.map((a) => a.description || a.type).join(' · '))}</div>` : ''}
        ${s.lastPrompt ? `<div class="ts" style="margin-top:6px">Son isteğin: “${esc(s.lastPrompt.slice(0, 110))}”</div>` : ''}`;
      const r = $('#office3d').getBoundingClientRect();
      let lx = x - r.left + 16; if (lx + 330 > r.width) lx -= 350;
      tip.style.left = Math.max(8, lx) + 'px'; tip.style.top = (y - r.top + 16) + 'px'; tip.hidden = false;
    },
    onError: () => { mode3d = false; toast('3B ofis yüklenemedi (internet gerekli); 2B görünüme geçildi'); syncModeUI(); layoutOffice(); },
  });
}
function syncModeUI() {
  $$('#viewMode button').forEach((b) => b.classList.toggle('on', (b.dataset.v === '3d') === mode3d));
  $('#zoom2d').hidden = mode3d; $('#overviewBtn').hidden = !mode3d;
  $('#officeWrap').hidden = mode3d; $('#office3d').hidden = !mode3d;
}
window.addEventListener('office3d-ready', () => { if (S && route === 'ofis') layoutOffice(); });

function layoutOffice() {
  syncModeUI();
  if (mode3d) {
    if (!window.Office3D) return; // modül yükleniyor
    mount3d();
    window.Office3D.setActive(true);
    window.Office3D.update(rooms3d(), drawerId);
    return;
  }
  const wrap = $('#officeWrap');
  const maxW = Math.max(320, wrap.clientWidth / zoom);
  const groups = new Map();
  for (const s of officeSessions()) { if (!groups.has(s.projectKey)) groups.set(s.projectKey, []); groups.get(s.projectKey).push(s); }
  const order = { calisiyor: 0, bekliyor: 1, bosta: 2, kapali: 3, arsiv: 4 };
  const list = [...groups.entries()].map(([k, arr]) => {
    arr.sort((a, b) => (b.live - a.live) || order[a.state] - order[b.state] || b.mtimeMs - a.mtimeMs);
    return { project: S.projects.find((p) => p.key === k) || { key: k, name: arr[0].project }, list: arr };
  }).sort((a, b) => (b.list.some((s) => s.live) - a.list.some((s) => s.live)) || a.project.name.localeCompare(b.project.name, 'tr'));

  rooms = [];
  let x = GAP, y = GAP, rowH = 0;
  for (const { project, list: arr } of list) {
    const maxCols = Math.max(1, Math.floor((maxW - 2 * GAP - 2 * ROOM_PAD) / CELL_W));
    const shown = arr.slice(0, 8);
    const cols = Math.min(maxCols, Math.max(1, Math.min(4, shown.length)));
    const rows = Math.ceil(shown.length / cols);
    const w = cols * CELL_W + 2 * ROOM_PAD, h = HEAD_H + rows * CELL_H + ROOM_PAD + (arr.length > shown.length ? 14 : 0);
    if (x + w > maxW - GAP + 1 && x > GAP) { x = GAP; y += rowH + GAP; rowH = 0; }
    const r = { project, x, y, w, h, more: arr.length - shown.length, all: arr, desks: [] };
    shown.forEach((s, i) => r.desks.push({ s, x: x + ROOM_PAD + (i % cols) * CELL_W, y: y + HEAD_H + Math.floor(i / cols) * CELL_H }));
    rooms.push(r);
    x += w + GAP; rowH = Math.max(rowH, h);
  }
  worldW = maxW; worldH = Math.max(200, y + rowH + GAP);
  const c = $('#office'), dpr = window.devicePixelRatio || 1;
  c.style.width = worldW * zoom + 'px'; c.style.height = worldH * zoom + 'px';
  c.width = Math.floor(worldW * zoom * dpr); c.height = Math.floor(worldH * zoom * dpr);
  drawOffice();
}

function rr(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
function fillRR(x, y, w, h, r, c) { rr(x, y, w, h, r); ctx.fillStyle = c; ctx.fill(); }
function circle(x, y, r, c) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = c; ctx.fill(); }
const FONT = 'Inter, -apple-system, BlinkMacSystemFont, system-ui, sans-serif';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';
function text(t, x, y, { size = 12, weight = 500, color = '#111', font, maxW, align = 'left' } = {}) {
  ctx.font = `${weight} ${size}px ${font === 'mono' ? MONO : FONT}`;
  ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
  let s = String(t);
  if (maxW && ctx.measureText(s).width > maxW) { while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1); s += '…'; }
  ctx.fillText(s, x, y);
}
function wrapLines(t, maxW, maxLines, size) {
  ctx.font = `500 ${size}px ${MONO}`;
  const words = String(t).split(/\s+/).filter(Boolean); const lines = []; let cur = ''; let i = 0;
  for (; i < words.length; i++) {
    const tryL = cur ? cur + ' ' + words[i] : words[i];
    if (ctx.measureText(tryL).width <= maxW) cur = tryL;
    else { if (cur) lines.push(cur); cur = words[i]; if (lines.length === maxLines) break; }
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  const out = lines.slice(0, maxLines);
  if (i < words.length || lines.length > maxLines) {
    let last = out[out.length - 1] || ''; while (last.length > 1 && ctx.measureText(last + '…').width > maxW) last = last.slice(0, -1); out[out.length - 1] = last + '…';
  }
  return out.map((ln) => { while (ln.length > 1 && ctx.measureText(ln).width > maxW) ln = ln.slice(0, -2) + '…'; return ln; });
}

function drawOffice() {
  if (!S || route !== 'ofis' || mode3d) return;
  const c = $('#office'); ctx = c.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(zoom * dpr, 0, 0, zoom * dpr, 0, 0);
  ctx.clearRect(0, 0, worldW, worldH);
  hit = [];
  if (!rooms.length) { text('Bu filtrede gösterilecek oturum yok.', 30, 50, { size: 15, color: dark() ? '#8b949e' : '#6b7280' }); return; }
  for (const r of rooms) drawRoom(r);
}

function drawRoom(r) {
  const D = dark();
  const busy = r.all.filter((s) => s.state === 'calisiyor').length, live = r.all.filter((s) => s.live).length;
  ctx.save(); ctx.shadowColor = D ? 'rgba(0,0,0,.5)' : 'rgba(16,24,40,.10)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 4;
  fillRR(r.x, r.y, r.w, r.h, 16, D ? '#161d26' : '#ffffff'); ctx.restore();
  // zemin
  ctx.save(); rr(r.x, r.y + HEAD_H, r.w, r.h - HEAD_H, [0, 0, 16, 16]); ctx.clip();
  ctx.fillStyle = D ? '#1b232e' : '#f4efe7'; ctx.fillRect(r.x, r.y + HEAD_H, r.w, r.h);
  ctx.strokeStyle = D ? 'rgba(255,255,255,.035)' : 'rgba(120,90,50,.07)'; ctx.lineWidth = 1;
  for (let gx = r.x + 24; gx < r.x + r.w; gx += 48) { ctx.beginPath(); ctx.moveTo(gx + .5, r.y + HEAD_H); ctx.lineTo(gx + .5, r.y + r.h); ctx.stroke(); }
  for (let gy = r.y + HEAD_H + 24; gy < r.y + r.h; gy += 48) { ctx.beginPath(); ctx.moveTo(r.x, gy + .5); ctx.lineTo(r.x + r.w, gy + .5); ctx.stroke(); }
  ctx.restore();
  // başlık
  ctx.fillStyle = D ? '#262e38' : '#e5e7eb'; ctx.fillRect(r.x, r.y + HEAD_H - 1, r.w, 1);
  fillRR(r.x + 14, r.y + 15, 16, 16, 4, busy ? '#16a34a' : live ? '#64748b' : (D ? '#3a4452' : '#cbd5e1'));
  const meta = [busy ? `${busy} çalışıyor` : null, live ? `${live} açık` : null, `${r.all.length} masa`].filter(Boolean).join(' · ');
  ctx.font = `400 12px ${FONT}`; const mw = ctx.measureText(meta).width;
  text(r.project.name, r.x + 38, r.y + 28, { size: 14, weight: 700, color: D ? '#e6edf3' : '#111827', maxW: r.w - 66 - mw });
  text(meta, r.x + r.w - 14, r.y + 28, { size: 12, weight: 400, color: D ? '#8b949e' : '#6b7280', align: 'right' });
  hit.push({ x: r.x, y: r.y, w: r.w, h: HEAD_H, kind: 'room', ref: r.project });
  for (const d of r.desks) drawDesk(d);
  if (r.more > 0) text(`+${r.more} oturum daha · başlığa tıkla`, r.x + r.w - 14, r.y + r.h - 10, { size: 11, color: D ? '#8b949e' : '#6b7280', align: 'right' });
}

function drawDesk(d) {
  const { s } = d, D = dark(), L = looks(s.id);
  const t = tick + L.phase;
  const cx = d.x + CELL_W / 2, y = d.y;
  const st = s.state, present = isPresent(s), working = st === 'calisiyor', waiting = st === 'bekliyor';
  const sel = s.id === drawerId, hov = s.id === hoverId;

  if (sel || hov || waiting) {
    const pulse = waiting ? (Math.sin(t / 6) + 1) / 2 : 0;
    rr(d.x + 6, y + 6, CELL_W - 12, CELL_H - 10, 14);
    if (hov || sel) { ctx.fillStyle = D ? 'rgba(255,255,255,.03)' : 'rgba(15,118,110,.04)'; ctx.fill(); }
    ctx.lineWidth = sel ? 2.5 : 1.5;
    ctx.strokeStyle = waiting ? `rgba(217,119,6,${0.45 + pulse * 0.5})` : sel ? '#0f766e' : (D ? 'rgba(255,255,255,.25)' : 'rgba(15,118,110,.35)');
    ctx.stroke();
  }

  // halı
  ctx.beginPath(); ctx.ellipse(cx, y + 156, 72, 18, 0, 0, Math.PI * 2);
  ctx.fillStyle = working ? 'rgba(22,163,74,.14)' : waiting ? 'rgba(217,119,6,.16)' : (D ? 'rgba(255,255,255,.03)' : 'rgba(80,60,30,.06)'); ctx.fill();

  // monitör — ekranda agent'ın o an yaptığı iş yazar
  const mx = cx - 66, my = y + 16, mw = 132, mh = 78;
  fillRR(mx - 4, my - 4, mw + 8, mh + 8, 9, D ? '#0b0f14' : '#1f2937');
  fillRR(mx, my, mw, mh, 6, present ? '#0f1b26' : (D ? '#06090d' : '#111827'));
  ctx.save(); rr(mx, my, mw, mh, 6); ctx.clip();
  if (working) {
    const lt = s.lastTool; const [ic, lbl] = lt ? role(lt.role) : ['💭', 'Düşünüyor'];
    ctx.fillStyle = 'rgba(43,179,154,.20)'; ctx.fillRect(mx, my, mw, 18);
    text(`${ic}  ${lbl}`, mx + 8, my + 13, { size: 10.5, weight: 650, color: '#7ee2c8', maxW: mw - 16 });
    const lines = wrapLines(lt ? (lt.human || lt.detail || '') : 'Bir sonraki adımı planlıyor', mw - 16, 4, 9.5);
    lines.forEach((ln, i) => text(ln, mx + 8, my + 32 + i * 12, { size: 9.5, color: '#d6e2ec', font: 'mono' }));
    if (Math.floor(t / 5) % 2) {
      ctx.font = `500 9.5px ${MONO}`;
      const lw = ctx.measureText(lines[lines.length - 1] || '').width;
      ctx.fillStyle = '#7ee2c8'; ctx.fillRect(Math.min(mx + mw - 12, mx + 10 + lw), my + 24 + (lines.length - 1) * 12, 5, 9);
    }
    const g = ctx.createLinearGradient(mx, my, mx + mw, my + mh); g.addColorStop(0, 'rgba(255,255,255,.06)'); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.fillRect(mx, my, mw, mh);
  } else if (waiting) {
    ctx.fillStyle = 'rgba(217,119,6,.22)'; ctx.fillRect(mx, my, mw, mh);
    text('⏳', cx, my + 36, { size: 20, align: 'center' });
    text('Onayını bekliyor', cx, my + 60, { size: 11, weight: 650, color: '#fcd9a5', align: 'center' });
  } else if (present) {
    text('💤', cx, my + 36, { size: 16, align: 'center' });
    text(`Boşta · ${ago(s.statusSince || s.mtimeMs, true)}`, cx, my + 58, { size: 10.5, color: '#8597a8', align: 'center', font: 'mono' });
  } else {
    const g = ctx.createLinearGradient(mx, my, mx + mw, my + mh); g.addColorStop(0, 'rgba(255,255,255,.08)'); g.addColorStop(.5, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.fillRect(mx, my, mw, mh);
  }
  ctx.restore();
  fillRR(cx - 7, my + mh + 4, 14, 10, 2, D ? '#0b0f14' : '#374151');
  fillRR(cx - 24, my + mh + 12, 48, 5, 3, D ? '#0b0f14' : '#374151');

  // masa
  const dx = d.x + 14, dy = y + 112, dw = CELL_W - 28;
  fillRR(dx, dy, dw, 13, 4, D ? '#5b4532' : '#c9a27a');
  fillRR(dx + 2, dy + 11, dw - 4, 6, [0, 0, 4, 4], D ? '#463526' : '#ad855e');
  fillRR(cx - 26, dy + 2, 52, 7, 2, D ? '#2b333d' : '#e5e7eb');
  if (present && !working) {
    const kx = dx + dw - 26;
    fillRR(kx, dy - 9, 11, 12, 2, D ? '#d7dde4' : '#ffffff'); ctx.strokeStyle = D ? '#d7dde4' : '#ffffff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(kx + 12, dy - 3, 3, -Math.PI / 2, Math.PI / 2); ctx.stroke();
    const sy = (t % 30) / 30;
    ctx.strokeStyle = `rgba(160,170,180,${0.6 - sy * 0.6})`; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(kx + 5, dy - 12 - sy * 8); ctx.quadraticCurveTo(kx + 9, dy - 16 - sy * 8, kx + 5, dy - 20 - sy * 8); ctx.stroke();
  }
  if (L.phase % 3 === 0) {
    fillRR(dx + 6, dy - 12, 12, 12, 2, D ? '#7c4a2f' : '#c46b3e');
    circle(dx + 9, dy - 16, 5, '#3f9a5a'); circle(dx + 15, dy - 17, 5, '#4fb06a'); circle(dx + 12, dy - 22, 5, '#5cc07a');
  }

  // kişi (arkadan, ekrana bakıyor) + sandalye
  const py = y + 140;
  if (present) {
    const bob = working ? Math.sin(t / 3) * 0.8 : Math.sin(t / 14) * 0.6;
    rr(cx - 27, py - 4 + bob, 54, 40, [18, 18, 6, 6]); ctx.fillStyle = L.shirt; ctx.fill();
    if (working) {
      const a = Math.sin(t / 1.7) * 2, b = Math.cos(t / 1.9) * 2;
      fillRR(cx - 34, dy + 4 + a, 14, 9, 5, L.shirt); circle(cx - 18, dy + 8 + a, 4.5, L.skin);
      fillRR(cx + 20, dy + 4 + b, 14, 9, 5, L.shirt); circle(cx + 18, dy + 8 + b, 4.5, L.skin);
    }
    fillRR(cx - 5, py - 12 + bob, 10, 10, 3, L.skin);
    circle(cx - 15, py - 23 + bob, 3.5, L.skin); circle(cx + 15, py - 23 + bob, 3.5, L.skin);
    circle(cx, py - 25 + bob, 15, L.hair);
    if (L.style === 1) fillRR(cx - 15, py - 25 + bob, 30, 22, 8, L.hair);
    if (L.style === 2) circle(cx, py - 38 + bob, 6, L.hair);
    if (!working && Date.now() - (s.statusSince || s.mtimeMs) > 30 * 60_000) {
      const zy = (t % 40) / 40;
      text('z', cx + 20, py - 40 - zy * 12, { size: 11 + zy * 4, weight: 700, color: `rgba(100,116,139,${1 - zy})` });
    }
  }
  rr(cx - 30, py + 10, 60, 34, 10); ctx.fillStyle = D ? '#2a323c' : '#374151'; ctx.fill();
  rr(cx - 26, py + 14, 52, 26, 8); ctx.fillStyle = D ? '#333c47' : '#4b5563'; ctx.fill();

  // alt agent'lar: aktif olanlar masanın yanında nabız gibi atar
  const subs = s.subagents || [], act = subs.filter((a) => a.active);
  act.slice(0, 4).forEach((a, i) => {
    const A = looks(a.id);
    const ax = cx + 50 + (i % 2) * 20, ay = py + 6 + Math.floor(i / 2) * 22 + Math.sin((t + i * 7) / 4) * 2;
    const p = ((t + i * 5) % 20) / 20;
    ctx.beginPath(); ctx.arc(ax, ay, 9 + p * 6, 0, Math.PI * 2); ctx.strokeStyle = `rgba(22,163,74,${0.5 - p * 0.5})`; ctx.lineWidth = 1.5; ctx.stroke();
    circle(ax, ay, 8, A.shirt); circle(ax, ay - 1, 4.2, A.skin);
  });
  if (subs.length && !act.length) {
    fillRR(cx + 38, py + 18, 38, 18, 9, D ? '#232b35' : '#ffffff');
    text(`👥 ${subs.length}`, cx + 57, py + 31, { size: 10.5, weight: 600, color: D ? '#c4ccd5' : '#374151', align: 'center' });
  }

  // isim + durum
  const ny = y + 196;
  circle(d.x + 22, ny - 4, 4, working ? '#16a34a' : waiting ? '#d97706' : present ? '#64748b' : '#9ca3af');
  text(s.name, d.x + 32, ny, { size: 12.5, weight: 650, color: D ? '#e6edf3' : '#111827', maxW: CELL_W - 46 });
  const sub = working ? ((s.lastTool && role(s.lastTool.role)[1]) || 'Çalışıyor') + ' · ' + ago(s.lastTool ? ts(s.lastTool.t) : s.mtimeMs, true)
    : waiting ? 'Onay bekliyor' : present ? 'Açık · boşta ' + ago(s.statusSince || s.mtimeMs, true) : 'Kapalı · ' + ago(s.mtimeMs, true);
  text(sub, d.x + 32, ny + 15, { size: 11, color: D ? '#8b949e' : '#6b7280', maxW: CELL_W - 46 });

  hit.push({ x: d.x + 6, y: y + 6, w: CELL_W - 12, h: CELL_H - 10, kind: 'desk', ref: s });
}

function officeHit(ev) {
  const r = $('#office').getBoundingClientRect();
  const x = (ev.clientX - r.left) / zoom, y = (ev.clientY - r.top) / zoom;
  for (let i = hit.length - 1; i >= 0; i--) { const b = hit[i]; if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b; }
  return null;
}
function setupOffice() {
  const c = $('#office'), tip = $('#tooltip'), wrap = $('#officeWrap');
  c.addEventListener('mousemove', (ev) => {
    const b = officeHit(ev);
    const id = b && b.kind === 'desk' ? b.ref.id : null;
    if (id !== hoverId) { hoverId = id; drawOffice(); }
    c.style.cursor = b ? 'pointer' : 'default';
    if (!b) { tip.hidden = true; return; }
    if (b.kind === 'desk') {
      const s = b.ref, lt = s.lastTool, subA = (s.subagents || []).filter((a) => a.active);
      tip.innerHTML = `<div class="tt">${esc(s.name)}</div><div class="ts">${STATE_LABEL[s.state]} · ${esc(s.project)} · ${esc(ago(s.mtimeMs))}</div>
        ${lt ? `<div style="margin-top:6px">${role(lt.role)[0]} ${esc(lt.human || lt.detail)}</div>` : ''}
        ${subA.length ? `<div class="ts" style="margin-top:4px">👥 ${esc(subA.map((a) => a.description || a.type).join(' · '))}</div>` : ''}
        ${s.lastPrompt ? `<div class="ts" style="margin-top:6px">Son isteğin: “${esc(s.lastPrompt.slice(0, 110))}”</div>` : ''}
        <div class="ts" style="margin-top:6px">Tıkla → detay ve yönetim</div>`;
    } else {
      const p = b.ref, g = p.git;
      tip.innerHTML = `<div class="tt">${esc(p.name)}</div><div class="ts">${esc(p.dirShort || 'Sohbet çalışma alanları')}</div>
        ${g ? `<div style="margin-top:4px">⎇ ${esc(g.branch)} · ${g.dirty ? g.dirty + ' kaydedilmemiş değişiklik' : 'temiz'}</div>` : ''}<div class="ts" style="margin-top:6px">Tıkla → bu projenin oturumları</div>`;
    }
    tip.hidden = false;
    const wr = wrap.getBoundingClientRect();
    let lx = ev.clientX - wr.left + wrap.scrollLeft + 16; const ly = ev.clientY - wr.top + wrap.scrollTop + 16;
    if (ev.clientX - wr.left + 340 > wr.width) lx -= 350;
    tip.style.left = lx + 'px'; tip.style.top = ly + 'px';
  });
  c.addEventListener('mouseleave', () => { tip.hidden = true; if (hoverId) { hoverId = null; drawOffice(); } });
  c.addEventListener('click', (ev) => {
    const b = officeHit(ev); if (!b) return;
    tip.hidden = true;
    if (b.kind === 'desk') openDrawer(b.ref.id);
    else { ui.projF = b.ref.key; ui.stateF = ''; location.hash = 'oturumlar'; }
  });
  $('#officeFilter').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    officeFilter = b.dataset.v; $$('#officeFilter button').forEach((x) => x.classList.toggle('on', x === b)); layoutOffice();
  });
  $('#viewMode').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    mode3d = b.dataset.v === '3d';
    try { localStorage.setItem('ofis-3d', mode3d ? '1' : '0'); } catch { /* yok */ }
    if (window.Office3D && o3Mounted) window.Office3D.setActive(mode3d);
    layoutOffice();
  });
  $('#overviewBtn').addEventListener('click', () => window.Office3D && window.Office3D.overview());
  $('#zoomIn').addEventListener('click', () => { zoom = Math.min(1.6, +(zoom + 0.1).toFixed(2)); layoutOffice(); });
  $('#zoomOut').addEventListener('click', () => { zoom = Math.max(0.6, +(zoom - 0.1).toFixed(2)); layoutOffice(); });
}

// =====================================================================
// Arama (⌘K)
// =====================================================================
let srIndex = 0;
function renderSearch() {
  const q = $('#search').value.trim().toLocaleLowerCase('tr');
  const box = $('#searchResults');
  if (route === 'oturumlar') { if (S) renderSessions(); box.hidden = true; return; }
  if (route === 'projeler') { if (S) renderProjects(); box.hidden = true; return; }
  if (!q || !S) { box.hidden = true; return; }
  const ses = S.sessions.filter((s) => matchQ(s, q)).slice(0, 7);
  const prj = S.projects.filter((p) => [p.name, p.dirShort].some((v) => v && v.toLocaleLowerCase('tr').includes(q))).slice(0, 4);
  srIndex = 0;
  box.innerHTML = ((ses.length ? `<div class="sr-group">Oturumlar</div>${ses.map((s) => `<div class="sr-item" data-open="${esc(s.id)}">${avatar(s.id, 'sm', !isPresent(s))}<div style="min-width:0"><div class="t">${esc(s.name)}</div><div class="s">${STATE_LABEL[s.state]} · ${esc(s.project)} · ${esc(ago(s.mtimeMs))}</div></div></div>`).join('')}` : '')
    + (prj.length ? `<div class="sr-group">Projeler</div>${prj.map((p) => `<div class="sr-item" data-projsessions="${esc(p.key)}"><span style="width:22px;text-align:center">▣</span><div><div class="t">${esc(p.name)}</div><div class="s">${esc(p.dirShort || '')} · ${p.sessionIds.length} oturum</div></div></div>`).join('')}` : ''))
    || '<div class="empty">Sonuç yok</div>';
  const first = $('.sr-item', box); if (first) first.classList.add('on');
  box.hidden = false;
}

// =====================================================================
// Eylemler ve olaylar
// =====================================================================
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 3600); }
async function act(action, sessionId, projectKey) {
  try {
    const r = await fetch('/api/action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, sessionId, projectKey }) });
    const j = await r.json(); if (!j.ok) throw new Error(j.error || 'hata');
    toast(j.command ? `Terminal açıldı: ${j.command}` : 'Açıldı');
  } catch (e) { toast('Yapılamadı: ' + e.message); }
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-act]');
  if (a) { e.stopPropagation(); act(a.dataset.act, a.dataset.sid, a.dataset.pkey); return; }
  const ps = e.target.closest('[data-projsessions]');
  if (ps) { e.preventDefault(); ui.projF = ps.dataset.projsessions; ui.stateF = ''; $('#search').value = ''; $('#searchResults').hidden = true; if (route === 'oturumlar') renderSessions(); else location.hash = 'oturumlar'; return; }
  const o = e.target.closest('[data-open]');
  if (o) { e.preventDefault(); $('#searchResults').hidden = true; openDrawer(o.dataset.open); return; }
  const go = e.target.closest('[data-go]');
  if (go) { const [r, f] = go.dataset.go.split(':'); ui.stateF = f || ''; ui.projF = ''; if (route === r) render(); else location.hash = r; return; }
  const dt = e.target.closest('[data-drtab]');
  if (dt) { drawerTab = dt.dataset.drtab; renderDrawer(); return; }
  if (e.target.id === 'drClose' || e.target.id === 'scrim') { closeDrawer(); return; }
  const th = e.target.closest('th[data-sort]');
  if (th) { const k = th.dataset.sort; if (ui.sortKey === k) ui.sortDir *= -1; else { ui.sortKey = k; ui.sortDir = k === 'name' || k === 'state' ? 1 : -1; } renderSessions(); return; }
  const chip = e.target.closest('#stateChips button');
  if (chip) { ui.stateF = chip.dataset.v; renderSessions(); return; }
  const fr = e.target.closest('#feedRoles button');
  if (fr) { ui.feedRole = fr.dataset.v; renderFeed(); return; }
  if (!e.target.closest('.search')) $('#searchResults').hidden = true;
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'projSel') { ui.projF = e.target.value; e.target.blur(); renderSessions(); }
  if (e.target.id === 'feedProj') { ui.feedProj = e.target.value; e.target.blur(); renderFeed(); }
});
$('#search').addEventListener('input', renderSearch);
$('#search').addEventListener('focus', renderSearch);
$('#search').addEventListener('keydown', (e) => {
  const items = $$('#searchResults .sr-item');
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault(); if (!items.length) return;
    srIndex = (srIndex + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items.forEach((x, i) => x.classList.toggle('on', i === srIndex));
  } else if (e.key === 'Enter' && items[srIndex]) { items[srIndex].click(); }
  else if (e.key === 'Escape') { $('#search').value = ''; $('#search').blur(); renderSearch(); }
});
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#search').focus(); $('#search').select(); return; }
  if (e.target.matches('input, select, textarea')) return;
  if (e.key === 'Escape' && !$('#phoneModal').hidden) { $('#phoneModal').hidden = true; return; }
  if (e.key === 'Escape' && drawerId) closeDrawer();
  if (e.key === '/') { e.preventDefault(); $('#search').focus(); }
  const map = { 1: 'genel', 2: 'ofis', 3: 'akis', 4: 'oturumlar', 5: 'projeler' };
  if (map[e.key] && !e.metaKey && !e.ctrlKey && !e.altKey) location.hash = map[e.key];
});

// tema
const THEMES = ['auto', 'light', 'dark'], THEME_L = { auto: 'otomatik', light: 'açık', dark: 'koyu' };
function applyTheme(t) {
  if (t === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  $('#themeBtn').textContent = 'Tema: ' + THEME_L[t];
  try { localStorage.setItem('ofis-theme', t); } catch { /* depolama kapalı */ }
  if (route === 'ofis') drawOffice();
  if (window.Office3D && o3Mounted) { window.Office3D.themeChanged(); if (S && route === 'ofis') layoutOffice(); }
}
let theme = 'auto'; try { theme = localStorage.getItem('ofis-theme') || 'auto'; } catch { /* depolama kapalı */ }
applyTheme(theme);
$('#themeBtn').addEventListener('click', () => { theme = THEMES[(THEMES.indexOf(theme) + 1) % 3]; applyTheme(theme); });
$('#openClaude').addEventListener('click', () => act('open-claude-app'));

// telefondan aç (karekod)
async function openPhone() {
  let j;
  try { const r = await fetch('/api/phone-link'); if (!r.ok) throw new Error(); j = await r.json(); } catch { toast('Bu ekran yalnızca Mac üzerinden açılır'); return; }
  if (!j.lan) { toast('Telefon erişimi kapalı: ofis.config.json içinde "lan": true yapıp sunucuyu yeniden başlat'); return; }
  if (!j.urls || !j.urls.length) { toast('Mac şu an bir Wi-Fi ağına bağlı görünmüyor'); return; }
  const url = j.urls[0];
  $('#phoneUrl').textContent = url;
  $('#phoneModal').hidden = false;
  const draw = () => { $('#qr').innerHTML = ''; new window.QRCode($('#qr'), { text: url, width: 220, height: 220, correctLevel: window.QRCode.CorrectLevel.M }); };
  if (window.QRCode) draw();
  else {
    const sc = document.createElement('script');
    sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
    sc.onload = draw; sc.onerror = () => { $('#qr').textContent = 'Karekod yüklenemedi; bağlantıyı kopyalayıp telefona gönder.'; };
    document.head.appendChild(sc);
  }
  $('#copyPhone').onclick = async () => { try { await navigator.clipboard.writeText(url); toast('Kopyalandı'); } catch { toast('Kopyalanamadı'); } };
}
$('#phoneBtn').addEventListener('click', openPhone);
document.addEventListener('click', (e) => { if (e.target.closest('[data-closemodal]') || e.target.id === 'phoneModal') $('#phoneModal').hidden = true; });
if (!['127.0.0.1', 'localhost'].includes(location.hostname)) $('#phoneBtn').hidden = true;
window.addEventListener('resize', () => { if (S && route === 'ofis') layoutOffice(); });

setupOffice();
setInterval(() => { tick++; if (route === 'ofis' && S) drawOffice(); }, 80);
setInterval(() => { if (S && route === 'genel') renderOverview(); }, 30_000);
setRoute(location.hash.slice(1) || 'genel');
connect();
