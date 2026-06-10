export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { name } = req.body
  if (!name) return res.status(400).json({ error: '請提供魚種名稱' })

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

  // ── Step 1: 查中文維基百科 ────────────────────────────────
  let wikiSummary = ''
  let wikiTitle   = ''
  let wikiUrl     = ''

  try {
    const searchRes = await fetch(
      `https://zh.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(name + ' 魚')}&srlimit=3&format=json&origin=*`
    )
    const searchData = await searchRes.json()
    const firstResult = searchData?.query?.search?.[0]
    if (firstResult) {
      wikiTitle = firstResult.title
      const summaryRes = await fetch(
        `https://zh.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wikiTitle)}`
      )
      const summaryData = await summaryRes.json()
      if (summaryData.extract) {
        wikiSummary = summaryData.extract.slice(0, 800)
        wikiUrl     = summaryData.content_urls?.desktop?.page || ''
      }
    }
  } catch (_) {}

  // ── Step 2: AI 整理資料 ───────────────────────────────────
  const wikiContext = wikiSummary
    ? `以下是維基百科關於「${wikiTitle}」的資料，請以此為準：\n${wikiSummary}\n\n`
    : `維基百科找不到相關資料，請用你自身的知識回答。\n\n`

  const prompt = `你是台灣海鮮專家。使用者輸入的魚名是：「${name}」
維基百科搜尋結果條目：「${wikiTitle || '無'}」

${wikiContext}請根據以上資料，整理出這種魚的完整資訊，只回傳 JSON，不要任何說明文字，不要 markdown：
{
  "matched_name": "最常見的中文名稱（參考維基條目標題）",
  "scientific_name": "正式中文學名",
  "common_names": "台灣常見別名，逗號分隔，必須包含使用者輸入的「${name}」",
  "flavor": "味道描述（2-3句，說明甜度鮮味腥味）",
  "texture": "肉質描述（1-2句，說明細緻度刺多不多）",
  "market_price": 數字（台幣每台斤均價，不確定填null）,
  "cooking_methods": "適合料理方式3-5種，逗號分隔",
  "habitat_depth": 數字（主要棲息深度公尺，不確定填null）,
  "description": "季節性產地特色挑選訣竅等（2-4句）",
  "latin_name": "拉丁學名",
  "category": "只能填：魚、蝦、蟹、貝、花枝、章魚、其他"
}`

  let parsed = {}
  let latin_name = ''
  try {
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5-20251101',
        max_tokens: 1200,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    const aiData = await aiRes.json()
    if (aiData.error) throw new Error(aiData.error.message)
    const text = (aiData.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n')
    const jsonMatch = text.replace(/```json|```/g, '').match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('AI 未回傳有效資料，請重試')
    const result = JSON.parse(jsonMatch[0])
    latin_name = result.latin_name || ''
    const { latin_name: _ln, ...rest } = result
    parsed = rest
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }

  // ── Step 3: 找封面圖 iNaturalist → Wikipedia → GBIF ──────
  let suggested_image = null

  if (latin_name) {
    // iNaturalist
    try {
      const inatRes = await fetch(
        `https://api.inaturalist.org/v1/taxa?q=${encodeURIComponent(latin_name)}&rank=species&per_page=1`
      )
      const inatData = await inatRes.json()
      const photo = inatData.results?.[0]?.default_photo?.medium_url
      if (photo) suggested_image = photo
    } catch (_) {}

    // Wikipedia thumbnail
    if (!suggested_image) {
      try {
        const wikiTitle2 = latin_name.replace(/ /g, '_')
        const wRes = await fetch(
          `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wikiTitle2)}`
        )
        const wData = await wRes.json()
        if (wData.thumbnail?.source) {
          suggested_image = wData.thumbnail.source.replace(/\/\d+px-/, '/400px-')
        }
      } catch (_) {}
    }

    // GBIF
    if (!suggested_image) {
      try {
        const gbifRes = await fetch(
          `https://api.gbif.org/v1/species?name=${encodeURIComponent(latin_name)}&limit=1`
        )
        const gbifData = await gbifRes.json()
        const key = gbifData.results?.[0]?.key
        if (key) {
          const mediaRes = await fetch(
            `https://api.gbif.org/v1/occurrence/search?taxonKey=${key}&mediaType=StillImage&limit=1`
          )
          const mediaData = await mediaRes.json()
          const img = mediaData.results?.[0]?.media?.[0]?.identifier
          if (img) suggested_image = img
        }
      } catch (_) {}
    }
  }

  return res.status(200).json({
    ...parsed,
    latin_name,
    suggested_image,
    wiki_title: wikiTitle || null,
    wiki_url:   wikiUrl   || null,
  })
}
