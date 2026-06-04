// Vercel Serverless Function — 安全呼叫 Claude API（API key 不外洩到前端）
// 部署後路徑：/api/analyze

export const config = { maxDuration: 30 };

const SAKE_PROMPT = `你是一位日本酒（清酒）與葡萄酒專家、品酒師。請仔細分析這張酒瓶/酒標照片。

判斷酒種，並依照以下規則回傳「純 JSON」（不要 markdown、不要說明文字）。無法辨識的欄位填 null。

【重要：語言規則】
除了「name（酒名）」要保留酒標上的原文（可中日對照，如「獺祭 純米大吟釀 磨二割三分」），其餘所有欄位的「值」一律用「繁體中文」描述，不要用日文。例如：
- 風味請寫「華麗果香、口感圓潤、尾韻俐落」，不要寫「華やか、フルーティー」
- 酒米寫「山田錦」可保留（這是品種專有名詞），但說明文字用中文
- 溫度帶用中文，如「冰鎮（5℃）」「常溫（20℃）」「溫熱（40℃）」
- 標籤用中文，如「華麗」「果香」「淡雅辛口」「濃醇」

【若為日本酒（清酒）】
{
  "category": "日本酒",
  "name": "酒名全名（中日對照，如「獺祭 純米大吟釀 磨二割三分」）",
  "name_kana": "假名讀音（如 だっさい，這欄保留日文假名）",
  "brewery": "酒造名（中文為主，如「旭酒造」）",
  "region": "產地（中文，如「日本 山口縣」）",
  "tokutei": "特定名稱（用中文：純米大吟釀/純米吟釀/純米酒/本釀造/吟釀/大吟釀/特別純米/特別本釀造/普通酒 其一，或 null）",
  "seimai": "精米步合（數字%，如 23%）",
  "sake_meter": "日本酒度（如 +3 / -2，正數偏辛口、負數偏甘口）",
  "acidity": "酸度（如 1.4）",
  "rice": "使用酒米（如 山田錦）",
  "yeast": "使用酵母（如有，如 協會9號）",
  "alcohol": "酒精濃度（如 16%）",
  "sweetness": "甘辛判定（用中文：大辛口/辛口/微辛口/普通/微甘口/甘口/大甘口 其一）",
  "flavors": "風味描述（繁體中文，60字內，描述香氣/口感/餘韻）",
  "temps": ["建議溫度帶，從以下選1-3個（用中文）：雪冷（5℃）","花冷（10℃）","涼冷（15℃）","常溫（20℃）","日向溫（30℃）","人肌溫（35℃）","微溫（40℃）","上溫（45℃）","熱燗（50℃）"],
  "best_temp": "最推薦的單一溫度帶（用上面同樣的中文寫法）",
  "vessel": "建議酒器（中文：葡萄酒杯/豬口杯/枡/平盃，香氣高者建議用酒杯）",
  "food_pairing": "建議搭餐（繁體中文，3-5種，偏日式料理）",
  "tags": ["3-4個特色標籤（繁體中文，如 華麗/果香/淡雅辛口/濃醇）"]
}

【若為葡萄酒】
{
  "category": "葡萄酒",
  "name": "酒名全稱（保留原文，可中外對照）",
  "name_kana": null,
  "brewery": "酒莊名（中文為主）",
  "region": "產區/國家（中文，如「法國 波爾多」）",
  "tokutei": null,
  "wine_type": "紅酒/白酒/氣泡酒/粉紅酒/甜酒 其一",
  "vintage": "年份（如 2019，無年份 NV）",
  "grapes": "葡萄品種（中文，如 卡本內蘇維濃）",
  "alcohol": "酒精濃度（如 13.5%）",
  "sweetness": "甜度（中文：不甜/微甜/中甜/甜）",
  "flavors": "風味描述（繁體中文，60字內）",
  "temps": ["建議飲用溫度（如 12-14℃）"],
  "best_temp": "最佳飲用溫度",
  "vessel": "建議杯型（中文：波爾多杯/勃根地杯/笛型杯/白酒杯）",
  "food_pairing": "建議搭餐（繁體中文，3-5種）",
  "tags": ["3-4個特色標籤（繁體中文）"]
}

【其他酒類（威士忌/燒酎/啤酒等）】比照葡萄酒格式，category 填實際酒種（中文），wine_type 改填子分類。

再次強調：除了 name 和 name_kana，其餘欄位值一律繁體中文，不要出現日文敘述。只輸出 JSON。`;

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
