export const config = { maxDuration: 10 };

function isCrawler(ua) {
  if (!ua) return false;
  const u = ua.toLowerCase();
  return u.includes("facebookexternalhit") || u.includes("fb_iab") ||
    u.includes("twitterbot") || u.includes("linkedinbot") ||
    u.includes("whatsapp") || u.includes("telegrambot") ||
    u.includes("line/") || u.includes("linecrawler") ||
    u.includes("slackbot") || u.includes("discordbot") ||
    u.includes("applebot") || u.includes("googlebot") ||
    u.includes("bingbot") || u.includes("yandexbot") ||
    u.includes("duckduckbot");
}

function esc(s) {
  return String(s || "")
    .replace(/&/g,"&amp;")
    .replace(/"/g,"&quot;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;");
}

export default async function handler(req, res) {
  const { id } = req.query;
  if (!id) return res.status(400).send("Missing id");

  const host    = req.headers.host || "sake-cellar.vercel.app";
  const appUrl  = `https://${host}`;
  const spaUrl  = `${appUrl}/share-sake/${id}`;
  const ua      = req.headers["user-agent"] || "";

  // ── 非爬蟲 → 直接轉向 SPA ──
  if (!isCrawler(ua)) {
    res.setHeader("Location", spaUrl);
    res.setHeader("Cache-Control", "no-store");
    return res.status(302).end();
  }

  // ── 爬蟲 → 查 Supabase，回 OG HTML ──
  // Vercel 後端只能讀 process.env（不含 VITE_ 前綴）
  // 需要在 Vercel Dashboard → Settings → Environment Variables
  // 加上 SUPABASE_URL 和 SUPABASE_ANON_KEY（複製 VITE_ 的值即可）
  const sbUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  const sbKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";

  let name = "酒蔵録 SAKE CELLAR";
  let brewery = "";
  let imageUrl = `${appUrl}/icon.png`;
  let category = "日本酒";

  if (sbUrl && sbKey) {
    try {
      const r = await fetch(
        `${sbUrl}/rest/v1/sakes?id=eq.${encodeURIComponent(id)}&select=name,info,image_url&limit=1`,
        { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } }
      );
      const rows = await r.json();
      if (Array.isArray(rows) && rows[0]) {
        const row = rows[0];
        let info = {};
        try { info = typeof row.info === "string" ? JSON.parse(row.info) : (row.info || {}); } catch {}
        name     = info.name     || row.name || name;
        brewery  = info.brewery  || "";
        category = info.category || "日本酒";
        if (row.image_url) imageUrl = row.image_url;
      }
    } catch (e) {
      console.error("Supabase fetch error:", e.message);
    }
  }

  const title = brewery ? `${name} · ${brewery}` : name;
  const desc  = `${category} · 酒蔵録 SAKE CELLAR 品飲記錄`;

  const html = `<!DOCTYPE html>
<html lang="zh-TW"><head>
<meta charset="UTF-8">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="article">
<meta property="og:url" content="${esc(spaUrl)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(imageUrl)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:site_name" content="酒蔵録 SAKE CELLAR">
<meta property="og:locale" content="zh_TW">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(imageUrl)}">
<meta http-equiv="refresh" content="0;url=${esc(spaUrl)}">
</head><body>
<script>window.location.replace("${esc(spaUrl)}");</script>
<p><a href="${esc(spaUrl)}">${esc(title)}</a></p>
</body></html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=300, max-age=60");
  return res.status(200).send(html);
}
