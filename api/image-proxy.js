export default async function handler(req, res) {
  const { url } = req.query
  if (!url) return res.status(400).send('Missing url')

  try {
    const response = await fetch(decodeURIComponent(url), {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    })
    if (!response.ok) return res.status(404).send('Image not found')

    const contentType = response.headers.get('content-type') || 'image/jpeg'
    const buffer = await response.arrayBuffer()

    res.setHeader('Content-Type', contentType)
    res.setHeader('Cache-Control', 'public, max-age=86400')
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.send(Buffer.from(buffer))
  } catch (e) {
    res.status(500).send('Proxy error: ' + e.message)
  }
}
