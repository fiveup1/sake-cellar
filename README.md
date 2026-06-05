# 🍶 酒蔵録 SAKE CELLAR — 部署完全指南 

一個專為**日本酒收藏**設計的 AI 辨識管理 App，可安裝到 iPhone 主畫面，像原生 App 一樣使用。

---

## ✨ 功能總覽

| 功能 | 說明 |
|------|------|
| 📥 **批次匯入** | 從相簿一次選擇大量酒瓶照片（3000-5000 張），AI 逐張辨識 |
| 🤖 **AI 辨識** | 自動讀取酒標 → 日本酒擷取「特定名稱・精米歩合・日本酒度・酸度・酒米」；葡萄酒擷取「品種・年份・產區」 |
| 🔍 **快速搜尋** | 用酒名/酒造/產地/酒米/銘柄即時搜尋，看到新酒馬上查「我喝過沒」 |
| 📊 **味わいMAP** | 日本酒度 × 酸度視覺化（甘辛・濃淡四象限） |
| 🌡️ **溫度帶建議** | 雪冷え→熱燗 完整溫度尺，標示最佳適飲溫度 |
| 🥂 **酒器・搭餐** | AI 建議適合杯型與搭配料理 |
| 🖼️ **照片拼接** | 多選照片產出正方形大圖，可選「整齊式」或「散亂式（拍立得風）」 |

---

## 🚀 部署步驟（約 30 分鐘，零程式基礎可完成）

整個流程分三大塊：
1. **取得 Claude API Key**（AI 辨識的大腦）
2. **設定 Supabase 雲端資料庫**（讓照片永久保存、跨裝置同步）— *可選，但強烈建議*
3. **部署到 Vercel**（產生你的專屬網址）

---

### 第 1 步：取得 Claude API Key 🔑

1. 前往 https://console.anthropic.com 註冊/登入
2. 左側選單 → **API Keys** → **Create Key**
3. 複製產生的金鑰（格式像 `sk-ant-api03-xxxxx`），先貼到記事本
4. 到 **Billing** 儲值少量金額（辨識 5000 張照片約 US$5-15，非常便宜）

> 💡 這把金鑰只會放在後端伺服器，不會外洩給使用者。

---

### 第 2 步：設定 Supabase 雲端資料庫 ☁️（建議）

> 不做這步也能用（會改用手機瀏覽器本機儲存），但**換手機或清快取資料會消失**，且無法存大量照片。日本酒收藏建議一定要設定。

1. 前往 https://supabase.com 用 GitHub 帳號登入
2. **New Project** → 填專案名稱（如 `sake-cellar`）、設一組資料庫密碼、地區選 **Tokyo (ap-northeast-1)**
3. 等專案建立完成（約 2 分鐘）
4. 左側 → **SQL Editor** → **New query** → 把 `supabase-setup.sql` 的內容全部貼上 → 按 **Run**
   - 這會自動建立資料表 + 圖片儲存桶 + 權限
5. 左側 → **Project Settings** → **API**，記下兩個值：
   - **Project URL**（像 `https://abcxyz.supabase.co`）
   - **anon public** 金鑰（很長一串 `eyJ...`）

---

### 第 3 步：部署到 Vercel 🌐

#### 3-1. 先把專案放上 GitHub

1. 前往 https://github.com 登入 → **New repository** → 命名 `sake-cellar` → **Create**
2. 把這整個 `wine-vault` 資料夾上傳：
   - **最簡單做法**：在 GitHub repo 頁面點 **uploading an existing file**，把資料夾內所有檔案拖進去
   - 或用 Git 指令（若你熟悉）：
     ```bash
     cd wine-vault
     git init
     git add .
     git commit -m "酒蔵録 初版"
     git remote add origin https://github.com/你的帳號/sake-cellar.git
     git push -u origin main
     ```

#### 3-2. 連接 Vercel

1. 前往 https://vercel.com 用 GitHub 帳號登入
2. **Add New** → **Project** → 選剛剛的 `sake-cellar` repo → **Import**
3. 在 **Environment Variables** 區塊加入以下變數（這步最關鍵）：

   | Name | Value |
   |------|-------|
   | `ANTHROPIC_API_KEY` | 第 1 步的 `sk-ant-...` 金鑰 |
   | `VITE_SUPABASE_URL` | 第 2 步的 Project URL |
   | `VITE_SUPABASE_ANON_KEY` | 第 2 步的 anon public 金鑰 |

4. 按 **Deploy**，等 1-2 分鐘
5. 完成！會得到一個網址，像 `https://sake-cellar.vercel.app`

---

### 第 4 步：安裝到 iPhone 主畫面 📱

1. 用 **Safari** 開啟你的 Vercel 網址
2. 點底部「分享」按鈕（方框+箭頭）
3. 下滑選 **加入主畫面**
4. 完成！主畫面會出現「酒蔵録」金色圖示，點開就是全螢幕 App，跟 App Store 下載的幾乎沒差別

---

## 🔧 修改與更新

改了任何程式碼後，只要 push 到 GitHub，Vercel 會**自動重新部署**，幾分鐘後網址內容就更新了，手機上的 App 也跟著更新。

### 本機測試（選用）
```bash
cd wine-vault
npm install
# 建立 .env 檔，填入三個環境變數（參考 .env.example）
npm run dev
# 開 http://localhost:3000
```
> 注意：本機測試時 `/api/analyze` 需要 Vercel 環境才能跑。可裝 `npm i -g vercel` 後用 `vercel dev` 在本機模擬。

---

## 🎨 想客製化？

| 想改什麼 | 改哪個檔案 |
|----------|-----------|
| AI 辨識的欄位、提示詞 | `api/analyze.js` 裡的 `SAKE_PROMPT` |
| 整體配色（金/深色） | `src/index.css` 最上方的 `:root` 變數 |
| 拼接圖尺寸、樣式 | `src/lib/collage.js` |
| 味わいMAP 計算邏輯 | `src/components/TasteMap.jsx` |
| 溫度帶定義 | `src/components/TempScale.jsx` |

---

## ❓ 常見問題

**Q：辨識不準怎麼辦？**
A：酒標照片越清晰正面，辨識越好。可在 `api/analyze.js` 微調提示詞。AI 也支援罕見地酒，但極冷門酒款可能資訊較少。

**Q：費用大概多少？**
A：Vercel 個人用免費；Supabase 免費額度（500MB 資料庫 + 1GB 圖片）夠存上千張壓縮後照片；Claude API 按用量計費，辨識一張約 US$0.001-0.003。

**Q：可以多人一起用嗎？**
A：目前設計為個人收藏（單一資料庫無帳號）。若要多人各自獨立，需加上登入功能，可再擴充。

**Q：照片會壓縮嗎？**
A：匯入時自動壓到長邊 1280px（加速辨識、省空間），原始照片仍在你手機相簿，App 不會刪。

---

## 📁 專案結構

```
wine-vault/
├── api/
│   └── analyze.js          # 後端 AI 辨識（保護 API key）
├── src/
│   ├── App.jsx             # 主程式（酒窖/匯入/拼接/詳情）
│   ├── main.jsx            # 進入點
│   ├── index.css           # 全域樣式
│   ├── lib/
│   │   ├── db.js           # 資料存取（Supabase / 本機自動切換）
│   │   ├── analyze.js      # 呼叫辨識 API + 圖片壓縮
│   │   └── collage.js      # 照片拼接產生器
│   └── components/
│       ├── TasteMap.jsx    # 日本酒味わいMAP
│       └── TempScale.jsx   # 溫度帶尺
├── public/
│   ├── icon.png            # App 圖示
│   └── manifest.json       # PWA 設定
├── supabase-setup.sql      # 資料庫一鍵設定
├── .env.example            # 環境變數範本
├── vercel.json             # Vercel 設定
└── package.json
```

---

做完任何一步卡住，把錯誤訊息貼給我，我幫你解。乾杯！🍶
