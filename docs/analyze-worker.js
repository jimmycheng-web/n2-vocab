// 在 Web Worker 中載入 kuromoji 與字典，避免解壓 / 建構字典時凍結畫面（純瀏覽器版用）
importScripts('https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/build/kuromoji.js');

let tokenizer = null;
const queue = [];

function run(msg) {
  try {
    postMessage({ type: 'result', id: msg.id, tokens: tokenizer.tokenize(msg.text) });
  } catch (e) {
    postMessage({ type: 'result', id: msg.id, error: String(e && e.message || e) });
  }
}

kuromoji.builder({ dicPath: 'https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/dict/' }).build((err, t) => {
  if (err) { postMessage({ type: 'error', message: String(err) }); return; }
  tokenizer = t;
  postMessage({ type: 'ready' });
  queue.splice(0).forEach(run);
});

onmessage = (e) => { if (tokenizer) run(e.data); else queue.push(e.data); };
