// Vercel Serverless Function
// 路徑：/api/sake/[id]
// 爬蟲來 → 回傳帶 OG tag 的 HTML（酒名 + 圖片）
// 真人來 → 302 轉向 /share-sake/{id}（React SPA）

export const config = { maxDuration: 10 };

function isCrawler(ua) {
  if (!ua) return false;
  const u = ua.toLowerCase();
  return (
    u.includes("facebookexternalhit") ||
    u.includes("facebookcatalog") ||
    u.includes("twitterbot") ||
    u.includes("linkedinbot") ||
    u.includes("whatsapp") ||
    u.includes("telegrambot") ||
    u.includes("line/") ||
    u.includes("linecrawler") ||
    u.includes("line-") ||
    u.includes("slackbot") ||
    u.includes("discordbot") ||
    u.includes("applebot") ||
    u.includes("googlebot") ||
    u.includes("bingbot")
  );
}

function e(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export default async function handler(req, res) {
  const { id } = req.query;
  if (!id) return res.status(400).send("Missing id");

  const host   = req.headers.host || "sake-cellar.vercel.app";
  const origin = `https://${host}`;
  const spaUrl = `${origin}/share-sake/${id}`;
  const ua     = req.headers["user-agent"] || "";

  // 真人 → 直接轉到 React SPA 頁面
  if (!isCrawler(ua)) {
    res.setHeader("Location", spaUrl);
    res.setHeader("Cache-Control", "no-store");
    return res.status(302).end();
  }

  // 爬蟲 → 查 Supabase 取得酒的資料
  // 注意：Vercel function 讀的是 process.env，不是 import.meta.env
  // 需要在 Vercel Dashboard 設定 SUPABASE_URL 和 SUPABASE_ANON_KEY
  const sbUrl = process.env.SUPABASE_URL || "";
  const sbKey = process.env.SUPABASE_ANON_KEY || "";

  let title    = "酒蔵録 SAKE CELLAR";
  let desc     = "日本酒品飲記錄";
  let imgUrl   = `${origin}/icon.png`;

  if (sbUrl && sbKey) {
    try {
      const apiRes = await fetch(
        `${sbUrl}/rest/v1/sakes?id=eq.${encodeURIComponent(id)}&select=name,info,image_url&limit=1`,
        {
          headers: {
            "apikey": sbKey,
            "Authorization": `Bearer ${sbKey}`,
            "Content-Type": "application/json"
          }
        }
      );
      const rows = await apiRes.json();
      if (Array.isArray(rows) && rows[0]) {
        const row  = rows[0];
        let info   = {};
        try {
          info = typeof row.info === "string"
            ? JSON.parse(row.info)
            : (row.info || {});
        } catch {}
        const name    = info.name    || row.name    || "";
        const brewery = info.brewery || "";
        const cat     = info.category || "日本酒";
        if (name)    title  = brewery ? `${name} · ${brewery}` : name;
        if (cat)     desc   = `${cat} · 酒蔵録 SAKE CELLAR`;
        if (row.image_url) imgUrl = row.image_url;
      }
    } catch (err) {
      // Supabase 查不到，用預設值
    }
  }

  const html = `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<title>${e(title)}</title>
<meta name="description" content="${e(desc)}">
<meta property="og:type" content="article">
<meta property="og:url" content="${e(spaUrl)}">
<meta property="og:title" content="${e(title)}">
<meta property="og:description" content="${e(desc)}">
<meta property="og:image" content="${e(imgUrl)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:site_name" content="酒蔵録 SAKE CELLAR">
<meta property="og:locale" content="zh_TW">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${e(title)}">
<meta name="twitter:description" content="${e(desc)}">
<meta name="twitter:image" content="${e(imgUrl)}">
<meta http-equiv="refresh" content="0;url=${e(spaUrl)}">
</head>
<body>
<script>window.location.replace("${e(spaUrl)}")</script>
<p><a href="${e(spaUrl)}">${e(title)}</a></p>
</body>
</html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=300, max-age=60");
  return res.status(200).send(html);
}
