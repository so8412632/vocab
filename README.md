# 英文單字小助手（完整功能・免費版）

保留原本 Claude 版本的完整功能：中英互查、KK音標、文法提醒、收藏單字本、三種測驗模式（選擇題／拼字／克漏字）、只考紅黃燈、學習統計、批次加入、匯出/匯入。全部**不用付費**，純靜態網頁，沒有 build 流程。

## 資料來源（全部免費）

| 功能 | 免費服務 |
|---|---|
| 英文字典（音標、詞性、英文解釋、例句） | Free Dictionary API（免金鑰） |
| 中文翻譯 | MyMemory Translation API（免金鑰） |
| 中文查詢轉英文 | 也是用 MyMemory 翻譯，不需要另外的資料庫 |
| KK 音標、文法提醒 | Google Gemini API（**免費額度，需自行申請一把免費 key**） |

## ⚠️ 部署前，你唯一需要做的事

打開 **`config.js`**，把裡面的 `GEMINI_API_KEY` 換成你自己的金鑰：

1. 打開 https://aistudio.google.com/apikey
2. 用 Google 帳號登入
3. 點「Create API key」（不需要信用卡、不需要付款設定）
4. 複製那串以 `AIza` 開頭的金鑰
5. 貼到 `config.js` 裡引號中間，取代 `貼上你的Gemini API金鑰` 這幾個字

如果沒有設定這把金鑰，其他功能都正常，只有「KK音標」跟「文法提醒」那兩小塊會顯示「無法生成」，不影響查詢、收藏、測驗等主要功能。

### 這把金鑰安全嗎？

因為是純前端網站，這把金鑰會出現在瀏覽器看得到的原始碼裡，**技術上任何人都看得到**。這是用純靜態網站做到免費 AI 功能必然的取捨。最壞情況：

- 別人把你的免費額度用光 → 查詢會暫時失敗 → 重新申請一把新的免費 key 即可，**不會產生任何費用**
- 因為是免費額度，沒有信用卡綁定，也就沒有「被盜刷」的風險

**想降低被亂用的風險**，可以到 Google AI Studio 或 Google Cloud Console 幫這把 key 加上「HTTP referrer 限制」，只允許從你自己的網址（例如 `https://你的帳號.github.io/*`）發出的請求生效，其他來源一律被拒絕。

## 檔案結構（平面結構，方便手機上傳）

```
vocab-static-full/
├── index.html
├── style.css
├── config.js        ← 只有這個需要你自己編輯
├── app.js
├── manifest.json
├── sw.js
├── icon-192.png
├── icon-192-maskable.png
├── icon-512.png
├── icon-512-maskable.png
└── apple-touch-icon.png
```

## 功能對照

| 功能 | 說明 |
|---|---|
| 中英互查 | 輸入英文直接查；輸入中文會先翻譯成英文候選字再查字典 |
| 音標 | 顯示 IPA；有真人錄音可播放；一定會有裝置語音朗讀當保底 |
| KK 音標／文法提醒 | 由 Gemini 生成，非同步載入，稍後才會出現 |
| 詞性、解釋、例句、同義詞 | 來自 Free Dictionary API，並附上翻譯的中文解釋 |
| 收藏單字本 | 可搜尋、可依燈號篩選 |
| 三種測驗模式 | 選擇題（英↔中三選一）、拼字（看中文打英文）、克漏字（例句挖空） |
| 只考紅黃燈 | 測驗開始前可勾選，只出還不熟的字 |
| 學習統計 | 收藏數、Mastered Rate、測驗正確率、連續測驗天數、燈號分布 |
| 批次加入 | 一次貼多個單字（逗號/換行分隔，最多 30 個，可中英混合） |
| 匯出／匯入 | 匯出成 JSON 備份檔，之後可以匯入還原或搬到別的裝置 |

## 部署到 GitHub Pages

1. 建立新的 GitHub repository（Public）
2. **記得先編輯好 `config.js`**，填入你的 Gemini key
3. Add file → Upload files，把這 10 個檔案（`config.js` 也要選）一次上傳，Commit
4. Settings → Pages → Source 選 **Deploy from a branch** → Branch 選 **main** → 資料夾選 **/(root)** → Save
5. 等 1-2 分鐘，網址會是 `https://你的帳號.github.io/repo名稱/`
6. 用 Safari 打開 → 分享 →「加入主畫面」

## 之後想改東西

之後想請人（或自己）修改功能時，只要提供這個 repo 的網址，或直接貼上要修改的檔案內容即可，不用重新解釋整個專案。
