// Vercel Serverless Function
// 路徑：/api/share-sake/[id]
// 用途：給爬蟲（LINE/FB/iMessage）回傳帶 OG tag 的 HTML
//       給真實用戶轉向 /share-sake/{id}（React SPA 處理）

export const config = { maxDuration: 10 };

// 判斷是否為社群媒體爬蟲
function isCrawler(ua = "") {
  const bots = [
    "facebookexternalhit", "twitterbot", "linkedinbot",
    "whatsapp", "telegrambot", "line-poker", "line",
    "slackbot", "discordbot", "applebot", "googlebot",
    "bingbot", "yahoo", "duckduckbot", "ia_archiver",
    "curl", "wget", "python-requests", "axios",
  ];
  const lower = ua.toLowerCase();
  return bots.some(b => lower.includes(b));
}

export default async function handler(req, res) {
  const { id } = req.query;
  const ua = req.headers["user-agent"] || "";

  // 非爬蟲 → 轉向 React SPA 頁面
  if (!isCrawler(ua)) {
    res.setHeader("Location", `/share-sake/${id}`);
    return res.status(302).end();
  }

  // 爬蟲 → 從 Supabase 查資料，回傳 OG HTML
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

  let name = "日本酒";
  let brewery = "";
  let imageUrl = "";
  let category = "日本酒";

  if (supabaseUrl && supabaseKey) {
    try {
      const r = await fetch(
        `${supabaseUrl}/rest/v1/sakes?id=eq.${encodeURIComponent(id)}&select=name,info,image_url&limit=1`,
        { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
      );
      const rows = await r.json();
      if (rows && rows[0]) {
        const row = rows[0];
        const info = typeof row.info === "string" ? JSON.parse(row.info) : row.info || {};
        name = info.name || row.name || "日本酒";
        brewery = info.brewery || "";
        imageUrl = row.image_url || "";
        category = info.category || "日本酒";
      }
    } catch (e) {
      // 查不到就用預設值
    }
  }

  const appUrl = `https://${req.headers.host || "sake-cellar.vercel.app"}`;
  const pageUrl = `${appUrl}/share-sake/${id}`;
  const title = brewery ? `${name}｜${brewery}` : name;
  const description = `${category} · 來自「酒蔵録 SAKE CELLAR」的品飲記錄`;
  const ogImage = imageUrl || `${appUrl}/icon.png`;

  const html = `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <meta name="description" content="${description}">

  <!-- Open Graph -->
  <meta property="og:type" content="website">
  <meta property="og:url" content="${pageUrl}">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:image" content="${ogImage}">
  <meta property="og:image:width" content="800">
  <meta property="og:image:height" content="800">
  <meta property="og:site_name" content="酒蔵録 SAKE CELLAR">
  <meta property="og:locale" content="zh_TW">

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${description}">
  <meta name="twitter:image" content="${ogImage}">

  <!-- LINE -->
  <meta property="og:image:secure_url" content="${ogImage}">

  <!-- 立刻轉向 React SPA -->
  <meta http-equiv="refresh" content="0;url=${pageUrl}">
</head>
<body>
  <p>載入中，請稍候… <a href="${pageUrl}">點此開啟</a></p>
  <script>window.location.replace("${pageUrl}");</script>
</body>
</html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600");
  return res.status(200).send(html);
}
