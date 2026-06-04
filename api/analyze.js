// Vercel Serverless Function — 安全呼叫 Claude API（API key 不外洩到前端）
// 部署後路徑：/api/analyze

export const config = { maxDuration: 30 };

const SAKE_PROMPT = `你是一位日本酒（清酒）與葡萄酒專家、唎酒師（きき酒師）。請仔細分析這張酒瓶/酒標照片。

判斷酒種，並依照以下規則回傳「純 JSON」（不要 markdown、不要說明文字）。無法辨識的欄位填 null。

【若為日本酒（清酒）】
{
  "category": "日本酒",
  "name": "銘柄全名（含サブ銘柄，如「獺祭 純米大吟醸 磨き二割三分」）",
  "name_kana": "假名讀音（如 だっさい）",
  "brewery": "蔵元/酒造名（如 旭酒造）",
  "region": "都道府縣（如 山口県）",
  "tokutei": "特定名稱（純米大吟醸酒/純米吟醸酒/純米酒/本醸造酒/吟醸酒/大吟醸酒/特別純米酒/特別本醸造酒/普通酒 其中之一，或 null）",
  "seimai": "精米歩合（數字%，如 23%）",
  "sake_meter": "日本酒度（如 +3 / -2，正數偏辛口、負數偏甘口）",
  "acidity": "酸度（如 1.4）",
  "rice": "使用酒米（如 山田錦）",
  "yeast": "使用酵母（如有，如 協会9号）",
  "alcohol": "酒精度（如 16%）",
  "sweetness": "甘辛判定（大辛口/辛口/やや辛口/普通/やや甘口/甘口/大甘口 其一）",
  "flavors": "風味描述（60字內，香氣/口感/餘韻）",
  "temps": ["建議溫度帶，從以下選1-3個：雪冷え(5℃)","花冷え(10℃)","涼冷え(15℃)","冷や/常温(20℃)","日向燗(30℃)","人肌燗(35℃)","ぬる燗(40℃)","上燗(45℃)","熱燗(50℃)"],
  "best_temp": "最推薦的單一溫度帶",
  "vessel": "建議酒器（如 ワイングラス/おちょこ/枡/平盃，香氣高者建議酒杯）",
  "food_pairing": "建議搭餐（3-5種，偏日式料理）",
  "tags": ["3-4個特色標籤，如 華やか/フルーティー/淡麗辛口/濃醇"]
}

【若為葡萄酒】
{
  "category": "ワイン",
  "name": "酒名全稱",
  "name_kana": null,
  "brewery": "酒莊（ワイナリー）",
  "region": "產區/國家",
  "tokutei": null,
  "wine_type": "紅酒/白酒/氣泡酒/粉紅酒/甜酒 其一",
  "vintage": "年份（如 2019，無年份 NV）",
  "grapes": "葡萄品種",
  "alcohol": "酒精度",
  "sweetness": "甜度（不甜/微甜/中甜/甜）",
  "flavors": "風味描述（60字內）",
  "temps": ["建議飲用溫度（如 12-14℃）"],
  "best_temp": "最佳溫度",
  "vessel": "建議杯型（波爾多杯/勃根地杯/笛型杯/白酒杯）",
  "food_pairing": "建議搭餐（3-5種）",
  "tags": ["3-4個特色標籤"]
}

【其他酒類（威士忌/燒酎/啤酒等）】比照葡萄酒格式，category 填實際酒種，wine_type 改填子分類。

只輸出 JSON。`;

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });

  try {
    const { image, mimeType = "image/jpeg" } = req.body;
    if (!image) return res.status(400).json({ error: "No image provided" });

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1200,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mimeType, data: image } },
            { type: "text", text: SAKE_PROMPT },
          ],
        }],
      }),
    });

    const data = await r.json();
    if (data.error) return res.status(500).json({ error: data.error.message });

    const text = data.content?.map(i => i.text || "").join("") || "{}";
    const clean = text.replace(/```json|```/g, "").trim();
    let info;
    try { info = JSON.parse(clean); }
    catch { return res.status(200).json({ info: null, raw: text }); }

    return res.status(200).json({ info });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
