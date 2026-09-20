/* N2 單字學習平台 - 前端 */
'use strict';

// ======================= 工具 =======================
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const kataToHira = (s) => String(s || '').replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
const hasKanji = (s) => /[一-鿿㐀-䶿々]/.test(s);
const isKatakanaWord = (s) => /^[ァ-ー・]+$/.test(s);
const shuffle = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const fmtDate = (ts) => new Date(ts).toLocaleString('zh-TW', { hour12: false });

const isAffix = (w) => w && (w.pos === '接頭詞' || w.pos === '接尾詞');
/** 去掉接頭/接尾詞標記（悪〜 → 悪、〜的 → 的） */
const affixCore = (word) => String(word || '').replace(/[〜～~\-－]/g, '').trim();

/** 例詞（接頭詞 / 接尾詞用）：標記詞綴部分，讀音同樣標記 */
function subwordHtml(sw, w) {
  const core = affixCore(w.word), coreRd = w.reading || '';
  const isPre = w.pos === '接頭詞';
  const mark = (text, part, atStart) => {
    if (!part) return esc(text);
    const ok = atStart ? text.startsWith(part) : text.endsWith(part);
    if (!ok) return esc(text);
    return atStart
      ? `<span class="hit">${esc(part)}</span>${esc(text.slice(part.length))}`
      : `${esc(text.slice(0, text.length - part.length))}<span class="hit">${esc(part)}</span>`;
  };
  return `<div class="subword">
    <div class="sw-word ja">${mark(sw.word, core, isPre)} <button class="btn ghost sm" data-speak="${esc(sw.word)}" title="朗讀">🔊</button></div>
    <div class="sw-reading ja">${mark(sw.reading || '', coreRd, isPre)}</div>
    ${sw.zh ? `<div class="sw-zh">${esc(sw.zh)}</div>` : ''}
  </div>`;
}
/** 由例詞讀音推導詞綴讀音：悪影響(あくえいきょう) − 影響(えいきょう) = あく */
async function deriveAffixReading(core, isPre, sw) {
  if (!core || !sw.word || !sw.reading) return null;
  const ok = isPre ? sw.word.startsWith(core) : sw.word.endsWith(core);
  if (!ok || sw.word.length <= core.length) return null;
  const rest = isPre ? sw.word.slice(core.length) : sw.word.slice(0, sw.word.length - core.length);
  try {
    const restRd = kataToHira((await analyzeText(rest)).hiragana);
    const full = kataToHira(sw.reading);
    if (isPre && full.endsWith(restRd) && full.length > restRd.length) return full.slice(0, full.length - restRd.length);
    if (!isPre && full.startsWith(restRd) && full.length > restRd.length) return full.slice(restRd.length);
  } catch (_) {}
  return null;
}
function subwordsBlock(w, title = '例詞') {
  if (!isAffix(w) || !(w.subwords || []).length) return '';
  return `<div class="subwords"><div class="small muted" style="margin-bottom:4px">${title}</div>${w.subwords.map((sw) => subwordHtml(sw, w)).join('')}</div>`;
}

const POS_LIST = ['名詞', '動詞', '自動詞', '他動詞', 'い形容詞', 'な形容詞', '副詞', '接続詞', '助詞', '連体詞', '感動詞', '接頭詞', '接尾詞', '慣用句', '擬態語・擬音語', 'その他'];

let toastTimer = null;
function toast(msg, isErr = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast' + (isErr ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2200);
}

async function api(path, opts = {}) {
  const r = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(json.error || `HTTP ${r.status}`);
  return json;
}
const analyzeText = (text) => api('/api/analyze', { method: 'POST', body: JSON.stringify({ text }) });

// 發音：優先使用 Google 翻譯語音（經伺服器代理、快取），失敗時改用瀏覽器內建語音
let currentAudio = null;
function speakBrowser(text) {
  if (!('speechSynthesis' in window)) return toast('此瀏覽器不支援語音', true);
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ja-JP';
  u.rate = 0.9;
  const voice = speechSynthesis.getVoices().find((v) => v.lang.startsWith('ja'));
  if (voice) u.voice = voice;
  speechSynthesis.speak(u);
}
function speak(text) {
  text = String(text || '').trim();
  if (!text) return;
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  speechSynthesis && speechSynthesis.cancel();
  const engine = localStorage.getItem('n2.tts') || 'google';
  if (engine === 'browser') return speakBrowser(text);
  const a = new Audio('/api/tts?text=' + encodeURIComponent(text));
  currentAudio = a;
  a.onerror = () => { if (currentAudio === a) speakBrowser(text); };
  a.play().catch(() => speakBrowser(text));
}

// ======================= 狀態與儲存 =======================
const state = {
  db: null,
  view: localStorage.getItem('n2.view') || 'units',
  unitId: localStorage.getItem('n2.unitId') || null,
  search: '',
  showRuby: localStorage.getItem('n2.showRuby') !== '0',
  review: null,
  quiz: null,
};

let saveTimer = null;
function saveDb(immediate = false) {
  clearTimeout(saveTimer);
  const doSave = () =>
    api('/api/db', { method: 'PUT', body: JSON.stringify(state.db) }).catch((e) => toast('儲存失敗：' + e.message, true));
  if (immediate) return doSave();
  saveTimer = setTimeout(doSave, 300);
}

const currentUnit = () => state.db.units.find((u) => u.id === state.unitId) || null;
const unitWords = (unitId) => state.db.words.filter((w) => w.unitId === unitId);
const wordById = (id) => state.db.words.find((w) => w.id === id);
const getProgress = (id) => (state.db.progress[id] ||= { known: 0, unknown: 0, quizRight: 0, quizWrong: 0, last: null });

// ======================= 日文處理：標記單字 / 振り仮名 =======================
/** 依分詞結果找出例句中屬於該單字的 token（含活用變化） */
function computeHits(tokens, word) {
  const n = tokens.length;
  const hits = new Array(n).fill(false);
  if (!n || !word) return hits;
  const targets = new Set([word]);
  if (/する$/.test(word) && word.length > 2) targets.add(word.replace(/する$/, ''));
  if (/[だな]$/.test(word) && word.length > 2) targets.add(word.slice(0, -1));
  if (!hasKanji(word)) targets.add(kataToHira(word));
  const tArr = [...targets];

  let any = false;
  for (let i = 0; i < n; i++) {
    let prefix = '';
    for (let j = i; j < n && j < i + 8; j++) {
      const s = prefix + tokens[j].surface;
      const b = prefix + (tokens[j].basic || tokens[j].surface);
      if (tArr.includes(s) || tArr.includes(b) || tArr.includes(kataToHira(s)) || tArr.includes(kataToHira(b))) {
        for (let k = i; k <= j; k++) hits[k] = true;
        any = true;
        i = j;
        break;
      }
      prefix = s;
      const ph = kataToHira(prefix);
      if (!tArr.some((t) => t.startsWith(prefix) || t.startsWith(ph))) break;
    }
  }

  if (!any) {
    // 退而求其次：用「詞幹」做子字串比對（漢字詞去掉送り仮名；假名詞去掉最後一字）
    const stems = [];
    if (hasKanji(word)) {
      const st = word.replace(/する$/, '').replace(/[぀-ゟ]+$/, '');
      if (st) stems.push(st);
    } else if (word.length >= 3) {
      stems.push(word.slice(0, -1));
    }
    const full = tokens.map((t) => t.surface).join('');
    const offsets = [];
    let p = 0;
    tokens.forEach((t) => { offsets.push([p, p + t.surface.length]); p += t.surface.length; });
    for (const st of stems) {
      let idx = full.indexOf(st);
      while (idx >= 0) {
        const end = idx + st.length;
        tokens.forEach((t, k) => { if (offsets[k][0] < end && offsets[k][1] > idx) hits[k] = true; });
        any = true;
        idx = full.indexOf(st, end);
      }
      if (any) break;
    }
  }
  return hits;
}

/** 單一 token → 含 <ruby> 的 HTML（自動分離送り仮名） */
function rubyHtml(surface, reading) {
  if (!state.showRuby || !reading || !hasKanji(surface) || surface === reading) return esc(surface);
  let pre = 0;
  while (pre < surface.length && pre < reading.length && !hasKanji(surface[pre]) && kataToHira(surface[pre]) === reading[pre]) pre++;
  let suf = 0;
  while (
    suf < surface.length - pre && suf < reading.length - pre &&
    !hasKanji(surface[surface.length - 1 - suf]) &&
    kataToHira(surface[surface.length - 1 - suf]) === reading[reading.length - 1 - suf]
  ) suf++;
  const core = surface.slice(pre, surface.length - suf);
  const coreRd = reading.slice(pre, reading.length - suf);
  if (!core || !coreRd) return esc(surface);
  return esc(surface.slice(0, pre)) + `<ruby>${esc(core)}<rt>${esc(coreRd)}</rt></ruby>` + esc(surface.slice(surface.length - suf));
}

const mergeHitSpans = (html) => html.replace(/<\/span><span class="hit">/g, '');

/** 在自訂的平假名字串中標記單字讀音（找不到完整讀音時逐步縮短） */
function highlightReadingIn(text, reading) {
  if (!reading) return esc(text);
  const cands = [reading];
  if (reading.length >= 3) cands.push(reading.slice(0, -1));
  if (reading.length >= 4) cands.push(reading.slice(0, -2));
  for (const c of cands) {
    const idx = text.indexOf(c);
    if (idx >= 0) return esc(text.slice(0, idx)) + `<span class="hit">${esc(c)}</span>` + esc(text.slice(idx + c.length));
  }
  return esc(text);
}

/** 例句 → { jaHtml, hiraHtml, hasHit, blankHtml } */
function renderSentence(ex, w) {
  const tokens = ex.tokens || [];
  const hits = computeHits(tokens, affixCore(w.word));
  let jaHtml = '', hiraHtml = '', blankHtml = '', prevHit = false;
  if (tokens.length) {
    tokens.forEach((t, i) => {
      const r = rubyHtml(t.surface, t.reading);
      const h = esc(t.reading ?? t.surface);
      if (hits[i]) {
        jaHtml += `<span class="hit">${r}</span>`;
        hiraHtml += `<span class="hit">${h}</span>`;
        if (!prevHit) blankHtml += '<span class="blank">　　</span>';
      } else {
        jaHtml += r;
        hiraHtml += h;
        blankHtml += esc(t.surface);
      }
      prevHit = hits[i];
    });
    jaHtml = mergeHitSpans(jaHtml);
    hiraHtml = mergeHitSpans(hiraHtml);
  } else {
    jaHtml = esc(ex.ja);
    blankHtml = esc(ex.ja);
  }
  if (ex.readingOverride) hiraHtml = highlightReadingIn(ex.readingOverride, w.reading);
  return { jaHtml, hiraHtml, blankHtml, hasHit: hits.some(Boolean) };
}

function exampleHtml(ex, w, opts = {}) {
  const { jaHtml, hiraHtml } = renderSentence(ex, w);
  return `<div class="example">
    <div class="ja-line">${jaHtml} <button class="btn ghost sm" data-speak="${esc(ex.ja)}" title="朗讀">🔊</button></div>
    ${opts.hideHira ? '' : `<div class="hira-line">${hiraHtml}</div>`}
    ${ex.zh && !opts.hideZh ? `<div class="zh-line">${esc(ex.zh)}</div>` : ''}
  </div>`;
}

// ======================= 導覽 =======================
function setView(v) {
  state.view = v;
  localStorage.setItem('n2.view', v);
  render();
}
function setUnit(id) {
  state.unitId = id;
  localStorage.setItem('n2.unitId', id || '');
  state.review = null;
  state.quiz = null;
  render();
}

function renderUnitPicker() {
  const sel = $('#unitSelect');
  sel.innerHTML = state.db.units.length
    ? state.db.units.map((u) => `<option value="${u.id}" ${u.id === state.unitId ? 'selected' : ''}>${esc(u.name)} (${unitWords(u.id).length})</option>`).join('')
    : '<option value="">（尚無單元）</option>';
}

function render() {
  if (!state.db) return;
  if (state.unitId && !currentUnit()) state.unitId = null;
  if (!state.unitId && state.db.units.length) state.unitId = state.db.units[0].id;
  renderUnitPicker();
  $$('.nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === state.view));
  const view = $('#view');
  view.innerHTML = '';
  const fn = { units: renderUnits, words: renderWords, review: renderReview, quiz: renderQuiz }[state.view] || renderUnits;
  fn(view);
}

// ======================= Modal =======================
function openModal(html) {
  const m = $('#modal');
  $('.modal-body', m).innerHTML = html;
  m.classList.remove('hidden');
  return $('.modal-body', m);
}
function closeModal() {
  $('#modal').classList.add('hidden');
  $('.modal-body').innerHTML = '';
}
function confirmDialog(msg, okLabel = '確定') {
  return new Promise((resolve) => {
    const body = openModal(`<h2>確認</h2><p>${esc(msg)}</p>
      <div class="row" style="justify-content:flex-end"><button class="btn" data-x="no">取消</button><button class="btn danger" data-x="yes">${esc(okLabel)}</button></div>`);
    $('[data-x=no]', body).onclick = () => { closeModal(); resolve(false); };
    $('[data-x=yes]', body).onclick = () => { closeModal(); resolve(true); };
  });
}

// ======================= 單元頁 =======================
function renderUnits(root) {
  const units = state.db.units;
  root.innerHTML = `
    <div class="card">
      <h2>📚 單元管理</h2>
      <form id="unitForm" class="row">
        <input type="text" id="unitName" class="grow" placeholder="輸入新單元名稱，例如：第1課 生活・買い物" required>
        <button class="btn primary">＋ 新增單元</button>
      </form>
    </div>
    ${units.length ? `<div class="unit-list">${units.map(unitCardHtml).join('')}</div>` : `<div class="empty"><div class="big">🗂️</div>還沒有單元，先在上方建立一個吧！</div>`}
    <div class="card" style="margin-top:20px">
      <h3>資料備份</h3>
      <div class="row">
        <button class="btn" id="exportBtn">⬇️ 匯出 JSON</button>
        <label class="btn">⬆️ 匯入 JSON <input type="file" id="importFile" accept="application/json" hidden></label>
        <span class="muted small">資料儲存於伺服器 data/db.json；匯入會與現有資料合併（同 ID 覆蓋）。</span>
      </div>
    </div>`;

  $('#unitForm', root).onsubmit = (e) => {
    e.preventDefault();
    const name = $('#unitName', root).value.trim();
    if (!name) return;
    const u = { id: uid(), name, createdAt: Date.now() };
    state.db.units.push(u);
    saveDb();
    setUnit(u.id);
    toast(`已建立單元「${name}」`);
  };
  $$('.unit-card', root).forEach((card) => {
    card.onclick = (e) => {
      if (e.target.closest('button')) return;
      setUnit(card.dataset.id);
      setView('words');
    };
  });
  $$('[data-rename]', root).forEach((b) => (b.onclick = () => renameUnit(b.dataset.rename)));
  $$('[data-del]', root).forEach((b) => (b.onclick = () => deleteUnit(b.dataset.del)));
  $('#exportBtn', root).onclick = exportJson;
  $('#importFile', root).onchange = importJson;
}

function unitCardHtml(u) {
  const words = unitWords(u.id);
  const hist = state.db.quizHistory.filter((h) => h.unitId === u.id);
  const last = hist[hist.length - 1];
  const weak = words.filter((w) => { const p = state.db.progress[w.id]; return p && (p.unknown > p.known || p.quizWrong > p.quizRight); }).length;
  return `<div class="unit-card ${u.id === state.unitId ? 'active' : ''}" data-id="${u.id}">
    <div class="name">${esc(u.name)}</div>
    <div class="stats">
      <span>📖 ${words.length} 個單字</span>
      ${weak ? `<span>⚠️ ${weak} 個不熟</span>` : ''}
      ${last ? `<span>📝 上次測驗 ${last.score}/${last.total}</span>` : ''}
    </div>
    <div class="actions">
      <button class="btn sm" data-rename="${u.id}">重新命名</button>
      <button class="btn sm danger" data-del="${u.id}">刪除</button>
    </div>
  </div>`;
}

function renameUnit(id) {
  const u = state.db.units.find((x) => x.id === id);
  const body = openModal(`<h2>重新命名單元</h2>
    <label class="field"><span>單元名稱</span><input type="text" id="rn" value="${esc(u.name)}"></label>
    <div class="row" style="justify-content:flex-end"><button class="btn primary" id="rnOk">儲存</button></div>`);
  $('#rn', body).focus();
  $('#rnOk', body).onclick = () => {
    const v = $('#rn', body).value.trim();
    if (v) { u.name = v; saveDb(); closeModal(); render(); }
  };
}

async function deleteUnit(id) {
  const u = state.db.units.find((x) => x.id === id);
  const cnt = unitWords(id).length;
  if (!(await confirmDialog(`確定刪除單元「${u.name}」？其中 ${cnt} 個單字也會一併刪除。`, '刪除'))) return;
  state.db.units = state.db.units.filter((x) => x.id !== id);
  state.db.words = state.db.words.filter((w) => w.unitId !== id);
  if (state.unitId === id) state.unitId = null;
  saveDb();
  render();
}

function exportJson() {
  const blob = new Blob([JSON.stringify(state.db, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `n2-vocab-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
}
function importJson(e) {
  const f = e.target.files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const d = JSON.parse(reader.result);
      const mergeBy = (arr, add) => { const m = new Map(arr.map((x) => [x.id, x])); (add || []).forEach((x) => m.set(x.id, x)); return [...m.values()]; };
      state.db.units = mergeBy(state.db.units, d.units);
      state.db.words = mergeBy(state.db.words, d.words);
      Object.assign(state.db.progress, d.progress || {});
      state.db.quizHistory = state.db.quizHistory.concat(d.quizHistory || []);
      saveDb();
      render();
      toast('匯入完成');
    } catch (err) { toast('匯入失敗：' + err.message, true); }
  };
  reader.readAsText(f);
  e.target.value = '';
}

// ======================= 單字頁 =======================
function renderWords(root) {
  const u = currentUnit();
  if (!u) {
    root.innerHTML = `<div class="empty"><div class="big">📚</div>請先建立並選擇一個單元。<br><br><button class="btn primary" onclick="setView('units')">前往單元管理</button></div>`;
    return;
  }
  const q = state.search.trim();
  let words = unitWords(u.id);
  if (q) words = words.filter((w) => [w.word, w.reading, w.meaning, w.note, ...(w.examples || []).map((e) => e.ja + e.zh)].join(' ').includes(q));

  root.innerHTML = `
    <div class="row between" style="margin-bottom:14px">
      <h2 style="margin:0">✏️ ${esc(u.name)} <span class="badge gray">${unitWords(u.id).length} 個單字</span></h2>
      <div class="row">
        <button class="btn" id="bulkBtn">📋 批次匯入</button>
        <button class="btn primary" id="addBtn">＋ 新增單字</button>
      </div>
    </div>
    <div class="toolbar">
      <input type="text" id="search" placeholder="搜尋單字 / 假名 / 中文 / 例句…" value="${esc(state.search)}">
      <label class="small muted"><input type="checkbox" id="rubyToggle" ${state.showRuby ? 'checked' : ''}> 顯示振り仮名</label>
      <label class="small muted">🔊 語音：<select id="ttsSel" style="width:auto;padding:3px 6px"><option value="google" ${(localStorage.getItem('n2.tts') || 'google') === 'google' ? 'selected' : ''}>Google 翻譯語音</option><option value="browser" ${localStorage.getItem('n2.tts') === 'browser' ? 'selected' : ''}>瀏覽器內建語音</option></select></label>
      <span class="muted small">例句中 <span class="hit">橘色</span> 為本單字（含活用變化）</span>
    </div>
    <div id="wordList">
      ${words.length ? words.map(wordCardHtml).join('') : `<div class="empty"><div class="big">📝</div>${q ? '找不到符合的單字' : '這個單元還沒有單字，點右上角「新增單字」開始吧！'}</div>`}
    </div>`;

  $('#addBtn', root).onclick = () => openWordForm(null);
  $('#bulkBtn', root).onclick = openBulkImport;
  $('#search', root).oninput = (e) => {
    state.search = e.target.value;
    const list = $('#wordList', root);
    let ws = unitWords(u.id);
    const qq = state.search.trim();
    if (qq) ws = ws.filter((w) => [w.word, w.reading, w.meaning, w.note, ...(w.examples || []).map((x) => x.ja + x.zh)].join(' ').includes(qq));
    list.innerHTML = ws.length ? ws.map(wordCardHtml).join('') : `<div class="empty">找不到符合的單字</div>`;
    bindWordCards(list);
  };
  $('#ttsSel', root).onchange = (e) => { localStorage.setItem('n2.tts', e.target.value); speak('こんにちは'); };
  $('#rubyToggle', root).onchange = (e) => {
    state.showRuby = e.target.checked;
    localStorage.setItem('n2.showRuby', state.showRuby ? '1' : '0');
    render();
  };
  bindWordCards(root);
}

function wordCardHtml(w) {
  const p = state.db.progress[w.id];
  const weak = p && (p.unknown > p.known || p.quizWrong > p.quizRight);
  return `<div class="word-card" data-id="${w.id}">
    <div class="word-head">
      <div class="word-main">
        <div class="row" style="gap:8px">
          <span class="word-text">${esc(w.word)}</span>
          <span class="badge">${esc(w.pos || '—')}</span>
          ${weak ? '<span class="badge warn">不熟</span>' : ''}
        </div>
        <div class="word-reading">${esc(w.reading || '')}</div>
        <div class="word-meaning">${esc(w.meaning)}</div>
        ${w.note ? `<div class="word-note">${esc(w.note)}</div>` : ''}
      </div>
      <div class="word-actions">
        <button class="btn sm" data-speak="${esc(w.word)}">🔊</button>
        <button class="btn sm" data-detail="${w.id}">🔍 查看詳情</button>
        <button class="btn sm" data-edit="${w.id}">編輯</button>
        <button class="btn sm danger" data-delw="${w.id}">刪除</button>
      </div>
    </div>
    ${subwordsBlock(w)}
    ${(w.examples || []).length ? `<div class="examples">${w.examples.map((ex) => exampleHtml(ex, w)).join('')}</div>` : ''}
  </div>`;
}

function bindWordCards(root) {
  $$('[data-speak]', root).forEach((b) => (b.onclick = () => speak(b.dataset.speak)));
  $$('[data-detail]', root).forEach((b) => (b.onclick = () => openDetail(b.dataset.detail)));
  $$('[data-edit]', root).forEach((b) => (b.onclick = () => openWordForm(b.dataset.edit)));
  $$('[data-delw]', root).forEach((b) => (b.onclick = async () => {
    const w = wordById(b.dataset.delw);
    if (!(await confirmDialog(`確定刪除單字「${w.word}」？`, '刪除'))) return;
    state.db.words = state.db.words.filter((x) => x.id !== w.id);
    delete state.db.progress[w.id];
    saveDb();
    render();
  }));
}

// ---------- 新增 / 編輯單字表單 ----------
function openWordForm(id) {
  const editing = id ? wordById(id) : null;
  const w = editing ? JSON.parse(JSON.stringify(editing)) : { word: '', reading: '', pos: '名詞', meaning: '', note: '', examples: [] };
  if (!w.examples.length) w.examples.push({ ja: '', zh: '' });
  w.subwords = w.subwords || [];
  if (!w.subwords.length) w.subwords.push({ word: '', reading: '', zh: '' });

  const body = openModal(`
    <h2>${editing ? '編輯單字' : '新增單字'}</h2>
    <div class="grid3">
      <label class="field"><span>單字（漢字 / 片假名）*</span><input type="text" id="fWord" class="ja" value="${esc(w.word)}" placeholder="例：取り扱う、悪〜、〜的"></label>
      <label class="field"><span>詞性</span><select id="fPos">${POS_LIST.map((p) => `<option ${p === w.pos ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
      <label class="field"><span>平假名 <button type="button" class="btn ghost sm" id="autoReading">自動產生</button></span><input type="text" id="fReading" class="ja" value="${esc(w.reading)}" placeholder="自動產生，可修改"></label>
    </div>
    <label class="field"><span>中文意思 *</span><input type="text" id="fMeaning" value="${esc(w.meaning)}" placeholder="例：處理、經營；對待"></label>
    <label class="field"><span>備註（選填：用法、搭配、近義詞…）</span><textarea id="fNote">${esc(w.note || '')}</textarea></label>
    <div id="swSection" class="${isAffix(w) ? '' : 'hidden'}">
      <h3>例詞（接頭詞 / 接尾詞專用）</h3>
      <p class="small muted" style="margin:0 0 8px">例如 悪〜 的例詞：悪影響 / 不好的影響。平假名會自動產生，可修改。</p>
      <div id="swList"></div>
      <button type="button" class="btn sm" id="addSw">＋ 新增例詞</button>
    </div>
    <h3>例句</h3>
    <div id="exList"></div>
    <button type="button" class="btn sm" id="addEx">＋ 新增例句</button>
    <div class="row" style="justify-content:flex-end;margin-top:18px">
      <button class="btn" id="cancelBtn">取消</button>
      <button class="btn primary" id="saveBtn">${editing ? '儲存變更' : '新增'}</button>
    </div>`);

  const exList = $('#exList', body);
  const analyzeCache = new Map();
  const getTokens = async (ja) => {
    if (!analyzeCache.has(ja)) analyzeCache.set(ja, analyzeText(ja).then((r) => r.tokens));
    return analyzeCache.get(ja);
  };
  const previewWord = () => ({ word: $('#fWord', body).value.trim(), reading: $('#fReading', body).value.trim() });

  function exRowHtml(ex, i) {
    return `<div class="ex-edit" data-i="${i}">
      <div class="row"><input type="text" class="ja exJa grow" placeholder="日文例句" value="${esc(ex.ja)}"><button type="button" class="btn ghost sm exDel" title="移除">✕</button></div>
      <div class="row"><input type="text" class="exZh grow" placeholder="中文翻譯" value="${esc(ex.zh)}"></div>
      <div class="ex-preview">${ex.ja ? '' : '<span class="muted small">輸入例句後自動顯示振り仮名並標記單字</span>'}</div>
      <div class="row small muted" style="margin-top:6px"><label style="display:flex;align-items:center;gap:6px"><input type="checkbox" class="exOverride" ${ex.readingOverride ? 'checked' : ''}> 手動修正平假名</label><input type="text" class="ja exReading grow ${ex.readingOverride ? '' : 'hidden'}" placeholder="整句平假名（自動產生的讀音有誤時使用）" value="${esc(ex.readingOverride || '')}"></div>
    </div>`;
  }
  function renderExRows() {
    exList.innerHTML = w.examples.map(exRowHtml).join('');
    $$('.ex-edit', exList).forEach((row) => {
      const i = +row.dataset.i;
      const jaIn = $('.exJa', row), zhIn = $('.exZh', row), prev = $('.ex-preview', row), ov = $('.exOverride', row), rd = $('.exReading', row);
      jaIn.oninput = () => { w.examples[i].ja = jaIn.value; w.examples[i].tokens = null; };
      jaIn.onchange = () => updatePreview(i, row);
      zhIn.oninput = () => (w.examples[i].zh = zhIn.value);
      ov.onchange = () => { rd.classList.toggle('hidden', !ov.checked); if (!ov.checked) { w.examples[i].readingOverride = ''; rd.value = ''; } updatePreview(i, row); };
      rd.oninput = () => { w.examples[i].readingOverride = rd.value; };
      rd.onchange = () => updatePreview(i, row);
      $('.exDel', row).onclick = () => { w.examples.splice(i, 1); if (!w.examples.length) w.examples.push({ ja: '', zh: '' }); renderExRows(); };
      if (w.examples[i].ja) updatePreview(i, row);
    });
  }
  async function updatePreview(i, row) {
    const ex = w.examples[i];
    const prev = $('.ex-preview', row);
    const ja = ex.ja.trim();
    if (!ja) { prev.innerHTML = '<span class="muted small">輸入例句後自動顯示振り仮名並標記單字</span>'; return; }
    prev.innerHTML = '<span class="loading">分析中…</span>';
    try {
      ex.tokens = await getTokens(ja);
      const rd = $('.exReading', row);
      if (!ex.readingOverride && rd) rd.placeholder = ex.tokens.map((t) => t.reading ?? t.surface).join('');
      const { jaHtml, hiraHtml, hasHit } = renderSentence(ex, previewWord());
      prev.innerHTML = `${jaHtml}<span class="hira">${hiraHtml}</span>${hasHit ? '' : '<span class="small" style="color:var(--warn)">⚠️ 在例句中找不到此單字，請確認單字或例句</span>'}`;
    } catch (e) { prev.innerHTML = `<span class="small" style="color:var(--bad)">分析失敗：${esc(e.message)}</span>`; }
  }
  renderExRows();

  $('#addEx', body).onclick = () => { w.examples.push({ ja: '', zh: '' }); renderExRows(); };

  // ---- 例詞（接頭詞 / 接尾詞）----
  const swList = $('#swList', body);
  function renderSwRows() {
    swList.innerHTML = w.subwords.map((sw, i) => `<div class="ex-edit" data-i="${i}">
      <div class="grid3" style="gap:6px">
        <input type="text" class="ja swWord" placeholder="例詞，例：悪影響" value="${esc(sw.word)}">
        <input type="text" class="ja swReading" placeholder="平假名（自動）" value="${esc(sw.reading)}">
        <div class="row" style="flex-wrap:nowrap"><input type="text" class="swZh grow" placeholder="中文意思" value="${esc(sw.zh)}"><button type="button" class="btn ghost sm swDel" title="移除">✕</button></div>
      </div>
    </div>`).join('');
    $$('.ex-edit', swList).forEach((row) => {
      const i = +row.dataset.i;
      const wd = $('.swWord', row), rd = $('.swReading', row), zh = $('.swZh', row);
      wd.oninput = () => (w.subwords[i].word = wd.value);
      wd.onchange = async () => {
        const v = wd.value.trim();
        if (!v) return;
        try {
          if (!rd.value.trim()) rd.value = w.subwords[i].reading = isKatakanaWord(v) ? v : (await analyzeText(v)).hiragana;
          // 詞綴讀音若是自動產生的，改用例詞推導（單一漢字常讀錯，例如 悪 → わる/あく）
          const fr = $('#fReading', body);
          if (!fr.dataset.manual) {
            const d = await deriveAffixReading(affixCore($('#fWord', body).value), $('#fPos', body).value === '接頭詞', w.subwords[i]);
            if (d) fr.value = d;
          }
        } catch (_) {}
      };
      rd.oninput = () => (w.subwords[i].reading = rd.value);
      zh.oninput = () => (w.subwords[i].zh = zh.value);
      $('.swDel', row).onclick = () => { w.subwords.splice(i, 1); if (!w.subwords.length) w.subwords.push({ word: '', reading: '', zh: '' }); renderSwRows(); };
    });
  }
  renderSwRows();
  $('#addSw', body).onclick = () => { w.subwords.push({ word: '', reading: '', zh: '' }); renderSwRows(); };
  $('#fPos', body).onchange = () => {
    $('#swSection', body).classList.toggle('hidden', !isAffix({ pos: $('#fPos', body).value }));
  };

  const autoReading = async () => {
    const word = $('#fWord', body).value.trim();
    if (!word) return;
    try {
      const core = affixCore(word) || word;
      const r = await analyzeText(core);
      $('#fReading', body).value = isKatakanaWord(core) ? core : r.hiragana;
    } catch (e) { toast('無法取得讀音：' + e.message, true); }
  };
  $('#autoReading', body).onclick = autoReading;
  $('#fReading', body).addEventListener('input', () => { $('#fReading', body).dataset.manual = '1'; });
  $('#fWord', body).addEventListener('change', async () => {
    if (!$('#fReading', body).value.trim()) await autoReading();
    $$('.ex-edit', exList).forEach((row) => { if (w.examples[+row.dataset.i].ja) updatePreview(+row.dataset.i, row); });
  });
  $('#fReading', body).addEventListener('change', () => {
    $$('.ex-edit', exList).forEach((row) => { if (w.examples[+row.dataset.i].ja) updatePreview(+row.dataset.i, row); });
  });

  $('#cancelBtn', body).onclick = closeModal;
  $('#saveBtn', body).onclick = async () => {
    w.word = $('#fWord', body).value.trim();
    w.pos = $('#fPos', body).value;
    w.reading = $('#fReading', body).value.trim();
    w.meaning = $('#fMeaning', body).value.trim();
    w.note = $('#fNote', body).value.trim();
    if (!w.word || !w.meaning) return toast('請填寫單字與中文意思', true);
    const btn = $('#saveBtn', body);
    btn.disabled = true; btn.textContent = '處理中…';
    try {
      w.subwords = isAffix(w) ? w.subwords.map((x) => ({ word: (x.word || '').trim(), reading: (x.reading || '').trim(), zh: (x.zh || '').trim() })).filter((x) => x.word) : [];
      for (const sw of w.subwords) if (!sw.reading) sw.reading = isKatakanaWord(sw.word) ? sw.word : (await analyzeText(sw.word)).hiragana;
      if (!w.reading) {
        const core = affixCore(w.word) || w.word;
        if (w.subwords.length) w.reading = (await deriveAffixReading(core, w.pos === '接頭詞', w.subwords[0])) || '';
        if (!w.reading) w.reading = isKatakanaWord(core) ? core : (await analyzeText(core)).hiragana;
      }
      w.examples = w.examples.map((e) => ({ ...e, ja: e.ja.trim(), zh: (e.zh || '').trim(), readingOverride: (e.readingOverride || '').trim() })).filter((e) => e.ja);
      for (const ex of w.examples) if (!ex.tokens) ex.tokens = await getTokens(ex.ja);
      if (editing) Object.assign(editing, w);
      else { w.id = uid(); w.unitId = state.unitId; w.createdAt = Date.now(); state.db.words.push(w); }
      saveDb();
      closeModal();
      render();
      toast(editing ? '已更新' : `已新增「${w.word}」`);
    } catch (e) {
      toast('儲存失敗：' + e.message, true);
      btn.disabled = false; btn.textContent = '儲存';
    }
  };
  $('#fWord', body).focus();
}

// ---------- 批次匯入 ----------
function openBulkImport() {
  const body = openModal(`
    <h2>📋 批次匯入單字</h2>
    <p class="small muted">每行一個單字，欄位以「|」分隔：<br>
    <code>單字 | 詞性 | 中文意思 | 例句1 / 中文翻譯1 ; 例句2 / 中文翻譯2 | 平假名(選填)</code><br>
    平假名留空會自動產生。全形符號「｜／；」亦可。<br>
    詞性為「接頭詞 / 接尾詞」時，第 4 欄改填例詞：<code>悪〜 | 接頭詞 | 不好的 | 悪影響 / 不好的影響 ; 悪条件 / 惡劣的條件</code></p>
    <textarea id="bulk" style="min-height:220px" class="ja" placeholder="取り扱う | 他動詞 | 處理、經營 | この店では輸入品を取り扱っている。/ 這家店經營進口商品。; 丁寧に取り扱ってください。/ 請小心處理。
締め切り | 名詞 | 截止日期 | 締め切りは明日です。/ 截止日是明天。"></textarea>
    <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn" id="bCancel">取消</button><button class="btn primary" id="bOk">匯入</button></div>
    <div id="bStatus" class="small muted" style="margin-top:8px"></div>`);
  $('#bCancel', body).onclick = closeModal;
  $('#bOk', body).onclick = async () => {
    const lines = $('#bulk', body).value.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return;
    const status = $('#bStatus', body);
    const btn = $('#bOk', body); btn.disabled = true;
    let n = 0;
    for (const line of lines) {
      const f = line.split(/[|｜]/).map((s) => s.trim());
      const [word, pos, meaning, exStr, reading] = f;
      if (!word || !meaning) continue;
      status.textContent = `處理中 ${++n}/${lines.length}：${word}`;
      try {
        const w = { id: uid(), unitId: state.unitId, createdAt: Date.now(), word, pos: POS_LIST.includes(pos) ? pos : (pos || 'その他'), meaning, note: '', examples: [], subwords: [] };
        const core = affixCore(word) || word;
        w.reading = reading || '';
        for (const seg of (exStr || '').split(/[;；]/).map((s) => s.trim()).filter(Boolean)) {
          const [ja, zh = ''] = seg.split(/[\/／]/).map((s) => s.trim());
          if (!ja) continue;
          if (isAffix(w)) {
            // 接頭詞 / 接尾詞：此欄視為例詞
            w.subwords.push({ word: ja, zh, reading: isKatakanaWord(ja) ? ja : (await analyzeText(ja)).hiragana });
          } else {
            const tokens = (await analyzeText(ja)).tokens;
            w.examples.push({ ja, zh, tokens, readingOverride: '' });
          }
        }
        if (!w.reading && w.subwords.length) w.reading = (await deriveAffixReading(core, w.pos === '接頭詞', w.subwords[0])) || '';
        if (!w.reading) w.reading = isKatakanaWord(core) ? core : (await analyzeText(core)).hiragana;
        state.db.words.push(w);
      } catch (e) { status.textContent = `「${word}」失敗：${e.message}`; }
    }
    saveDb();
    closeModal();
    render();
    toast(`已匯入 ${n} 個單字`);
  };
}

// ---------- 詳情（串接外部辭典） ----------
function externalLinks(w) {
  const q = encodeURIComponent(affixCore(w.word) || w.word);
  const links = [
    ['Jisho (英日)', `https://jisho.org/search/${q}`],
    ['Weblio 辞書', `https://www.weblio.jp/content/${q}`],
    ['goo 辞書', `https://dictionary.goo.ne.jp/srch/all/${q}/m0u/`],
    ['コトバンク', `https://kotobank.jp/word/${q}`],
    ['MOJi 辞書 (中日)', `https://www.mojidict.com/searchText/${q}`],
    ['滬江小D (日中)', `https://dict.hjenglish.com/jp/jc/${q}`],
    ['Wiktionary (日)', `https://ja.wiktionary.org/wiki/${q}`],
    ['用例.jp (例句)', `https://yourei.jp/${q}`],
    ['OJAD (重音)', `https://www.gavo.t.u-tokyo.ac.jp/ojad/search/index/word:${q}`],
    ['Forvo (發音)', `https://forvo.com/word/${q}/#ja`],
    ['Google 翻譯', `https://translate.google.com/?sl=ja&tl=zh-TW&text=${q}&op=translate`],
  ];
  return `<div class="links">${links.map(([n, u]) => `<a href="${u}" target="_blank" rel="noopener">${n} ↗</a>`).join('')}</div>`;
}

async function openDetail(id) {
  const w = wordById(id);
  const p = state.db.progress[w.id];
  const body = openModal(`
    <div class="detail-head">
      <div class="row" style="gap:10px">
        <span class="word-text">${esc(w.word)}</span>
        <span class="badge">${esc(w.pos || '—')}</span>
        <button class="btn sm" data-speak="${esc(w.word)}">🔊 朗讀</button>
      </div>
      <div class="word-reading">${esc(w.reading || '')}</div>
      <div class="word-meaning">${esc(w.meaning)}</div>
      ${w.note ? `<div class="word-note">${esc(w.note)}</div>` : ''}
      ${p ? `<div class="small muted" style="margin-top:6px">複習：記得 ${p.known} / 不熟 ${p.unknown}　測驗：答對 ${p.quizRight} / 答錯 ${p.quizWrong}</div>` : ''}
    </div>
    ${isAffix(w) && (w.subwords || []).length ? `<div class="detail-section"><h3>例詞</h3>${w.subwords.map((sw) => subwordHtml(sw, w)).join('')}</div>` : ''}
    ${(w.examples || []).length ? `<div class="detail-section"><h3>我的例句</h3>${w.examples.map((ex) => exampleHtml(ex, w)).join('')}</div>` : ''}
    <div class="detail-section"><h3>🔗 外部辭典連結</h3>${externalLinks(w)}</div>
    <div class="detail-section"><h3>📗 Jisho 辭典 <span class="badge gray">英日 · JLPT 等級</span></h3><div id="dJisho" class="loading">載入中…</div></div>
    <div class="detail-section"><h3>📘 Wiktionary 日日解釋</h3><div id="dWikt" class="loading">載入中…</div></div>
    <div class="detail-section"><h3>💬 Tatoeba 例句 <span class="badge gray">附中文翻譯</span></h3><div id="dTatoeba" class="loading">載入中…</div></div>
  `);
  $$('[data-speak]', body).forEach((b) => (b.onclick = () => speak(b.dataset.speak)));

  const q = affixCore(w.word) || w.word;
  api('/api/dict/jisho?q=' + encodeURIComponent(q)).then((r) => {
    const el = $('#dJisho', body); if (!el) return;
    if (!r.data.length) { el.className = 'muted small'; el.textContent = '查無結果'; return; }
    el.className = '';
    el.innerHTML = r.data.map((d) => `<div class="dict-entry">
        <div class="jp">${d.japanese.map((j) => `${esc(j.word || j.reading)}<span class="rd">${esc(j.word ? j.reading || '' : '')}</span>`).join('、')}
          ${d.is_common ? '<span class="badge ok">常用</span>' : ''} ${(d.jlpt || []).map((t) => `<span class="badge">${esc(t.toUpperCase().replace('JLPT-', ''))}</span>`).join(' ')}
        </div>
        <ol>${d.senses.map((s) => `<li>${esc(s.english_definitions.join('; '))} <span class="pos">${esc(s.parts_of_speech.join(', '))}${s.info && s.info.length ? ' · ' + esc(s.info.join(', ')) : ''}</span></li>`).join('')}</ol>
      </div>`).join('');
  }).catch((e) => { const el = $('#dJisho', body); if (el) { el.className = 'muted small'; el.textContent = e.message; } });

  api('/api/dict/wiktionary?q=' + encodeURIComponent(q)).then((r) => {
    const el = $('#dWikt', body); if (!el) return;
    if (!r.found) { el.className = 'muted small'; el.textContent = '查無此條目'; return; }
    el.className = '';
    el.innerHTML = `<div class="pre ja">${esc(r.text)}</div><a class="small" href="${r.url}" target="_blank" rel="noopener">在 Wiktionary 開啟 ↗</a>`;
  }).catch((e) => { const el = $('#dWikt', body); if (el) { el.className = 'muted small'; el.textContent = e.message; } });

  api('/api/dict/tatoeba?q=' + encodeURIComponent(q)).then((r) => {
    const el = $('#dTatoeba', body); if (!el) return;
    if (!r.data.length) { el.className = 'muted small'; el.textContent = '查無例句'; return; }
    el.className = '';
    el.innerHTML = r.data.map((s) => {
      const zh = s.translations.filter((t) => /^(cmn|yue|wuu|nan)/.test(t.lang));
      const en = s.translations.filter((t) => t.lang === 'eng');
      const tr = (zh.length ? zh : en).slice(0, 2);
      return `<div class="tatoeba-item"><div class="ja-line">${esc(s.text)} <button class="btn ghost sm" data-speak="${esc(s.text)}">🔊</button></div>
        ${tr.map((t) => `<div class="tr">${esc(t.text)}</div>`).join('')}</div>`;
    }).join('') + `<a class="small" href="https://tatoeba.org/zh-tw/sentences/search?from=jpn&to=cmn&query=${encodeURIComponent(q)}" target="_blank" rel="noopener">更多例句 ↗</a>`;
    $$('[data-speak]', el).forEach((b) => (b.onclick = () => speak(b.dataset.speak)));
  }).catch((e) => { const el = $('#dTatoeba', body); if (el) { el.className = 'muted small'; el.textContent = e.message; } });
}

// ======================= 複習頁 =======================
function renderReview(root) {
  const u = currentUnit();
  if (!u) { root.innerHTML = `<div class="empty"><div class="big">📚</div>請先建立並選擇一個單元。</div>`; return; }
  const words = unitWords(u.id);
  if (!words.length) { root.innerHTML = `<div class="empty"><div class="big">📝</div>「${esc(u.name)}」還沒有單字。</div>`; return; }

  if (!state.review) {
    const weakCount = words.filter((w) => { const p = state.db.progress[w.id]; return p && (p.unknown > p.known || p.quizWrong > p.quizRight); }).length;
    root.innerHTML = `<div class="card">
      <h2>🔁 複習：${esc(u.name)}</h2>
      <div class="grid2">
        <label class="field"><span>模式</span><select id="rMode"><option value="cards">字卡（翻面記憶）</option><option value="list">列表（點擊揭曉）</option></select></label>
        <label class="field"><span>字卡正面顯示</span><select id="rFront"><option value="word">日文單字 → 猜意思</option><option value="meaning">中文意思 → 猜單字</option><option value="reading">平假名 → 猜漢字與意思</option></select></label>
      </div>
      <div class="checks">
        <label><input type="checkbox" id="rShuffle" checked> 隨機順序</label>
        <label><input type="checkbox" id="rWeak"> 只複習不熟的（${weakCount} 個）</label>
      </div>
      <div class="row" style="margin-top:16px"><button class="btn primary" id="rStart">開始複習（${words.length} 個單字）</button></div>
    </div>`;
    $('#rStart', root).onclick = () => {
      let list = words.slice();
      if ($('#rWeak', root).checked) list = list.filter((w) => { const p = state.db.progress[w.id]; return p && (p.unknown > p.known || p.quizWrong > p.quizRight); });
      if (!list.length) return toast('沒有符合條件的單字', true);
      if ($('#rShuffle', root).checked) list = shuffle(list);
      state.review = { mode: $('#rMode', root).value, front: $('#rFront', root).value, queue: list.map((w) => w.id), idx: 0, flipped: false, known: [], unknown: [] };
      render();
    };
    return;
  }

  const r = state.review;
  if (r.mode === 'list') return renderReviewList(root, r);

  if (r.idx >= r.queue.length) {
    root.innerHTML = `<div class="card" style="text-align:center">
      <h2>複習完成 🎉</h2>
      <p>記得 <b style="color:var(--ok)">${r.known.length}</b>　不熟 <b style="color:var(--bad)">${r.unknown.length}</b></p>
      ${r.unknown.length ? `<div style="text-align:left;margin:12px 0"><h3>不熟的單字</h3>${r.unknown.map((id) => { const w = wordById(id); return `<div><b class="ja">${esc(w.word)}</b> <span class="muted">${esc(w.reading)}</span> — ${esc(w.meaning)}</div>`; }).join('')}</div>` : ''}
      <div class="row" style="justify-content:center;margin-top:16px">
        ${r.unknown.length ? `<button class="btn primary" id="againWeak">再複習不熟的</button>` : ''}
        <button class="btn" id="rBack">回到設定</button>
      </div></div>`;
    $('#rBack', root).onclick = () => { state.review = null; render(); };
    const ag = $('#againWeak', root);
    if (ag) ag.onclick = () => { state.review = { ...r, queue: shuffle(r.unknown), idx: 0, flipped: false, known: [], unknown: [] }; render(); };
    return;
  }

  const w = wordById(r.queue[r.idx]);
  const frontHtml = r.front === 'meaning' ? `<div class="word-text" style="font-size:32px">${esc(w.meaning)}</div><div class="badge">${esc(w.pos)}</div>`
    : r.front === 'reading' ? `<div class="word-text">${esc(w.reading)}</div><div class="badge">${esc(w.pos)}</div>`
    : `<div class="word-text">${esc(w.word)}</div><div class="badge">${esc(w.pos)}</div>`;
  root.innerHTML = `
    <div class="row between">
      <div>${esc(u.name)}　<span class="muted">${r.idx + 1} / ${r.queue.length}</span></div>
      <button class="btn sm ghost" id="rQuit">結束</button>
    </div>
    <div class="progressbar" style="margin:8px 0"><div style="width:${(r.idx / r.queue.length) * 100}%"></div></div>
    <div class="flashcard ${r.flipped ? 'flipped' : ''}" id="card">
      <div class="flashcard-inner">
        <div class="flashcard-face front">${frontHtml}<div class="hint">點擊卡片翻面（空白鍵）</div></div>
        <div class="flashcard-face back">
          <div class="row" style="gap:10px"><span class="word-text">${esc(w.word)}</span><span class="badge">${esc(w.pos)}</span><button class="btn ghost sm" data-speak="${esc(w.word)}">🔊</button></div>
          <div class="word-reading">${esc(w.reading)}</div>
          <div class="word-meaning">${esc(w.meaning)}</div>
          ${w.note ? `<div class="word-note">${esc(w.note)}</div>` : ''}
          ${subwordsBlock(w)}
          ${(w.examples || []).length ? `<div class="examples">${w.examples.map((ex) => exampleHtml(ex, w)).join('')}</div>` : ''}
        </div>
      </div>
    </div>
    <div class="review-actions">
      <button class="btn bad" id="rNo">✗ 不熟 (1)</button>
      <button class="btn ok" id="rYes">✓ 記得 (2)</button>
    </div>`;
  const card = $('#card', root);
  card.onclick = (e) => { if (e.target.closest('button')) return; r.flipped = !r.flipped; card.classList.toggle('flipped', r.flipped); };
  $$('[data-speak]', root).forEach((b) => (b.onclick = () => speak(b.dataset.speak)));
  const answer = (known) => {
    const p = getProgress(w.id);
    if (known) { p.known++; r.known.push(w.id); } else { p.unknown++; r.unknown.push(w.id); }
    p.last = Date.now();
    saveDb();
    r.idx++; r.flipped = false;
    render();
  };
  $('#rNo', root).onclick = () => answer(false);
  $('#rYes', root).onclick = () => answer(true);
  $('#rQuit', root).onclick = () => { state.review = null; render(); };
}

function renderReviewList(root, r) {
  const u = currentUnit();
  root.innerHTML = `
    <div class="row between" style="margin-bottom:12px">
      <h2 style="margin:0">🔁 ${esc(u.name)} 列表複習</h2>
      <div class="row"><button class="btn sm" id="showAll">全部揭曉</button><button class="btn sm" id="hideAll">全部隱藏</button><button class="btn sm ghost" id="rQuit">結束</button></div>
    </div>
    <p class="small muted">點擊灰色區塊揭曉答案。</p>
    <div class="list-mode"><table>
      <thead><tr><th>單字</th><th>平假名</th><th>詞性</th><th>中文意思</th><th>例句</th></tr></thead>
      <tbody>${r.queue.map((id) => { const w = wordById(id); return `<tr>
        <td class="ja"><b>${esc(w.word)}</b></td>
        <td class="ja"><span class="reveal">${esc(w.reading)}</span></td>
        <td><span class="badge gray">${esc(w.pos)}</span></td>
        <td><span class="reveal">${esc(w.meaning)}</span></td>
        <td>${isAffix(w) && (w.subwords || []).length ? `<span class="reveal">${w.subwords.slice(0, 3).map((sw) => `<span class="ja">${esc(sw.word)}</span>（${esc(sw.reading)}）${esc(sw.zh)}`).join('、')}</span>` : (w.examples || []).slice(0, 1).map((ex) => `<span class="reveal">${exampleHtml(ex, w, { hideHira: true })}</span>`).join('')}</td>
      </tr>`; }).join('')}</tbody>
    </table></div>`;
  $$('.reveal', root).forEach((el) => (el.onclick = () => el.classList.toggle('shown')));
  $('#showAll', root).onclick = () => $$('.reveal', root).forEach((el) => el.classList.add('shown'));
  $('#hideAll', root).onclick = () => $$('.reveal', root).forEach((el) => el.classList.remove('shown'));
  $('#rQuit', root).onclick = () => { state.review = null; render(); };
}

// ======================= 測驗頁 =======================
const QUIZ_TYPES = [
  ['w2m', '看日文選中文'],
  ['m2w', '看中文選日文'],
  ['reading', '輸入平假名讀音'],
  ['cloze', '例句填空（選單字）'],
];

function renderQuiz(root) {
  const u = currentUnit();
  if (!u) { root.innerHTML = `<div class="empty"><div class="big">📚</div>請先建立並選擇一個單元。</div>`; return; }
  const words = unitWords(u.id);
  if (!words.length) { root.innerHTML = `<div class="empty"><div class="big">📝</div>「${esc(u.name)}」還沒有單字。</div>`; return; }
  const q = state.quiz;

  if (!q) {
    const hist = state.db.quizHistory.filter((h) => h.unitId === u.id).slice(-5).reverse();
    root.innerHTML = `<div class="card">
      <h2>📝 測驗：${esc(u.name)}</h2>
      <div class="checks" style="margin-bottom:12px">${QUIZ_TYPES.map(([k, n]) => `<label><input type="checkbox" class="qType" value="${k}" checked> ${n}</label>`).join('')}</div>
      <div class="grid2">
        <label class="field"><span>題數（此單元共 ${words.length} 個單字）</span><input type="number" id="qCount" min="1" max="${Math.max(words.length * 2, 1)}" value="${Math.min(words.length, 20)}"></label>
        <label class="field"><span>選項來源</span><select id="qScope"><option value="unit">只用本單元的單字當干擾選項</option><option value="all">用所有單元的單字當干擾選項</option></select></label>
      </div>
      <button class="btn primary" id="qStart">開始測驗</button>
    </div>
    ${hist.length ? `<div class="card"><h3>最近成績</h3>${hist.map((h) => `<div class="small">${fmtDate(h.date)}　<b>${h.score} / ${h.total}</b>（${Math.round((h.score / h.total) * 100)}%）</div>`).join('')}</div>` : ''}`;
    $('#qStart', root).onclick = () => {
      const types = $$('.qType:checked', root).map((c) => c.value);
      if (!types.length) return toast('請至少選擇一種題型', true);
      const count = Math.max(1, +$('#qCount', root).value || 10);
      const pool = $('#qScope', root).value === 'all' ? state.db.words : words;
      const questions = generateQuestions(words, pool, types, count);
      if (!questions.length) return toast('無法產生題目（例句填空需要有例句的單字）', true);
      state.quiz = { questions, idx: 0, answered: null, results: [] };
      render();
    };
    return;
  }

  if (q.idx >= q.questions.length) return renderQuizResult(root, q);

  const cur = q.questions[q.idx];
  const w = wordById(cur.wordId);
  let promptHtml = '';
  if (cur.type === 'w2m') promptHtml = `<div class="muted small">這個單字的意思是？</div><div class="word-text ja">${esc(w.word)}</div><div class="badge">${esc(w.pos)}</div>`;
  else if (cur.type === 'm2w') promptHtml = `<div class="muted small">哪個單字是這個意思？</div><div class="word-text" style="font-size:28px">${esc(w.meaning)}</div><div class="badge">${esc(w.pos)}</div>`;
  else if (cur.type === 'reading') promptHtml = cur.sub
    ? `<div class="muted small">請輸入這個例詞的平假名讀音（${esc(w.pos)} ${esc(w.word)}）</div><div class="word-text ja">${esc(cur.sub.word)}</div> <span class="small muted">${esc(cur.sub.zh || '')}</span>`
    : `<div class="muted small">請輸入平假名讀音</div><div class="word-text ja">${esc(w.word)}</div><div class="badge">${esc(w.pos)}</div> <span class="small muted">${esc(w.meaning)}</span>`;
  else if (cur.type === 'cloze') promptHtml = `<div class="muted small">請選出填入空格的單字</div><div class="ja-line">${cur.blankHtml}</div><div class="small muted">${esc(cur.zh || '')}</div>`;

  root.innerHTML = `
    <div class="row between">
      <div>${esc(u.name)}　<span class="muted">第 ${q.idx + 1} / ${q.questions.length} 題</span></div>
      <button class="btn sm ghost" id="qQuit">放棄</button>
    </div>
    <div class="progressbar" style="margin:8px 0"><div style="width:${(q.idx / q.questions.length) * 100}%"></div></div>
    <div class="card">
      <div class="quiz-q">${promptHtml}</div>
      ${cur.type === 'reading'
        ? `<form id="rForm" class="row"><input type="text" id="rAns" class="answer-input grow" autocomplete="off" placeholder="ひらがな"><button class="btn primary">確認</button></form>`
        : `<div class="choices">${cur.choices.map((c, i) => `<button class="choice ${cur.type === 'm2w' || cur.type === 'cloze' ? 'ja' : ''}" data-i="${i}">${esc(c.label)}</button>`).join('')}</div>`}
      <div id="feedback"></div>
    </div>`;

  $('#qQuit', root).onclick = () => { state.quiz = null; render(); };

  const finish = (correct, userAns) => {
    q.results.push({ wordId: w.id, type: cur.type, correct, userAns, answer: cur.answerLabel });
    const p = getProgress(w.id);
    if (correct) p.quizRight++; else p.quizWrong++;
    saveDb();
    const fb = $('#feedback', root);
    fb.innerHTML = `<div class="feedback ${correct ? 'ok' : 'bad'}">${correct ? '✓ 答對了！' : `✗ 答錯了，正確答案：<b class="ja">${esc(cur.answerLabel)}</b>`}
      <div class="small" style="margin-top:4px;color:var(--text)"><b class="ja">${esc(w.word)}</b>（${esc(w.reading)}）${esc(w.meaning)}</div>
      ${cur.type === 'cloze' ? `<div class="ja small" style="margin-top:4px;color:var(--text)">${cur.fullHtml}</div>` : ''}
      </div>
      <div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn primary" id="qNext">${q.idx + 1 < q.questions.length ? '下一題 →' : '看成績'}</button></div>`;
    const nextBtn = $('#qNext', root);
    nextBtn.onclick = () => { q.idx++; render(); };
    nextBtn.focus();
  };

  if (cur.type === 'reading') {
    const input = $('#rAns', root);
    input.focus();
    $('#rForm', root).onsubmit = (e) => {
      e.preventDefault();
      if (q.results.length > q.idx) return;
      const norm = (s) => kataToHira(s).replace(/[\s・･、,，。]/g, '');
      const ans = norm(input.value);
      const accepted = String(cur.sub ? cur.sub.reading : w.reading).split(/[\/／、,，;；]/).map(norm).filter(Boolean);
      input.disabled = true;
      finish(accepted.includes(ans), input.value);
    };
  } else {
    $$('.choice', root).forEach((b) => (b.onclick = () => {
      const i = +b.dataset.i;
      $$('.choice', root).forEach((x) => (x.disabled = true));
      const correct = cur.choices[i].wordId === w.id;
      b.classList.add(correct ? 'correct' : 'wrong');
      if (!correct) $$('.choice', root)[cur.choices.findIndex((c) => c.wordId === w.id)].classList.add('correct');
      finish(correct, cur.choices[i].label);
    }));
  }
}

function generateQuestions(words, pool, types, count) {
  const qs = [];
  const labelOf = (type, w) => (type === 'w2m' ? w.meaning : w.word);
  const distractors = (w, type) => {
    const label = labelOf(type, w);
    let cands = pool.filter((x) => x.id !== w.id && labelOf(type, x) !== label);
    const same = cands.filter((x) => x.pos === w.pos);
    const list = shuffle(same).concat(shuffle(cands.filter((x) => x.pos !== w.pos)));
    const seen = new Set([label]);
    const out = [];
    for (const x of list) { const l = labelOf(type, x); if (seen.has(l)) continue; seen.add(l); out.push(x); if (out.length >= 3) break; }
    return out;
  };
  const clozeOf = (w) => {
    const exs = (w.examples || []).filter((ex) => ex.tokens && ex.tokens.length);
    for (const ex of shuffle(exs)) {
      const s = renderSentence(ex, w);
      if (s.hasHit) return { ex, ...s };
    }
    return null;
  };
  let order = shuffle(words);
  while (order.length < count) order = order.concat(shuffle(words));
  for (const w of order.slice(0, count)) {
    let avail = types.filter((t) => {
      if (t === 'reading') return (isAffix(w) && (w.subwords || []).some((x) => x.reading)) || (w.reading && kataToHira(affixCore(w.word)) !== w.reading);
      if (t === 'cloze') return !!clozeOf(w);
      return true;
    });
    if (!avail.length) avail = types.filter((t) => t !== 'cloze' && t !== 'reading');
    if (!avail.length) continue;
    const type = pick(avail);
    const qd = { type, wordId: w.id };
    if (type === 'reading') {
      const subs = isAffix(w) ? (w.subwords || []).filter((x) => x.reading) : [];
      if (subs.length) { qd.sub = pick(subs); qd.answerLabel = qd.sub.reading; }
      else qd.answerLabel = w.reading;
    }
    else {
      const ctype = type === 'w2m' ? 'w2m' : 'm2w';
      qd.choices = shuffle([w, ...distractors(w, ctype)].map((x) => ({ wordId: x.id, label: labelOf(ctype, x) })));
      qd.answerLabel = labelOf(ctype, w);
      if (type === 'cloze') {
        const c = clozeOf(w);
        qd.blankHtml = c.blankHtml; qd.fullHtml = c.jaHtml; qd.zh = c.ex.zh;
      }
    }
    qs.push(qd);
  }
  return qs;
}

function renderQuizResult(root, q) {
  const u = currentUnit();
  const score = q.results.filter((r) => r.correct).length;
  if (!q.saved) {
    q.saved = true;
    state.db.quizHistory.push({ unitId: u.id, date: Date.now(), score, total: q.results.length });
    saveDb();
  }
  const wrong = q.results.filter((r) => !r.correct);
  root.innerHTML = `<div class="card">
    <h2 style="text-align:center">測驗結果</h2>
    <div class="score-big">${score} / ${q.results.length}</div>
    <p style="text-align:center" class="muted">${Math.round((score / q.results.length) * 100)}%　${score === q.results.length ? '滿分！太厲害了 🎉' : wrong.length <= 2 ? '很棒，再加油一下！' : '多複習幾次吧 💪'}</p>
    ${wrong.length ? `<h3>答錯的題目</h3>${wrong.map((r) => { const w = wordById(r.wordId); return `<div class="dict-entry">
        <div class="jp">${esc(w.word)}<span class="rd">${esc(w.reading)}</span> <span class="badge gray">${esc(QUIZ_TYPES.find((t) => t[0] === r.type)[1])}</span></div>
        <div>${esc(w.meaning)}</div>
        <div class="small muted">你的答案：${esc(r.userAns || '（未作答）')}　正確：<b class="ja">${esc(r.answer)}</b></div>
      </div>`; }).join('')}` : ''}
    <div class="row" style="justify-content:center;margin-top:16px">
      <button class="btn primary" id="qAgain">再測一次</button>
      ${wrong.length ? `<button class="btn" id="qReviewWrong">複習答錯的單字</button>` : ''}
      <button class="btn" id="qBack">回到設定</button>
    </div></div>`;
  $('#qAgain', root).onclick = () => { state.quiz = null; render(); };
  $('#qBack', root).onclick = () => { state.quiz = null; render(); };
  const rw = $('#qReviewWrong', root);
  if (rw) rw.onclick = () => {
    state.review = { mode: 'cards', front: 'word', queue: [...new Set(wrong.map((r) => r.wordId))], idx: 0, flipped: false, known: [], unknown: [] };
    state.quiz = null;
    setView('review');
  };
}

// ======================= 初始化 =======================
async function init() {
  $$('.nav button').forEach((b) => (b.onclick = () => setView(b.dataset.view)));
  $('#unitSelect').onchange = (e) => setUnit(e.target.value);
  $('.modal-close').onclick = closeModal;
  $('.modal-backdrop').onclick = closeModal;
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
    if (!$('#modal').classList.contains('hidden')) return;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
    if (state.view === 'review' && state.review && state.review.mode === 'cards') {
      if (e.key === ' ') { e.preventDefault(); const c = $('#card'); if (c) c.click(); }
      if (e.key === '1') { const b = $('#rNo'); if (b) b.click(); }
      if (e.key === '2') { const b = $('#rYes'); if (b) b.click(); }
    }
  });
  if ('speechSynthesis' in window) speechSynthesis.getVoices();
  try {
    state.db = await api('/api/db');
    state.db.words.forEach((w) => { if (w.pos === '接尾語') w.pos = '接尾詞'; });
  } catch (e) {
    $('#view').innerHTML = `<div class="empty">無法連線到伺服器：${esc(e.message)}</div>`;
    return;
  }
  render();
}
init();
