# N2 単語帳 — 日文 N2 單字學習平台

本機執行的單字學習平台：輸入單字 → 自動產生平假名、例句振り仮名並標記單字 → 串接外部辭典查看詳情 → 依單元複習與測驗。

## 啟動

```bash
npm install     # 第一次
npm start       # 開啟 http://localhost:3000
```

資料儲存在 `data/db.json`（每次儲存會另存一份 `db.json.bak`），也可在「單元」頁匯出 / 匯入 JSON。

## 功能

- **單元**：建立 / 重新命名 / 刪除單元，每個單元有自己的單字、複習與測驗成績。
- **單字**：輸入漢字或片假名 + 詞性 + 中文意思 + 例句與翻譯。
  - 平假名自動產生（kuromoji 分詞），可手動修改。
  - 例句自動加上振り仮名，並以**橘色**標記本單字（含活用變化：取り扱う → 取り扱っている、厳しい → 厳しかった、確認する → 確認しました）。
  - 例句下方顯示整句平假名；自動讀音有誤時可勾選「手動修正平假名」。
  - **接頭詞 / 接尾詞**：詞性選「接頭詞」或「接尾詞」後會出現「例詞」區，輸入 悪〜 → 例詞 悪影響 / 不好的影響，例詞自動加平假名並以橘色標出詞綴；詞綴本身的讀音會由例詞推導（悪影響 あくえいきょう − 影響 えいきょう = あく）。
  - 「批次匯入」可一次貼上多行：`單字 | 詞性 | 中文 | 例句 / 翻譯 ; 例句2 / 翻譯2 | 平假名(選填)`
  - 接頭詞 / 接尾詞批次匯入時第 4 欄改填例詞：`悪〜 | 接頭詞 | 不好的 | 悪影響 / 不好的影響 ; 悪条件 / 惡劣的條件`
  - 🔊 發音：預設 Google 翻譯語音（經伺服器代理並快取到 `data/tts/`），可切換為瀏覽器內建語音。
- **查看詳情**（串接外部資源）：
  - Jisho.org API：英文釋義、詞性、JLPT 等級、常用度
  - 日文 Wiktionary API：日日解釋、發音、重音
  - Tatoeba API：附中文翻譯的例句
  - 連結：Weblio、goo 辞書、コトバンク、MOJi 辞書、滬江小D、用例.jp、OJAD、Forvo、Google 翻譯
- **複習**：字卡翻面（可選正面顯示日文 / 中文 / 平假名）、隨機順序、只複習不熟的；列表模式點擊揭曉。快捷鍵：空白鍵翻面、1 不熟、2 記得。
- **測驗**：看日文選中文、看中文選日文、輸入平假名讀音、例句填空；結束後顯示錯題並可直接複習答錯的單字，成績會記錄在單元上。

## 專案結構

```
server.js        Express 伺服器：資料儲存、kuromoji 分詞、外部辭典 API 代理
public/index.html
public/style.css
public/app.js    前端（單元 / 單字 / 複習 / 測驗）
data/db.json     你的資料
```

## 部署到雲端（手機 / 其他電腦也能用）

程式支援兩個環境變數，設定後即自動切換：

| 變數 | 作用 |
|---|---|
| `APP_PASSWORD` | 設定後開啟網頁需輸入密碼（Basic Auth），避免陌生人動你的資料 |
| `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` | 設定後資料改存 Upstash Redis（雲端），否則存本機 `data/db.json` |

### 步驟（全部免費）
1. **GitHub**：建立一個 private repo，把這個資料夾 push 上去（`data/` 已在 .gitignore，不會上傳）。
2. **Upstash**（https://upstash.com）：註冊 → Create Database（Redis，選離你近的區域）→ 複製 `UPSTASH_REDIS_REST_URL` 與 `UPSTASH_REDIS_REST_TOKEN`。
3. **Render**（https://render.com）：註冊 → New → **Blueprint** → 連結你的 GitHub repo（會自動讀 `render.yaml`）→ 填入上面三個環境變數 → Deploy。
4. 幾分鐘後會得到 `https://n2-vocab-xxxx.onrender.com`，手機瀏覽器打開、輸入密碼即可（帳號隨便填）。
5. 把本機資料搬上去：本機「單元」頁 → 匯出 JSON → 到雲端網址 → 匯入 JSON。

免費方案閒置 15 分鐘會休眠，之後第一次打開約需 30–60 秒喚醒（分詞器載入），之後就正常。

## 部署到 GitHub Pages（純瀏覽器版，免伺服器）

`docs/` 資料夾是可直接放上 GitHub Pages 的靜態版本（`npm run build:pages` 產生）：
- 分詞 / 平假名：瀏覽器內載入 kuromoji（第一次約 17MB，之後快取）
- 資料：存在瀏覽器 localStorage；在「單元」頁貼上 GitHub Token（gist 權限）即可透過私密 Gist 跨裝置同步
- 辭典：Jotoba（英日、JLPT、例句）+ 日文 Wiktionary，皆支援跨網域
- 發音：瀏覽器內建語音（Google 語音需經伺服器代理，靜態版不穩定）

### 步驟
1. 把專案 push 到 GitHub（public 或 private 皆可，Pages 對 private repo 需 GitHub Pro；免費帳號請用 public repo）。
2. repo → **Settings → Pages → Build and deployment**：Source 選 *Deploy from a branch*，Branch 選 `main`、資料夾選 **`/docs`** → Save。
3. 約 1 分鐘後網址為 `https://<你的帳號>.github.io/<repo 名稱>/`。
4. 每台裝置打開網址 → 單元頁 → 貼上同一組 Token → 啟用同步。

改了 `public/` 之後記得重新執行 `npm run build:pages` 再 push。
