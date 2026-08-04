// 照片拼接產生器 — 正方形輸出，整齊式 / 散亂式

const CANVAS_SIZE = 1080; // IG-friendly square
const BG = "#0e0a06";
const FRAME = "#c9922a";

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// 計算最接近正方形的網格
function bestGrid(n) {
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  return { cols, rows };
}

// 繪製圖片到指定矩形（object-fit: cover）
function drawCover(ctx, img, x, y, w, h) {
  const ir = img.width / img.height;
  const r = w / h;
  let sw, sh, sx, sy;
  if (ir > r) {
    sh = img.height; sw = sh * r; sx = (img.width - sw) / 2; sy = 0;
  } else {
    sw = img.width; sh = sw / r; sx = 0; sy = (img.height - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

// ── 整齊式：對稱網格 ──────────────────────────────────────────────
export async function buildTidyCollage(imageUrls, opts = {}) {
  const pad = opts.pad ?? 28;
  const gap = opts.gap ?? 14;
  const urls = imageUrls.slice(0, 50);
  const { cols, rows } = bestGrid(urls.length);

  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;
  const ctx = canvas.getContext("2d");

  // 背景 + 細微紋理
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  drawGrain(ctx);

  const innerW = CANVAS_SIZE - pad * 2;
  const innerH = CANVAS_SIZE - pad * 2;
  const cellW = (innerW - gap * (cols - 1)) / cols;
  const cellH = (innerH - gap * (rows - 1)) / rows;

  const imgs = await Promise.all(urls.map(loadImage).map(p => p.catch(() => null)));

  imgs.forEach((img, i) => {
    if (!img) return;
    const c = i % cols;
    const r = Math.floor(i / cols);
    const x = pad + c * (cellW + gap);
    const y = pad + r * (cellH + gap);

    ctx.save();
    roundRect(ctx, x, y, cellW, cellH, 8);
    ctx.clip();
    drawCover(ctx, img, x, y, cellW, cellH);
    ctx.restore();

    // 細金框
    ctx.strokeStyle = "rgba(201,146,42,0.35)";
    ctx.lineWidth = 1.5;
    roundRect(ctx, x, y, cellW, cellH, 8);
    ctx.stroke();
  });

  drawWatermark(ctx);
  return canvas.toDataURL("image/jpeg", 0.92);
}

// ── 散亂式：隨機旋轉、重疊、拍立得風 ──────────────────────────────
export async function buildScatteredCollage(imageUrls, opts = {}) {
  const urls = imageUrls.slice(0, 50);
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  drawGrain(ctx);

  const imgs = await Promise.all(urls.map(loadImage).map(p => p.catch(() => null)));
  const n = imgs.length;

  // 依數量決定照片基準大小
  const baseSize = n <= 4 ? 380 : n <= 9 ? 300 : n <= 14 ? 240 : 200;

  // 用種子讓排列稍微均勻分散（網格抖動）
  const gridN = Math.ceil(Math.sqrt(n));
  const cellSize = CANVAS_SIZE / gridN;

  // 隨機但可重現
  let seed = opts.seed ?? Math.floor(Math.random() * 99999);
  const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };

  const placements = imgs.map((img, i) => {
    const gx = i % gridN;
    const gy = Math.floor(i / gridN);
    const jitterX = (rand() - 0.5) * cellSize * 0.7;
    const jitterY = (rand() - 0.5) * cellSize * 0.7;
    const cx = cellSize * (gx + 0.5) + jitterX;
    const cy = cellSize * (gy + 0.5) + jitterY;
    const rot = (rand() - 0.5) * 0.42; // ±24°
    const scale = 0.82 + rand() * 0.36;
    return { img, cx, cy, rot, size: baseSize * scale, z: rand() };
  }).sort((a, b) => a.z - b.z); // z 排序模擬堆疊

  placements.forEach(({ img, cx, cy, rot, size }) => {
    if (!img) return;
    const border = size * 0.045;
    const bottomPad = size * 0.14; // 拍立得下緣
    const photoW = size;
    const photoH = size;
    const frameW = photoW + border * 2;
    const frameH = photoH + border * 2 + bottomPad;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);

    // 陰影
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = 24;
    ctx.shadowOffsetX = 4;
    ctx.shadowOffsetY = 8;

    // 拍立得白框
    ctx.fillStyle = "#f5f0e6";
    roundRect(ctx, -frameW / 2, -frameH / 2, frameW, frameH, 4);
    ctx.fill();

    ctx.shadowColor = "transparent";

    // 照片
    ctx.save();
    roundRect(ctx, -photoW / 2, -frameH / 2 + border, photoW, photoH, 2);
    ctx.clip();
    drawCover(ctx, img, -photoW / 2, -frameH / 2 + border, photoW, photoH);
    ctx.restore();

    ctx.restore();
  });

  drawWatermark(ctx);
  return canvas.toDataURL("image/jpeg", 0.92);
}

// ── 輔助繪圖 ──
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawGrain(ctx) {
  // 細微暈影
  const g = ctx.createRadialGradient(CANVAS_SIZE / 2, CANVAS_SIZE / 2, CANVAS_SIZE * 0.3, CANVAS_SIZE / 2, CANVAS_SIZE / 2, CANVAS_SIZE * 0.75);
  g.addColorStop(0, "rgba(40,28,12,0.0)");
  g.addColorStop(1, "rgba(0,0,0,0.45)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
}

function drawWatermark(ctx) {
  ctx.save();
  ctx.font = "600 26px 'Shippori Mincho', serif";
  ctx.fillStyle = "rgba(201,146,42,0.85)";
  ctx.textAlign = "center";
  ctx.fillText("酒蔵録", CANVAS_SIZE / 2, CANVAS_SIZE - 28);
  ctx.font = "400 11px sans-serif";
  ctx.fillStyle = "rgba(201,146,42,0.4)";
  ctx.fillText("SAKE CELLAR", CANVAS_SIZE / 2, CANVAS_SIZE - 14);
  ctx.restore();
}

// ── 儲存 / 分享 ──────────────────────────────────────────────
export function isIOS() {
  const ua = navigator.userAgent || "";
  return /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function dataUrlToBlob(dataUrl) {
  const comma = dataUrl.indexOf(",");
  const head = dataUrl.slice(0, comma);
  const body = dataUrl.slice(comma + 1);
  const mime = (head.match(/:(.*?);/) || [, "image/jpeg"])[1];
  const bin = atob(body);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Blob([u8], { type: mime });
}

/**
 * 儲存拼接圖。回傳 { status, url? }
 *   shared     → 已叫出系統分享面板（iOS 可直接存到「照片」）
 *   cancelled  → 使用者取消分享
 *   downloaded → 已觸發瀏覽器下載
 *   longpress  → 無法自動下載，請 UI 顯示大圖讓使用者長按儲存（附 url）
 *   error      → 失敗
 *
 * 注意：navigator.share 必須在使用者手勢的同一個 tick 呼叫，
 * 所以這個函式在 share 之前不做任何 await。
 */
export async function saveCollage(dataUrl, filename = "sake-collage.jpg") {
  if (!dataUrl) return { status: "error" };

  let blob;
  try {
    blob = dataUrlToBlob(dataUrl);
  } catch (e) {
    console.error("[collage] dataUrl 轉檔失敗", e);
    return { status: "error" };
  }

  // 1) 系統分享（iOS / Android PWA 的正解）
  try {
    const file = new File([blob], filename, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: "酒蔵録 拼接圖" });
      return { status: "shared" };
    }
  } catch (e) {
    if (e && e.name === "AbortError") return { status: "cancelled" };
    console.warn("[collage] 分享失敗，改用下載", e);
  }

  // 2) 桌機 / Android Chrome：blob URL + <a download>
  //    （iOS 不支援 download 屬性，直接跳過）
  const canDownload = "download" in document.createElement("a") && !isIOS();
  if (canDownload) {
    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.rel = "noopener";
      a.style.display = "none";
      document.body.appendChild(a); // Firefox 需要真的掛進 DOM
      a.click();
      setTimeout(() => {
        a.remove();
        URL.revokeObjectURL(url);
      }, 15000);
      return { status: "downloaded" };
    } catch (e) {
      console.error("[collage] 下載失敗", e);
    }
  }

  // 3) 最後手段：交給 UI 顯示大圖，使用者長按儲存
  return { status: "longpress", url: dataUrl };
}

// 舊名稱保留（同步呼叫也能運作）
export function downloadDataUrl(dataUrl, filename = "sake-collage.jpg") {
  return saveCollage(dataUrl, filename);
}
