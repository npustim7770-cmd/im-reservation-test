/**
 * 工管系場地及設備借用管理系統｜2.2 前端操作邏輯（項目 1：測試環境與資料底層）2.2.8
 * 2.2.2：開啟頁面時先喚醒後端（只查看服務狀態，不讀寫任何資料），並顯示後端實際版本
 * 2.2.4：送出與儲存時顯示「處理中」提示並暫停所有按鈕（防止重複送出）；記錄每次登入的耗時與驗證方式
 * 2.2.8：同時登入測試改為逐筆核對（登入紀錄、LOGIN 紀錄、驗證與授權、登出）；可測 10／20 次；忙碌時提示重新登入
 * 2.2.7：顯示使用者索引狀態；新增「同時登入 10 次」測試（確認登入紀錄不互相覆蓋）
 * 2.2.6：登入分項計時；快速登入與完整登入（含每天第一次）分開統計
 * 2.2.5：總耗時異常時，分段顯示「開始前等待／程式處理／試算表存檔／結束後等待」；閒置逾時後可用舊代碼再測一次
 * 本檔只放公開資訊：後端網址、Google 登入用戶端 ID。不含任何密碼、金鑰或資料。
 */
const API_URL = 'https://script.google.com/macros/s/AKfycbxlB34j2PeXcTbZREipXPfGHhw3-lw8wbMltJuBWlx0b6w7VHsG_ybw4zbWubXvO-cnpg/exec';
const CLIENT_ID = '269159264875-4p1ldq220ihoei495b5eg4m7voqc6a8o.apps.googleusercontent.com';
const OTHER_CLIENT_ID = '269159264875-oacpralsp395h3fji3h2mfgj2julj0v1.apps.googleusercontent.com'; // 「其他系統」補測專用
const SESSION_KEY = 'im22_session';
const CRED_KEY = 'im22_lastcred';     // 回歸測試用：只存在本分頁，關閉分頁即消失
const TARGET = { read: { goal: 2000, limit: 4000 }, write: { goal: 3000, limit: 5000 }, login: { goal: 3000, limit: 5000 } };
let me = null;
let lastActivity = 0;
let oldSession = null;
const LOGIN_RUNS_KEY = 'im22_loginRuns2';  // 登入計時紀錄（存在本瀏覽器，只有時間數字，不含任何憑證）

/* ---------- 處理中提示（送出、儲存、登入時顯示，並暫停所有按鈕） ---------- */
const WRITE_ACTIONS = { login: '正在驗證 Google 登入', logout: '正在登出', claimAdmin: '正在送出設定碼',
  testWrite: '資料儲存中', recover: '正在檢查並還原', sendSchoolCode: '正在寄送驗證碼', verifySchoolCode: '正在驗證' };
let busyCount = 0, busyStart = 0, busyTimer = null;
let clockOffset = null;   // 後端時鐘 − 本機時鐘（毫秒，由喚醒後端時估算；僅供診斷計時）
function busyOn(action) {
  busyCount++;
  if (busyCount > 1) return;
  busyStart = Date.now();
  const bar = document.getElementById('busy');
  const label = WRITE_ACTIONS[action] || '處理中';
  const paint = () => { bar.textContent = '⏳ ' + label + '，請稍候…（已 ' + Math.floor((Date.now() - busyStart) / 1000) + ' 秒）請勿關閉或重新整理頁面'; };
  paint();
  bar.classList.add('show');
  busyTimer = setInterval(paint, 500);
  document.querySelectorAll('main button').forEach(b => { if (!b.disabled) { b.disabled = true; b.dataset.busyLock = '1'; } });
}
function busyOff() {
  busyCount = Math.max(0, busyCount - 1);
  if (busyCount > 0) return;
  clearInterval(busyTimer);
  document.getElementById('busy').classList.remove('show');
  document.querySelectorAll('main button[data-busy-lock]').forEach(b => { b.disabled = false; delete b.dataset.busyLock; });
}
window.addEventListener('beforeunload', function (e) { if (busyCount > 0) { e.preventDefault(); e.returnValue = ''; } });

/* ---------- App 內建瀏覽器提示 ---------- */
(function () {
  const ua = navigator.userAgent || '';
  if (/Line\//i.test(ua) || /FBAN|FBAV|Instagram/i.test(ua)) {
    document.getElementById('inapp').style.display = 'block';
    const u = new URL(location.href);
    if (/Line\//i.test(ua)) u.searchParams.set('openExternalBrowser', '1');
    document.getElementById('openExternal').href = u.toString();
  }
})();

/* ---------- 呼叫後端 ---------- */
async function api(action, body) {
  const payload = Object.assign({ action: action }, body || {});
  if (action !== 'login' && !('session' in payload)) payload.session = sessionStorage.getItem(SESSION_KEY);
  const t0 = performance.now();
  const sentAt = Date.now();
  const isWrite = action in WRITE_ACTIONS;
  if (isWrite) busyOn(action);
  try {
    // 以 text/plain 送出 JSON，避免瀏覽器預檢請求；憑證放在內容，不放網址
    const resp = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload), redirect: 'follow', credentials: 'omit' });
    const data = await resp.json();
    data._ms = Math.round(performance.now() - t0);
    if (clockOffset !== null && data.t0 && data.tEnd) {
      data._before = Math.max(0, data.t0 - clockOffset - sentAt);
      data._after = Math.max(0, Date.now() - (data.tEnd - clockOffset));
    }
    if (data.ok && action !== 'logout' && payload.session === sessionStorage.getItem(SESSION_KEY)) lastActivity = Date.now();
    return data;
  } catch (err) {
    return { ok: false, error: 'NETWORK', message: '無法連線到後端：' + err.message, _ms: Math.round(performance.now() - t0) };
  } finally {
    if (isWrite) busyOff();
  }
}

// 寫入專用：系統忙碌時，用「同一個防重複代碼」3 秒後自動重試一次（不會重複寫入）
async function apiWrite(action, body) {
  let r = await api(action, body);
  if (r.error === 'BUSY') {
    log('系統忙碌，3 秒後以同一筆自動重試一次', r, 'warn');
    await new Promise(res => setTimeout(res, 3000));
    const r2 = await api(action, body);
    r2._retried = true;
    r2._ms += r._ms + 3000;
    if (r2.error === 'BUSY') r2.message = '系統仍忙碌，請稍後再按一次（資料未變更，重按不會重複寫入）';
    r = r2;
  }
  return r;
}

const sec = ms => (ms / 1000).toFixed(1);
function log(label, r, cls) {
  const li = document.createElement('li');
  const t = document.createElement('span'); t.className = 't';
  t.textContent = new Date().toLocaleTimeString('zh-TW', { hour12: false });
  const s = document.createElement('span');
  s.className = cls || (r.ok ? 'ok' : 'bad');
  s.textContent = (r.ok ? '成功' : '失敗') + '｜' + label + '：';
  const m = document.createElement('span');
  const parts = [];
  if (r._ms !== undefined) parts.push('總耗時 ' + sec(r._ms) + ' 秒');
  if (r.serverMs !== undefined) parts.push('後端 ' + sec(r.serverMs) + ' 秒');
  if (r.lockWaitMs) parts.push('排隊 ' + sec(r.lockWaitMs) + ' 秒');
  // 診斷：平台時間（總耗時 − 後端）達 3 秒，或存檔達 1 秒時，分段顯示
  if (r._ms !== undefined && r.serverMs !== undefined && (r._ms - r.serverMs >= 3000 || r.flushMs >= 1000)) {
    parts.push('分段：開始前等待 ' + (r._before !== undefined ? '約 ' + sec(r._before) : '?') + '、程式 ' + sec(r.bodyMs || 0) +
      '、存檔 ' + sec(r.flushMs || 0) + '、結束後 ' + (r._after !== undefined ? '約 ' + sec(r._after) : '?') + ' 秒');
  }
  if (r.timings && r.timings.verifyMs !== undefined) parts.push('分項：' + timingText(r));
  if (r.verifyMethod) parts.push(methodText(r.verifyMethod) + (r.loginPath ? '、' + (r.loginPath === 'FAST' ? '快速登入' : '完整登入') : ''));
  m.textContent = (r.message || r.error || '') + (parts.length ? '（' + parts.join('，') + '）' : '') +
    (r.remainingQuota !== undefined ? '　今日剩餘寄信額度：' + r.remainingQuota : '');
  li.append(t, s, m);
  document.getElementById('log').prepend(li);
}
const TIMING_LABELS = [['verifyMs', '驗證憑證'], ['jwksMs', '其中下載 Google 金鑰'], ['userMs', '查快取'], ['lockWaitMs', '排隊'],
  ['findUserMs', '查使用者'], ['updateUserMs', '更新登入日'], ['rolesMs', '讀角色'], ['sessionMs', '建立登入紀錄'],
  ['logMs', '寫操作紀錄'], ['verifyWriteMs', '存檔與讀回核對']];
function timingText(r) {
  const T = r.timings;
  const parts = TIMING_LABELS.filter(x => T[x[0]] !== undefined).map(x => x[1] + ' ' + sec(T[x[0]]) +
    (x[0] === 'findUserMs' && T.userIndex ? '（索引' + ({ HIT: '命中', STALE: '失效已重查', MISS: '未建立' }[T.userIndex] || T.userIndex) + '）' : ''));
  if (r.logMs !== undefined && T.logMs === undefined) parts.push('寫操作紀錄 ' + sec(r.logMs));
  if (r.flushMs !== undefined) parts.push('存檔 ' + sec(r.flushMs));
  return parts.join('、') + ' 秒';
}
function methodText(m) { return m === 'LOCAL' ? '後端驗證簽章' : m === 'TOKENINFO_FALLBACK' ? '改用 Google 查驗' : m; }
function newKey() { return 'k-' + crypto.randomUUID(); }

/* ---------- Google 登入 ---------- */
function initGoogle() {
  google.accounts.id.initialize({ client_id: CLIENT_ID, callback: onGoogleCredential, auto_select: false, cancel_on_tap_outside: true });
  google.accounts.id.renderButton(document.getElementById('gsiButton'), { theme: 'outline', size: 'large', text: 'signin_with', locale: 'zh-TW' });
  document.getElementById('gsiStatus').textContent = '請按上方按鈕，以 Google 帳號登入（測試期間只有列入測試名單的帳號能登入）。';
  if (sessionStorage.getItem(SESSION_KEY)) doMe(true);
}

async function onGoogleCredential(resp) {
  if (busyCount > 0) return;            // 前一個操作尚未完成，不重複送出登入
  document.getElementById('gsiStatus').textContent = '已取得 Google 登入憑證，正在由後端驗證…';
  const r = await api('login', { idToken: resp.credential });
  log('登入（後端驗證 Google 憑證）', r);
  if (r.ok) recordLogin(r);
  if (r.ok) {
    sessionStorage.setItem(SESSION_KEY, r.session);
    sessionStorage.setItem(CRED_KEY, JSON.stringify({ cred: resp.credential, at: Date.now() }));
    lastActivity = Date.now();
    showMe(r.user, r.initialized);
  } else if (r.error === 'BUSY' || r.error === 'WRITE_FAILED') {
    document.getElementById('gsiStatus').textContent = '登入未完成：' + r.message + '（請稍候約 10 秒後，再按一次 Google 登入按鈕）';
  } else {
    document.getElementById('gsiStatus').textContent = '登入失敗：' + (r.message || r.error);
  }
}

function showMe(u, initialized) {
  me = u;
  const isAdmin = u.roles.indexOf('SYS_ADMIN') >= 0;
  const statusText = { PENDING: '待審核', ACTIVE: '已啟用', SUSPENDED: '停用', RETURNED: '退回補正', REJECTED: '未通過', EXPIRED: '已到期' };
  const roleText = { SYS_ADMIN: '系統管理員', OFFICE_ADMIN: '系辦日常管理者', SPACE_MANAGER: '場地管理教師', APPROVER_MANAGER: '審核人員管理承辦人' };
  document.getElementById('meName').textContent = u.name;
  document.getElementById('meEmail').textContent = u.email;
  document.getElementById('meId').textContent = u.userId;
  document.getElementById('meStatus').textContent = statusText[u.status] || u.status;
  document.getElementById('meRoles').textContent = u.roles.length ? u.roles.map(x => roleText[x] || x).join('、') : '（無）';
  document.getElementById('meSchool').textContent = u.schoolEmail ? u.schoolEmail + (u.schoolEmailVerified ? '（已驗證）' : '（未驗證）') : '（未設定）';
  document.getElementById('gsiStatus').textContent = '已登入。';
  ['meBox', 'secBox'].forEach(id => document.getElementById(id).classList.remove('hidden'));
  document.querySelectorAll('.admin-only').forEach(el => el.classList.toggle('hidden', !isAdmin));
  document.getElementById('setupBox').classList.toggle('hidden', !!initialized);
}

async function doMe(silent) {
  const r = await api('me');
  if (!silent || !r.ok) log('讀取我的資料', r);
  if (r.ok) showMe(r.user, r.initialized); else sessionStorage.removeItem(SESSION_KEY);
}

function hideAll() {
  me = null;
  ['meBox', 'secBox', 'setupBox'].forEach(id => document.getElementById(id).classList.add('hidden'));
  document.querySelectorAll('.admin-only').forEach(el => el.classList.add('hidden'));
}

async function doLogout() {
  oldSession = sessionStorage.getItem(SESSION_KEY);
  const r = await api('logout');
  log('登出', r);
  sessionStorage.removeItem(SESSION_KEY);
  if (window.google) google.accounts.id.disableAutoSelect();
  lastActivity = 0;
  hideAll();
  document.getElementById('secBox').classList.remove('hidden');   // 保留回歸測試區，供「登出後舊代碼」測試
  document.getElementById('oldSessBtn').disabled = !oldSession;
  document.getElementById('gsiStatus').textContent = '已登出。如需再測試，請重新登入。';
}

async function doClaim() {
  const code = document.getElementById('setupCode').value;
  const r = await api('claimAdmin', { code: code });
  document.getElementById('setupCode').value = '';
  log('首位系統管理員初始化', r);
  if (r.ok) doMe(true);
}

/* ---------- A. 系統狀態 ---------- */
async function doStatus() {
  const r = await api('status');
  log('讀取系統狀態', Object.assign({}, r, { message: r.ok ? '版本 ' + r.version + '；未完成寫入 ' + r.pendingWrites + ' 筆；測試計數器 ' + r.testCounter : r.message }));
  const box = document.getElementById('statusTable');
  box.textContent = '';
  if (!r.ok) return;
  const rows = [
    ['版本', r.version + '（' + r.stage + '）'], ['環境', r.env === 'TEST' ? '測試環境' : '正式環境'],
    ['首位系統管理員初始化', r.initialized ? '已完成' : '尚未完成'], ['用戶端 ID', r.clientIdSet ? '已設定' : '尚未設定'],
    ['學校 Email 網域', r.staffDomains || '（尚未設定）'], ['本系系所', r.homeDept], ['閒置逾時', r.idleMinutes + ' 分鐘'],
    ['未完成寫入', r.pendingWrites + ' 筆'], ['欄位標題檢查', r.headerProblems.length ? '異常：' + r.headerProblems.join('、') : '正常'],
    ['測試計數器', String(r.testCounter)],
    ['Google 公開金鑰快取', r.jwksKeys ? r.jwksKeys + ' 把（下載於 ' + r.jwksFetchedAt + '）' : '目前沒有（下次登入時自動下載）'],
    ['暫存待補寫的操作紀錄', (r.logBacklog || 0) + ' 筆' + (r.logBacklog ? '（定時預熱或下次寫入時自動補寫）' : '')],
    ['紀錄保存失敗（已寫入 Google 執行紀錄）', (r.logLost || 0) + ' 次' + (r.logLost ? '（請告知開發者）' : '')]
  ].concat(Object.keys(r.counts).map(k => ['資料筆數：' + k, String(r.counts[k])]));
  box.append(table(['項目', '內容'], rows));
}

function table(head, rows) {
  const tbl = document.createElement('table');
  const tr = tbl.insertRow();
  head.forEach(h => { const th = document.createElement('th'); th.textContent = h; tr.append(th); });
  rows.forEach(r => { const row = tbl.insertRow(); r.forEach(v => { row.insertCell().textContent = v; }); });
  return tbl;
}

/* ---------- B. 效能測試 ---------- */
const perfResults = {};
async function perfRun(kind) {
  const runs = [];
  for (let i = 0; i < 5; i++) {
    const r = kind === 'read' ? await api('perfRead') : await apiWrite('testWrite', { submissionKey: newKey() });
    log((kind === 'read' ? '讀取測試' : '寫入測試') + ' 第 ' + (i + 1) + ' 次', r);
    if (!r.ok) { log('效能測試中止', { ok: false, message: '第 ' + (i + 1) + ' 次失敗，請截圖告知開發者' }); return; }
    runs.push(r);
  }
  const t = TARGET[kind];
  const worst = Math.max(...runs.map(r => r._ms));
  const verdict = worst <= t.goal ? '達到目標' : worst <= t.limit ? '未達目標但在上限內（驗收通過）' : '超過上限（驗收不通過）';
  perfResults[kind] = [kind === 'read' ? '讀取' : '寫入', runs.map(r => sec(r._ms)).join('、'), sec(worst),
    runs.map(r => sec(r.serverMs)).join('、'), sec(t.goal) + '／' + sec(t.limit), verdict];
  renderPerf();
  log((kind === 'read' ? '讀取' : '寫入') + '測試判定', { ok: worst <= t.limit, message: '最慢 ' + sec(worst) + ' 秒：' + verdict });
}
function renderPerf() {
  const box = document.getElementById('perfTable');
  box.textContent = '';
  const rows = Object.values(perfResults);
  const all = loginRuns();
  const t = TARGET.login;
  [['FAST', '一般登入（快速登入）'], ['FULL', '完整登入（含每天第一次）']].forEach(function (g) {
    const lr = all.filter(x => x.path === g[0]).slice(-5);
    if (!lr.length) return;
    const worst = Math.max(...lr.map(x => x.ms));
    const verdict = (lr.length < 5 && g[0] === 'FAST') ? '已測 ' + lr.length + ' 次，需 5 次才判定' :
      worst <= t.goal ? '達到目標' : worst <= t.limit ? '未達目標但在上限內' : '超過上限';
    rows.push([g[1] + '（最近 ' + lr.length + ' 次）',
      lr.map(x => (g[0] === 'FULL' ? stamp(x.at) + ' ' : '') + sec(x.ms)).join('、'), sec(worst),
      lr.map(x => sec(x.server) + (x.method === 'LOCAL' ? '' : '＊')).join('、'), sec(t.goal) + '／' + sec(t.limit), verdict]);
  });
  if (!rows.length) return;
  box.append(table(['項目', '總耗時（秒）', '最慢（秒）', '後端（秒）', '目標／上限（秒）', '判定'], rows));
  if (all.some(x => x.method !== 'LOCAL')) {
    const n = document.createElement('p'); n.className = 'note'; n.textContent = '＊ 該次改用 Google 查驗（後端無法自行驗證時的備援方式）。'; box.append(n);
  }
}
function stamp(ms) { const d = new Date(ms); return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }

/* ---------- 登入計時（每次成功登入自動記錄；快速與完整登入分開，各保留最近 5 次）----------
 * 存在本瀏覽器（不含任何憑證或登入代碼，只有時間數字），換瀏覽器或清除網站資料時會消失。 */
function loginRuns() { try { return JSON.parse(localStorage.getItem(LOGIN_RUNS_KEY) || '[]'); } catch (e) { return []; } }
function recordLogin(r) {
  const runs = loginRuns();
  runs.push({ ms: r._ms, server: r.serverMs, method: r.verifyMethod, path: r.loginPath, at: Date.now() });
  const keep = ['FAST', 'FULL'].map(p => runs.filter(x => x.path === p).slice(-5)).flat().sort((x, y) => x.at - y.at);
  try { localStorage.setItem(LOGIN_RUNS_KEY, JSON.stringify(keep)); } catch (e) { /* 無法保存時略過 */ }
  renderPerf();
}
function clearLoginRuns() {
  try { localStorage.removeItem(LOGIN_RUNS_KEY); } catch (e) { /* 略過 */ }
  renderPerf();
  log('清除登入計時紀錄', { ok: true, message: '已清除，之後的登入會重新計時' });
}

/* ---------- C. 多人同時寫入與重複送出 ---------- */
async function counterNow() {
  const s = await api('status');
  return s.ok ? s.testCounter : null;
}
async function doConcurrent(n) {
  const before = await counterNow();
  if (before === null) { log('同時寫入', { ok: false, message: '無法讀取計數器' }); return; }
  const t0 = performance.now();
  const rs = await Promise.all(Array.from({ length: n }, () => apiWrite('testWrite', { submissionKey: newKey() })));
  const ms = Math.round(performance.now() - t0);
  const after = await counterNow();
  const okN = rs.filter(r => r.ok).length;
  const busy = rs.filter(r => r.error === 'BUSY').length;
  const retried = rs.filter(r => r._retried).length;
  const other = n - okN - busy;
  const values = rs.filter(r => r.ok).map(r => r.counter).sort((a, b) => a - b);
  const distinct = new Set(values).size === values.length;
  const pass = after - before === okN && distinct && other === 0;
  log('同時送出 ' + n + ' 次寫入', { ok: pass, _ms: ms,
    message: '成功 ' + okN + '（其中 ' + retried + ' 筆經自動重試）、仍忙碌 ' + busy + '、其他錯誤 ' + other +
      '；計數器 ' + before + ' → ' + after + '（增加 ' + (after - before) + '）；各筆取得的計數值' + (distinct ? '皆不重複' : '有重複！') +
      '；判定：' + (pass ? '一致，沒有漏算或重複' : '不一致，請截圖告知開發者') });
}
// 2.2.8：同一帳號同時登入 n 次（使用本分頁保存、尚未過期的 Google 憑證），逐筆核對：
// ① 成功次數 ＝ Sessions 增加列數 ② 每個成功的登入紀錄編號在 Sessions 與 LOGIN 紀錄各恰好 1 筆、雜湊值不重複
// ③ 每個成功的代碼都能通過後端驗證與「僅系統管理員」授權 ④ 登出時各自找到自己的列，登出後全部失效
async function doConcurrentLogin(n) {
  const s = savedCred();
  if (!s || Date.now() - s.at > 55 * 60000) { log('同時登入', { ok: false, message: '需要 55 分鐘內取得的 Google 憑證：請先登出再重新登入一次，然後立即執行' }, 'warn'); return; }
  const st0 = await api('status');
  if (!st0.ok) { log('同時登入', st0); return; }
  const t0 = performance.now();
  const rs = await Promise.all(Array.from({ length: n }, () => api('login', { idToken: s.cred })));
  const ms = Math.round(performance.now() - t0);
  const okRs = rs.filter(r => r.ok);
  const fails = {};
  rs.filter(r => !r.ok).forEach(r => { fails[r.error || '其他'] = (fails[r.error || '其他'] || 0) + 1; });
  const failText = Object.keys(fails).length ? Object.keys(fails).map(k => k + ' ' + fails[k]).join('、') : '0';
  const st1 = await api('status');
  const addSess = st1.counts.Sessions - st0.counts.Sessions;
  const v = await api('verifySessions', { sessionIds: okRs.map(r => r.sessionId) });
  const authed = (await Promise.all(okRs.map(r => api('adminPing', { session: r.session })))).filter(x => x.ok).length;
  const outs = await Promise.all(okRs.map(r => api('logout', { session: r.session })));
  const rowsFound = outs.filter(o => o.ok && o.rowFound).map(o => o.sessionRow);
  const stillValid = (await Promise.all(okRs.map(r => api('me', { session: r.session })))).filter(c => c.ok).length;
  const failedRowsNote = addSess - okRs.length;   // 寫入失敗時會留下已作廢的列（WRITE_FAILED）
  const pass = v.ok && v.allOne && v.duplicateHashes === 0 && (addSess === okRs.length || (fails.WRITE_FAILED && failedRowsNote <= fails.WRITE_FAILED)) &&
    authed === okRs.length && rowsFound.length === okRs.length && new Set(rowsFound).size === okRs.length && stillValid === 0 && okRs.length > 0;
  log('同一帳號同時登入 ' + n + ' 次', { ok: pass, _ms: ms,
    message: '成功 ' + okRs.length + '、失敗 ' + (n - okRs.length) + '（' + failText + '）；最慢 ' + sec(Math.max(...rs.map(r => r._ms))) + ' 秒｜' +
      'Sessions 增加 ' + addSess + ' 列｜逐筆核對：' + (v.ok ? v.message : (v.message || v.error)) + '｜' +
      '通過驗證與授權 ' + authed + '／' + okRs.length + '｜登出找到各自的列 ' + rowsFound.length + '（不重複 ' + new Set(rowsFound).size + '）｜登出後仍有效 ' + stillValid +
      '｜判定：' + (pass ? '成功次數與保存的紀錄完全一致，沒有覆蓋或遺失' : '不一致，請截圖告知開發者') });
}

async function doDoubleSubmit() {
  const before = await counterNow();
  const body = { submissionKey: newKey() };
  const rs = await Promise.all([apiWrite('testWrite', body), apiWrite('testWrite', body)]);
  const after = await counterNow();
  const created = rs.filter(r => r.ok && !r.duplicate).length;
  const dup = rs.filter(r => r.ok && r.duplicate).length;
  log('同一筆連按兩次', { ok: created === 1 && after - before === 1, _ms: Math.max(rs[0]._ms, rs[1]._ms),
    message: '實際寫入 ' + created + ' 筆、判定重複 ' + dup + ' 筆；計數器 ' + before + ' → ' + after + '（預期：只寫入 1 筆、增加 1）' });
}

/* ---------- D. 寫入中斷與還原 ---------- */
async function doSimulate(mode) {
  const before = await counterNow();
  const r = await api('testWrite', { submissionKey: newKey(), simulate: mode });
  const after = await counterNow();
  const label = mode === 'rollback' ? '模擬寫入中斷（自動還原）' : '模擬寫入中斷（不還原）';
  const extra = '；畫面讀到的計數器 ' + before + ' → ' + after + (mode === 'rollback' ? '（預期不變）' : '（寫到一半的資料不顯示，預期不變）');
  log(label, Object.assign({}, r, { message: (r.message || '') + extra }),
    (r.error === 'WRITE_FAILED' || r.error === 'INTERRUPTED_NO_ROLLBACK') && before === after ? 'warn' : 'bad');
}
async function doRecover() {
  const r = await api('recover');
  log('執行寫入檢查與還原', Object.assign({}, r, { message: (r.message || '') + (r.fixed && r.fixed.length ? '：' + r.fixed.join('、') : '') }));
}
async function doSingleWrite() { log('一般寫入一次', await apiWrite('testWrite', { submissionKey: newKey() })); }

/* ---------- E1. 權限 ---------- */
async function doAdminPing() { log('呼叫僅系統管理員功能', await api('adminPing')); }
async function doFakeSession() {
  const r = await api('adminPing', { session: 'fake-' + Math.random().toString(16).slice(2) });
  log('偽造登入代碼呼叫（應被拒）', r, r.ok ? 'bad' : 'ok');
}

/* ---------- E2. 不合格的 Google 憑證 ---------- */
function savedCred() { try { return JSON.parse(sessionStorage.getItem(CRED_KEY) || 'null'); } catch (e) { return null; } }
function b64uDec(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }
function b64uEnc(bytes) { let bin = ''; bytes.forEach(b => { bin += String.fromCharCode(b); }); return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
async function sendBadCred(label, cred) {
  const r = await api('login', { idToken: cred });
  if (r.ok) log(label + '（應被拒，卻被接受！）', { ok: false, message: '不符預期，請截圖告知開發者', _ms: r._ms }, 'bad');
  else log(label + '（應被拒）', r, 'ok');
}
async function doTamperedCred() {
  const s = savedCred();
  if (!s) { log('竄改憑證', { ok: false, message: '尚未保存憑證，請先登入一次' }); return; }
  const p = s.cred.split('.');
  const body = JSON.parse(new TextDecoder().decode(b64uDec(p[1])));
  body.email = 'attacker@example.com';
  body.name = '竄改測試';
  p[1] = b64uEnc(new TextEncoder().encode(JSON.stringify(body)));
  await sendBadCred('竄改內容的憑證（改為 attacker@example.com）', p.join('.'));
}
async function doExpiredCred() {
  const s = savedCred();
  if (!s) { log('過期憑證', { ok: false, message: '尚未保存憑證，請先登入一次' }); return; }
  const min = Math.floor((Date.now() - s.at) / 60000);
  if (min < 61) { log('過期憑證', { ok: false, message: '這張憑證取得才 ' + min + ' 分鐘，請在超過 61 分鐘後再按' }, 'warn'); return; }
  await sendBadCred('已過期的憑證（取得後 ' + min + ' 分鐘）', s.cred);
}
function clearSavedCred() { sessionStorage.removeItem(CRED_KEY); log('清除保存的憑證', { ok: true, message: '已清除本分頁保存的 Google 憑證' }); }
function startOtherSystem() {
  google.accounts.id.initialize({ client_id: OTHER_CLIENT_ID, callback: onOtherCredential, auto_select: false });
  google.accounts.id.renderButton(document.getElementById('otherBtn'), { theme: 'filled_black', size: 'medium', text: 'continue_with', locale: 'zh-TW' });
  log('其他系統憑證', { ok: true, message: '已顯示「其他系統」的黑色登入按鈕，請按它並選擇帳號' }, 'warn');
}
async function onOtherCredential(resp) {
  document.getElementById('otherBtn').textContent = '';
  await sendBadCred('發給其他系統的憑證', resp.credential);
  google.accounts.id.initialize({ client_id: CLIENT_ID, callback: onGoogleCredential, auto_select: false, cancel_on_tap_outside: true });
}

/* ---------- E3. 登出與閒置逾時 ---------- */
async function doOldSession() {
  const r = await api('me', { session: oldSession });
  log('用已失效的舊登入代碼呼叫（應被拒）', r, r.ok ? 'bad' : 'ok');
}
async function doIdleCheck() {
  const idleSec = lastActivity ? Math.round((Date.now() - lastActivity) / 1000) : 0;
  const r = await api('me');
  log('閒置 ' + Math.floor(idleSec / 60) + ' 分 ' + (idleSec % 60) + ' 秒後呼叫', r, r.ok ? 'ok' : (r.reason === '閒置逾時' ? 'ok' : 'bad'));
  if (r.ok) { showMe(r.user, r.initialized); return; }
  oldSession = sessionStorage.getItem(SESSION_KEY) || oldSession;   // 保留失效代碼，供「調長設定後再試」測試
  document.getElementById('oldSessBtn').disabled = !oldSession;
  sessionStorage.removeItem(SESSION_KEY);
  lastActivity = 0;
  hideAll();
  document.getElementById('secBox').classList.remove('hidden');
  document.getElementById('gsiStatus').textContent = '登入已失效（' + (r.reason || r.error) + '），請重新登入。';
}
setInterval(function () {
  const s = savedCred();
  document.getElementById('credInfo').textContent = s
    ? '已保存 Google 憑證：取得於 ' + new Date(s.at).toLocaleTimeString('zh-TW', { hour12: false }) + '，已過 ' + Math.floor((Date.now() - s.at) / 60000) + ' 分鐘（超過 61 分鐘才能測「已過期」）。'
    : '尚未保存 Google 憑證（登入一次後會自動保存，只存在本分頁）。';
  if (lastActivity && sessionStorage.getItem(SESSION_KEY)) {
    const s2 = Math.round((Date.now() - lastActivity) / 1000);
    document.getElementById('idleInfo').textContent = '上次成功操作：' + new Date(lastActivity).toLocaleTimeString('zh-TW', { hour12: false }) + '，已閒置 ' + Math.floor(s2 / 60) + ' 分 ' + (s2 % 60) + ' 秒。';
  } else {
    document.getElementById('idleInfo').textContent = '登入後顯示閒置時間。';
  }
}, 1000);

/* ---------- E4. 學校 Email ---------- */
async function doSendCode() { log('寄送學校 Email 驗證碼', await api('sendSchoolCode', { email: document.getElementById('schoolEmail').value })); }
async function doVerifyCode() {
  const btn = document.getElementById('verifyBtn');
  btn.disabled = true;
  try {
    const r = await api('verifySchoolCode', { code: document.getElementById('schoolCode').value });
    document.getElementById('schoolCode').value = '';
    log('驗證學校 Email', r);
    if (r.ok) doMe(true);
  } finally { btn.disabled = false; }
}
async function doParallelWrong() {
  const t0 = performance.now();
  const rs = await Promise.all(Array.from({ length: 6 }, () => api('verifySchoolCode', { code: '000000' })));
  const cnt = k => rs.filter(r => r.error === k).length;
  const okN = rs.filter(r => r.ok).length;
  const left = rs.filter(r => r.error === 'WRONG_CODE').map(r => (r.message.match(/剩 (\d) 次/) || [])[1]);
  log('同時送出 6 次錯誤驗證碼', { ok: okN === 0 && cnt('WRONG_CODE') <= 5 && new Set(left).size === left.length, _ms: Math.round(performance.now() - t0),
    message: '驗證碼錯誤 ' + cnt('WRONG_CODE') + '、錯誤次數過多 ' + cnt('TOO_MANY') + '、驗證碼不存在 ' + cnt('NO_CODE') +
      '、系統忙碌 ' + cnt('BUSY') + '、成功 ' + okN + '（剩餘次數：' + left.join('、') + '）' });
}

/* ---------- 喚醒後端（減少第一次操作的等待） ---------- */
let lastWarm = 0;
async function warmUp() {
  lastWarm = Date.now();
  try {
    const a = Date.now();
    const resp = await fetch(API_URL, { method: 'GET', redirect: 'follow', credentials: 'omit' });
    const d = await resp.json();
    const b = Date.now();
    // 時鐘差估計：後端時間 − 往返中點（誤差約為往返時間的一半）
    if (d && typeof d.now === 'number' && b - a < 15000) clockOffset = d.now - (a + b) / 2;
    if (d && d.version) document.getElementById('ver').textContent = d.version + '（後端）';
  } catch (e) { /* 喚醒失敗不影響操作 */ }
}
// 頁面重新回到前景且已超過 4 分鐘未喚醒時，再喚醒一次
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'visible' && Date.now() - lastWarm > 4 * 60000) warmUp();
});

/* ---------- 啟動 ---------- */
warmUp();
renderPerf();
if (window.google && google.accounts && google.accounts.id) initGoogle();
else window.onGoogleLibraryLoad = initGoogle;
setTimeout(function () {
  if (!(window.google && google.accounts && google.accounts.id)) {
    document.getElementById('gsiStatus').textContent = 'Google 登入按鈕載入失敗，請確認網路連線，或改用 Chrome／Safari／Edge 開啟本頁。';
  }
}, 10000);
