// N2 單字學習平台 - 後端
// 提供：資料儲存 (data/db.json)、日文分詞/假名 (kuromoji)、外部辭典 API 代理 (Jisho / Tatoeba)
const express = require('express');
const fs = require('fs');
const path = require('path');
const kuromoji = require('kuromoji');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

// ---------- 密碼保護（部署到網路時設定環境變數 APP_PASSWORD 即啟用）----------
const APP_PASSWORD = process.env.APP_PASSWORD || '';
if (APP_PASSWORD) {
  app.use((req, res, next) => {
    const h = req.headers.authorization || '';
    const [scheme, encoded] = h.split(' ');
    if (scheme === 'Basic' && encoded) {
      const [, pw] = Buffer.from(encoded, 'base64').toString().split(':');
      if (pw === APP_PASSWORD) return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="N2 vocab", charset="UTF-8"');
    res.status(401).send('需要密碼');
  });
}

app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- 資料庫 (單一 JSON 檔) ----------
const EMPTY_DB = { units: [], words: [], progress: {}, quizHistory: [] };

function loadDb() {
  try {
    if (!fs.existsSync(DB_FILE)) return { ...EMPTY_DB };
    const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    return { ...EMPTY_DB, ...db };
  } catch (e) {
    console.error('讀取 db.json 失敗：', e.message);
    return { ...EMPTY_DB };
  }
}

function saveDb(db) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  // 備份：寫入前先把「上一版」留成 .bak（誤刪時可從這裡救回）
  try { if (fs.existsSync(DB_FILE)) fs.copyFileSync(DB_FILE, DB_FILE + '.bak'); } catch (_) {}
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

// 雲端儲存：設定 UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN 後，資料改存到 Upstash Redis
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL || '';
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const useCloud = !!(UPSTASH_URL && UPSTASH_TOKEN);
const REDIS_KEY = 'n2vocab:db';

async function upstash(cmd) {
  const r = await fetch(UPSTASH_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + UPSTASH_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
    signal: AbortSignal.timeout(15000),
  });
  const json = await r.json();
  if (!r.ok || json.error) throw new Error(json.error || `HTTP ${r.status}`);
  return json.result;
}

async function readDb() {
  if (!useCloud) return loadDb();
  const raw = await upstash(['GET', REDIS_KEY]);
  if (!raw) return { ...EMPTY_DB };
  return { ...EMPTY_DB, ...JSON.parse(raw) };
}
async function writeDb(db) {
  if (!useCloud) return saveDb(db);
  // 雲端也保留上一版，方便誤刪救回
  const prev = await upstash(['GET', REDIS_KEY]);
  if (prev) await upstash(['SET', REDIS_KEY + ':bak', prev]);
  await upstash(['SET', REDIS_KEY, JSON.stringify(db)]);
}

app.get('/api/db', async (req, res) => {
  try { res.json(await readDb()); }
  catch (e) { res.status(500).json({ error: '讀取資料失敗：' + e.message }); }
});

app.put('/api/db', async (req, res) => {
  const db = req.body;
  if (!db || !Array.isArray(db.units) || !Array.isArray(db.words)) {
    return res.status(400).json({ error: '資料格式錯誤' });
  }
  try { await writeDb({ ...EMPTY_DB, ...db }); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: '儲存失敗：' + e.message }); }
});

// ---------- 日文分詞 / 假名 ----------
const tokenizerReady = new Promise((resolve, reject) => {
  kuromoji
    .builder({ dicPath: path.join(__dirname, 'node_modules', 'kuromoji', 'dict') })
    .build((err, tokenizer) => (err ? reject(err) : resolve(tokenizer)));
});

const kataToHira = (s) =>
  s.replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
const isKana = (s) => /^[぀-ヿー]+$/.test(s);

async function analyze(text) {
  const tokenizer = await tokenizerReady;
  return tokenizer.tokenize(text).map((t) => {
    let reading = null;
    if (t.reading) reading = kataToHira(t.reading);
    else if (isKana(t.surface_form)) reading = kataToHira(t.surface_form);
    return {
      surface: t.surface_form,
      reading, // 平假名；無法判斷時為 null
      basic: !t.basic_form || t.basic_form === '*' ? t.surface_form : t.basic_form,
      pos: t.pos,
      pos1: t.pos_detail_1,
    };
  });
}

app.post('/api/analyze', async (req, res) => {
  try {
    const text = String(req.body.text || '').trim();
    if (!text) return res.json({ tokens: [], hiragana: '' });
    const tokens = await analyze(text);
    const hiragana = tokens.map((t) => t.reading ?? t.surface).join('');
    res.json({ tokens, hiragana });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- 外部辭典 API 代理 ----------
const cache = new Map();
async function cachedFetchJson(key, url, opts = {}) {
  if (cache.has(key)) return cache.get(key);
  const r = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (N2 vocab study app)', Accept: 'application/json' },
    signal: AbortSignal.timeout(12000),
    ...opts,
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const json = await r.json();
  cache.set(key, json);
  return json;
}

// Jisho.org（英日辭典，含 JLPT 等級、詞性、常用度）
app.get('/api/dict/jisho', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: '缺少 q' });
  try {
    const json = await cachedFetchJson(
      'jisho:' + q,
      'https://jisho.org/api/v1/search/words?keyword=' + encodeURIComponent(q)
    );
    res.json({ source: 'jisho', data: (json.data || []).slice(0, 5) });
  } catch (e) {
    res.status(502).json({ error: 'Jisho 取得失敗：' + e.message });
  }
});

// Tatoeba（例句語料庫，含中文翻譯）
app.get('/api/dict/tatoeba', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: '缺少 q' });
  try {
    const url =
      'https://tatoeba.org/en/api_v0/search?from=jpn&to=cmn&sort=relevance&query=' +
      encodeURIComponent(q);
    const json = await cachedFetchJson('tatoeba:' + q, url);
    const results = (json.results || []).slice(0, 10).map((s) => {
      const trans = [];
      const flat = Array.isArray(s.translations) ? s.translations.flat(2) : [];
      for (const t of flat) {
        if (t && t.text) trans.push({ lang: t.lang, text: t.text });
      }
      const furigana = (s.transcriptions || []).map((t) => t.text).find(Boolean) || null;
      return { id: s.id, text: s.text, furigana, translations: trans };
    });
    res.json({ source: 'tatoeba', data: results });
  } catch (e) {
    res.status(502).json({ error: 'Tatoeba 取得失敗：' + e.message });
  }
});

// 日文 Wiktionary（日日解釋，純文字摘錄）
app.get('/api/dict/wiktionary', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: '缺少 q' });
  try {
    const url =
      'https://ja.wiktionary.org/w/api.php?action=query&prop=extracts&explaintext=1&format=json&redirects=1&titles=' +
      encodeURIComponent(q);
    const json = await cachedFetchJson('wikt:' + q, url);
    const pages = Object.values((json.query && json.query.pages) || {});
    const page = pages[0];
    if (!page || page.missing !== undefined || !page.extract) {
      return res.json({ source: 'wiktionary', found: false });
    }
    // 只取「日本語」段落
    let text = page.extract;
    const idx = text.indexOf('== 日本語 ==');
    if (idx >= 0) {
      text = text.slice(idx);
      const next = text.indexOf('\n== ', 5);
      if (next > 0) text = text.slice(0, next);
    }
    // 若條目只是「○○を参照」的轉向，順便抓取被參照的條目
    const ref = text.length < 200 && text.match(/([^\s（）()]+)を参照/);
    if (ref && ref[1] !== page.title) {
      try {
        const j2 = await cachedFetchJson(
          'wikt:' + ref[1],
          'https://ja.wiktionary.org/w/api.php?action=query&prop=extracts&explaintext=1&format=json&redirects=1&titles=' +
            encodeURIComponent(ref[1])
        );
        const p2 = Object.values((j2.query && j2.query.pages) || {})[0];
        if (p2 && p2.extract) {
          let t2 = p2.extract;
          const i2 = t2.indexOf('== 日本語 ==');
          if (i2 >= 0) {
            t2 = t2.slice(i2);
            const n2 = t2.indexOf('\n== ', 5);
            if (n2 > 0) t2 = t2.slice(0, n2);
          }
          text += '\n\n---- ' + p2.title + ' ----\n' + t2;
        }
      } catch (_) {}
    }
    // 整理版面：標題改為【…】、移除多餘空行
    text = text
      .replace(/^==+\s*(.+?)\s*==+$/gm, (m, h) => (h === '日本語' ? '' : `【${h}】`))
      .replace(/\n{2,}/g, '\n')
      .trim();
    res.json({
      source: 'wiktionary',
      found: true,
      title: page.title,
      text: text.slice(0, 4000),
      url: 'https://ja.wiktionary.org/wiki/' + encodeURIComponent(page.title),
    });
  } catch (e) {
    res.status(502).json({ error: 'Wiktionary 取得失敗：' + e.message });
  }
});

// ---------- 發音（Google 翻譯語音，快取為 mp3） ----------
const crypto = require('crypto');
const TTS_DIR = path.join(DATA_DIR, 'tts');

app.get('/api/tts', async (req, res) => {
  const text = String(req.query.text || '').trim().slice(0, 200);
  if (!text) return res.status(400).json({ error: '缺少 text' });
  const file = path.join(TTS_DIR, crypto.createHash('md5').update(text).digest('hex') + '.mp3');
  try {
    if (!fs.existsSync(file)) {
      const url =
        'https://translate.google.com/translate_tts?ie=UTF-8&tl=ja&client=tw-ob&q=' + encodeURIComponent(text);
      const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://translate.google.com/' },
        signal: AbortSignal.timeout(12000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      if (!fs.existsSync(TTS_DIR)) fs.mkdirSync(TTS_DIR, { recursive: true });
      fs.writeFileSync(file, buf);
    }
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    res.status(502).json({ error: 'TTS 取得失敗：' + e.message });
  }
});

app.listen(PORT, () => {
  console.log(`N2 單字學習平台已啟動： http://localhost:${PORT}`);
  console.log(`資料儲存：${useCloud ? 'Upstash Redis（雲端）' : 'data/db.json（本機）'}　密碼保護：${APP_PASSWORD ? '開' : '關'}`);
  tokenizerReady.then(() => console.log('日文分詞器 (kuromoji) 載入完成'));
});
