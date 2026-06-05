// 呼叫後端 serverless function 進行 AI 辨識
// 回傳 { info, error, raw } 方便在畫面上顯示失敗原因
// 內建自動重試：連線失敗或被限流時，等待後再試（最多 3 次）

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export async function analyzeImage(base64, mimeType = "image/jpeg", nameHint = null, attempt = 0) {
  const MAX_RETRY = 3;
  try {
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: base64, mimeType, nameHint }),
    });

    // 被限流（429）或伺服器忙（5xx）→ 等待後重試
    if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRY) {
      await sleep(1500 * (attempt + 1)); // 1.5s, 3s, 4.5s 漸進等待
      return analyzeImage(base64, mimeType, nameHint, attempt + 1);
    }

    const data = await res.json();
    if (data.error) {
      // API 層級錯誤，若像是限流也重試
      if (/rate|limit|overload|429/i.test(data.error) && attempt < MAX_RETRY) {
        await sleep(1500 * (attempt + 1));
        return analyzeImage(base64, mimeType, nameHint, attempt + 1);
      }
      console.error("analyze error:", data.error);
      return { info: null, error: data.error };
    }
    if (!data.info) {
      return { info: null, error: "AI 回應無法解析", raw: data.raw };
    }
    return { info: data.info };
  } catch (e) {
    // 連線失敗（Load failed 等）→ 等待後重試
    if (attempt < MAX_RETRY) {
      await sleep(1500 * (attempt + 1));
      return analyzeImage(base64, mimeType, nameHint, attempt + 1);
    }
    console.error("analyze failed:", e);
    return { info: null, error: "連線失敗：" + e.message + "（已重試 " + MAX_RETRY + " 次）" };
  }
}

// ── 圖片處理 ──

// 壓縮大圖以加速上傳與辨識（長邊上限 1280px）
export function compressImage(file, maxSize = 1280, quality = 0.85) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxSize || height > maxSize) {
          if (width > height) { height = (height / width) * maxSize; width = maxSize; }
          else { width = (width / height) * maxSize; height = maxSize; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            const dataUrl = canvas.toDataURL("image/jpeg", quality);
            const base64 = dataUrl.split(",")[1];
            resolve({ blob, dataUrl, base64 });
          },
          "image/jpeg",
          quality
        );
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// 從圖片 URL（Supabase 公開網址或 data URL）取得 base64，供「修正再辨識」使用
export async function urlToBase64(url) {
  // data URL 直接取
  if (url.startsWith("data:")) {
    return url.split(",")[1];
  }
  // 一般網址 → 抓下來轉 base64
  const res = await fetch(url);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
