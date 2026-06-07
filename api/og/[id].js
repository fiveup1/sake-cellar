// Vercel Serverless Function - OG tag handler
// 路徑：/api/og/[id]
// 爬蟲來 → 回傳帶 OG meta 的 HTML（含酒的圖片和名稱）
// 真人來 → 302 轉向到 /share-sake/{id}

export const config = { maxDuration: 10 };

function isCrawler(ua = "") {
  const lower = ua.toLowerCase();
  return [
    "facebookexternalhit","facebookcatalog","fb_iab",
    "twitterbot","linkedinbot",
    "whatsapp","telegrambot",
    "line/","line-","linetv","linecrawler",
    "slackbot","discordbot","applebot",
    "googlebot","bingbot","yandex","duckduckbot",
  ].some(b => lower.includes(b));
}

export default async function handler(req, res) {
  const { id } = req.query;
  if (!id) return res.status(400).send("Missing id");

  const ua = req.headers["user-agent"] || "";
  const host = req.headers.host || "sake-cellar.vercel.app";
  const appUrl = `https://${host}`;
  const spaUrl  = `${appUrl}/share-sake/${id}`;

  // 非爬蟲 → 直接跳到 React SPA
  if (!isCrawler(ua)) {
    res.setHeader("Location", spaUrl);
    return res.status(302).end();
  }

  // 爬蟲 → 查 Supabase 拿酒的資料
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";

  let name = "酒蔵録";
  let brewery = "";
  let imageUrl = `${appUrl}/icon.png`;
  let category = "日本酒";

  if (supabaseUrl && supabaseKey) {
    try {
      const r = await fetch(
        `${supabaseUrl}/rest/v1/sakes?id=eq.${encodeURIComponent(id)}&select=name,info,image_url&limit=1`,
        { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
      );
      const rows = await r.json();
      if (Array.isArray(rows) && rows[0]) {
        const row = rows[0];
        const info = typeof row.info === "string" ? JSON.parse(row.info || "{}") : (row.info || {});
        name     = info.name     || row.name || "日本酒";
        brewery  = info.brewery  || "";
        category = info.category || "日本酒";
        if (row.image_url) imageUrl = row.image_url;
      }
    } catch {}
  }

  const title = brewery ? `${name}｜${brewery}` : name;
  const desc  = `${category} · 酒蔵録 SAKE CELLAR`;

  const html = `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${esc(spaUrl)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(imageUrl)}">
<meta property="og:image:width" content="800">
<meta property="og:image:height" content="800">
<meta property="og:site_name" content="酒蔵録 SAKE CELLAR">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(imageUrl)}">
<meta http-equiv="refresh" content="0;url=${esc(spaUrl)}">
</head>
<body><script>location.replace("${esc(spaUrl)}")</script></body>
</html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=300, max-age=60");
  return res.status(200).send(html);
}

function esc(s) {
  return String(s).replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
