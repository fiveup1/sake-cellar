// 呼叫後端 serverless function 進行 AI 辨識
// 回傳 { info, error, raw } 方便在畫面上顯示失敗原因

export async function analyzeImage(base64, mimeType = "image/jpeg") {
  try {
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: base64, mimeType }),
    });
    const data = await res.json();
    if (data.error) {
      console.error("analyze error:", data.error);
      return { info: null, error: data.error };
    }
    if (!data.info) {
      // 後端有回應但解析不出 JSON，附上 raw 方便診斷
      return { info: null, error: "AI 回應無法解析", raw: data.raw };
    }
    return { info: data.info };
  } catch (e) {
    console.error("analyze failed:", e);
    return { info: null, error: "連線失敗：" + e.message };
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
