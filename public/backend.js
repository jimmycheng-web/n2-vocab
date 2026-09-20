/* 資料 / 分詞 / 辭典 / 發音 的後端介面
 * - serverBackend：本機 Node 伺服器（npm start）
 * - staticBackend：純瀏覽器版（GitHub Pages）— 分詞用 CDN 的 kuromoji、資料存 localStorage 並可同步到 GitHub Gist
 */
'use strict';

const N2_STATIC = !!window.N2_STATIC;

const _kataToHira = (s) => String(s || '').replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
const _isKana = (s) => /^[぀-ヿー]+$/.test(s);

async function _json(url, opts = {}) {
  const r = await fetch(url, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || j.message || `HTTP ${r.status}`);
  return j;
}

// ---------------- 本機伺服器版 ----------------
const serverBackend = {
  name: 'server',
  loadDb: () => _json('/api/db'),
  saveDb: (db) => _json('/api/db', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(db) }),
  analyze: (text) => _json('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) }),
  jisho: (q) => _json('/api/dict/jisho?q=' + encodeURIComponent(q)),
  wiktionary: (q) => _json('/api/dict/wiktionary?q=' + encodeURIComponent(q)),
  tatoeba: (q) => _json('/api/dict/tatoeba?q=' + encodeURIComponent(q)),
  ttsUrl: (text) => '/api/tts?text=' + encodeURIComponent(text),
  ttsNoReferrer: false,
};

// ---------------- 純瀏覽器版（GitHub Pages） ----------------
// Jotoba（jotoba.de）：與 Jisho 同源（JMdict / Tatoeba），且支援跨網域，靜態版用它取代 Jisho / Tatoeba
const JOTOBA = (path, body) => _json('https://jotoba.de/api/search/' + path, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language: 'English', no_english: false, ...body }),
});
const _posLabel = (p) => {
  if (typeof p === 'string') return p;
  const [k, v] = Object.entries(p)[0] || [];
  if (v === undefined || v === null) return k;
  if (typeof v === 'string') return `${k} (${v})`;
  const [k2, v2] = Object.entries(v)[0] || [];
  return `${k} (${k2}${v2 ? ' ' + v2 : ''})`;
};
const GIST_FILE = 'n2-vocab.json';
const LS_DB = 'n2.db', LS_TOKEN = 'n2.gistToken', LS_GIST = 'n2.gistId', LS_SYNC = 'n2.lastSync';

// 分詞在 Web Worker 執行（下載 + 解壓 17MB 字典時不會凍結畫面）；以 Blob 建立，不依賴外部檔案
const WORKER_SRC = `
importScripts('https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/build/kuromoji.js');
let tokenizer = null;
const queue = [];
function run(msg) {
  try { postMessage({ type: 'result', id: msg.id, tokens: tokenizer.tokenize(msg.text) }); }
  catch (e) { postMessage({ type: 'result', id: msg.id, error: String(e && e.message || e) }); }
}
kuromoji.builder({ dicPath: 'https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/dict/' }).build((err, t) => {
  if (err) { postMessage({ type: 'error', message: String(err) }); return; }
  tokenizer = t;
  postMessage({ type: 'ready' });
  queue.splice(0).forEach(run);
});
onmessage = (e) => { if (tokenizer) run(e.data); else queue.push(e.data); };
`;
let _worker = null, _workerReady = false, _seq = 0;
const _pending = new Map();
function getWorker(onStatus) {
  if (_worker) return _worker;
  onStatus && onStatus('載入日文字典（約 17MB，只需一次）…');
  _worker = new Worker(URL.createObjectURL(new Blob([WORKER_SRC], { type: 'application/javascript' })));
  _worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'ready') { _workerReady = true; onStatus && onStatus(''); return; }
    if (m.type === 'error') {
      onStatus && onStatus('字典載入失敗：' + m.message);
      _pending.forEach((p) => p.reject(new Error(m.message)));
      _pending.clear();
      _worker = null;
      return;
    }
    const p = _pending.get(m.id);
    if (!p) return;
    _pending.delete(m.id);
    m.error ? p.reject(new Error(m.error)) : p.resolve(m.tokens);
  };
  _worker.onerror = (e) => { onStatus && onStatus('字典載入失敗：' + e.message); _pending.forEach((p) => p.reject(new Error(e.message))); _pending.clear(); _worker = null; };
  return _worker;
}
function tokenizeInWorker(text, onStatus) {
  const w = getWorker(onStatus);
  return new Promise((resolve, reject) => {
    const id = ++_seq;
    _pending.set(id, { resolve, reject });
    w.postMessage({ id, text });
  });
}

const gist = {
  token: () => localStorage.getItem(LS_TOKEN) || '',
  id: () => localStorage.getItem(LS_GIST) || '',
  headers() {
    return { Authorization: 'Bearer ' + this.token(), Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' };
  },
  async find() {
    if (this.id()) return this.id();
    const list = await _json('https://api.github.com/gists?per_page=100', { headers: this.headers() });
    const g = list.find((x) => x.files && x.files[GIST_FILE]);
    if (g) { localStorage.setItem(LS_GIST, g.id); return g.id; }
    return '';
  },
  async pull() {
    const id = await this.find();
    if (!id) return null;
    const g = await _json('https://api.github.com/gists/' + id, { headers: this.headers() });
    const f = g.files[GIST_FILE];
    if (!f) return null;
    let content = f.content;
    if (f.truncated) content = await (await fetch(f.raw_url, { headers: this.headers() })).text();
    return JSON.parse(content);
  },
  async push(db) {
    const body = JSON.stringify({ description: 'N2 単語帳 資料（自動同步）', public: false, files: { [GIST_FILE]: { content: JSON.stringify(db) } } });
    let id = await this.find();
    if (id) {
      try { await _json('https://api.github.com/gists/' + id, { method: 'PATCH', headers: this.headers(), body }); return id; }
      catch (e) { if (!/404/.test(e.message)) throw e; localStorage.removeItem(LS_GIST); }
    }
    const g = await _json('https://api.github.com/gists', { method: 'POST', headers: this.headers(), body });
    localStorage.setItem(LS_GIST, g.id);
    return g.id;
  },
};

let _pushTimer = null;
let _syncListeners = [];
function _emitSync(status) { _syncListeners.forEach((f) => f(status)); }

const staticBackend = {
  name: 'static',
  gist,
  onSync: (f) => _syncListeners.push(f),
  status: '',
  async loadDb() {
    let local = null;
    try { local = JSON.parse(localStorage.getItem(LS_DB) || 'null'); } catch (_) {}
    if (gist.token()) {
      try {
        _emitSync('syncing');
        const remote = await gist.pull();
        const lt = (local && local.meta && local.meta.updatedAt) || 0;
        const rt = (remote && remote.meta && remote.meta.updatedAt) || 0;
        if (remote && rt >= lt) { local = remote; localStorage.setItem(LS_DB, JSON.stringify(remote)); }
        else if (local && lt > rt) { await gist.push(local); }
        localStorage.setItem(LS_SYNC, String(Date.now()));
        _emitSync('ok');
      } catch (e) { _emitSync('error:' + e.message); }
    }
    return local || { units: [], words: [], progress: {}, quizHistory: [] };
  },
  async saveDb(db) {
    db.meta = { ...(db.meta || {}), updatedAt: Date.now() };
    localStorage.setItem(LS_DB, JSON.stringify(db));
    if (!gist.token()) return;
    clearTimeout(_pushTimer);
    _emitSync('pending');
    _pushTimer = setTimeout(async () => {
      try { _emitSync('syncing'); await gist.push(db); localStorage.setItem(LS_SYNC, String(Date.now())); _emitSync('ok'); }
      catch (e) { _emitSync('error:' + e.message); }
    }, 1500);
  },
  async syncNow(db) {
    clearTimeout(_pushTimer);
    _emitSync('syncing');
    await gist.push(db);
    localStorage.setItem(LS_SYNC, String(Date.now()));
    _emitSync('ok');
  },
  async analyze(text) {
    text = String(text || '').trim();
    if (!text) return { tokens: [], hiragana: '' };
    const raw = await tokenizeInWorker(text, (msg) => { staticBackend.status = msg; _emitSync('dict:' + msg); });
    const tokens = raw.map((tk) => {
      let reading = null;
      if (tk.reading) reading = _kataToHira(tk.reading);
      else if (_isKana(tk.surface_form)) reading = _kataToHira(tk.surface_form);
      return {
        surface: tk.surface_form,
        reading,
        basic: !tk.basic_form || tk.basic_form === '*' ? tk.surface_form : tk.basic_form,
        pos: tk.pos,
        pos1: tk.pos_detail_1,
      };
    });
    return { tokens, hiragana: tokens.map((x) => x.reading ?? x.surface).join('') };
  },
  async jisho(q) {
    const j = await JOTOBA('words', { query: q });
    const data = (j.words || []).slice(0, 5).map((w) => ({
      slug: w.reading.kanji || w.reading.kana,
      is_common: !!w.common,
      jlpt: w.jlpt_lvl ? ['jlpt-n' + w.jlpt_lvl] : [],
      japanese: [{ word: w.reading.kanji || w.reading.kana, reading: w.reading.kanji ? w.reading.kana : '' }],
      senses: (w.senses || []).map((s) => ({ english_definitions: s.glosses || [], parts_of_speech: (s.pos || []).map(_posLabel), info: s.information ? [s.information] : [] })),
    }));
    return { source: 'jotoba', data };
  },
  async wiktionary(q) {
    const fetchPage = async (title) => {
      const j = await _json('https://ja.wiktionary.org/w/api.php?action=query&prop=extracts&explaintext=1&format=json&redirects=1&origin=*&titles=' + encodeURIComponent(title));
      const page = Object.values((j.query && j.query.pages) || {})[0];
      if (!page || page.missing !== undefined || !page.extract) return null;
      let text = page.extract;
      const idx = text.indexOf('== 日本語 ==');
      if (idx >= 0) { text = text.slice(idx); const next = text.indexOf('\n== ', 5); if (next > 0) text = text.slice(0, next); }
      return { title: page.title, text };
    };
    const p = await fetchPage(q);
    if (!p) return { source: 'wiktionary', found: false };
    let text = p.text;
    const ref = text.length < 200 && text.match(/([^\s（）()]+)を参照/);
    if (ref && ref[1] !== p.title) {
      const p2 = await fetchPage(ref[1]).catch(() => null);
      if (p2) text += '\n\n---- ' + p2.title + ' ----\n' + p2.text;
    }
    text = text.replace(/^==+\s*(.+?)\s*==+$/gm, (m, h) => (h === '日本語' ? '' : `【${h}】`)).replace(/\n{2,}/g, '\n').trim();
    return { source: 'wiktionary', found: true, title: p.title, text: text.slice(0, 4000), url: 'https://ja.wiktionary.org/wiki/' + encodeURIComponent(p.title) };
  },
  async tatoeba(q) {
    const j = await JOTOBA('sentences', { query: q });
    const data = (j.sentences || []).slice(0, 10).map((s, i) => ({
      id: i, text: s.content, furigana: s.furigana || null,
      translations: s.translation ? [{ lang: 'eng', text: s.translation }] : [],
    }));
    return { source: 'jotoba', data };
  },
  ttsUrl: (text) => 'https://translate.google.com/translate_tts?ie=UTF-8&tl=ja&client=tw-ob&q=' + encodeURIComponent(text.slice(0, 200)),
  ttsNoReferrer: true,
};

window.backend = N2_STATIC ? staticBackend : serverBackend;
