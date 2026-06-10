import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { inferCategory } from '../lib/categoryRules'

const CATEGORIES = ['魚', '蝦', '蟹', '貝', '花枝', '章魚', '其他']
const FIELD_LABELS = {
  scientific_name: '中文學名',
  common_names:    '常見別名',
  flavor:          '味道描述',
  texture:         '肉質',
  market_price:    '市場價格（元/斤）',
  cooking_methods: '料理方式',
  habitat_depth:   '棲息深度（公尺）',
  description:     '備註說明',
}
const S = {
  label: { display: 'block', fontSize: 11, color: 'var(--text-muted)', marginBottom: 5, fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', textTransform: 'uppercase' },
  input: { width: '100%', padding: '10px 13px', background: 'rgba(28,40,64,0.7)', border: '1px solid rgba(201,169,110,0.12)', borderRadius: 10, fontSize: 14, color: 'var(--text-primary)', outline: 'none', transition: 'border-color 0.2s' },
}
const focusIn  = e => e.target.style.borderColor = 'var(--border-active)'
const focusOut = e => e.target.style.borderColor = 'var(--border-subtle)'

/* ── PreviewOverlay ─────────────────────────────────────── */
/* ── PreviewOverlay ─────────────────────────────────────── */
/* ── PreviewOverlay ─────────────────────────────────────── */
function PreviewOverlay({ name, fields, category, photos, saving, onConfirm, onCancel, onRetry }) {
  const [cat, setCat]               = useState(category)
  const [editFields, setEditFields] = useState(fields)
  const [coverSource, setCoverSource] = useState(
    fields.suggested_image ? 'ai' : (photos.length > 0 ? 'user:0' : null)
  )
  const aiImg     = fields.suggested_image
  const wikiTitle = fields.wiki_title
  const wikiUrl   = fields.wiki_url

  function handleSave() {
    const coverIsAi    = coverSource === 'ai'
    const coverUserIdx = coverSource?.startsWith('user:') ? parseInt(coverSource.split(':')[1]) : null
    onConfirm(editFields, cat, coverIsAi, coverUserIdx)
  }

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      zIndex: 200, background: '#0e1420',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
      animation: 'bubbleUp 0.25s var(--ease-ocean)',
    }}>

      {/* ── TOP BAR ── 固定左右寬度，中間 flex: 1 絕不溢出 */}
      <div style={{
        flexShrink: 0,
        display: 'flex', alignItems: 'center',
        padding: 'calc(var(--safe-top) + 8px) 10px 10px',
        gap: 6,
        background: 'rgba(8,12,20,0.98)',
        backdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(201,169,110,0.10)',
      }}>
        {/* 取消 — 固定寬度 */}
        <button onClick={onCancel} style={{
          width: 56, height: 36, flexShrink: 0,
          background: 'rgba(201,169,110,0.06)',
          border: '1px solid rgba(201,169,110,0.18)',
          borderRadius: 10, fontSize: 13, fontWeight: 600, color: '#c9a96e',
        }}>取消</button>

        {/* 中間標題 — 可縮可截 */}
        <div style={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
          <div style={{
            fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, color: '#f0f6ff',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{editFields.matched_name || name}</div>
          {wikiTitle && (
            <div style={{ fontSize: 10, color: '#7a6a5a', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              📖 {wikiUrl
                ? <a href={wikiUrl} target="_blank" rel="noreferrer" style={{ color: '#c9a96e', textDecoration: 'underline dotted' }}>{wikiTitle}</a>
                : wikiTitle}
            </div>
          )}
        </div>

        {/* 存檔 — 固定寬度 */}
        <button onClick={handleSave} disabled={saving} style={{
          width: 64, height: 36, flexShrink: 0,
          background: saving ? 'rgba(28,40,64,0.5)' : 'linear-gradient(135deg, #d4a855, #c9a96e)',
          color: saving ? '#6b7a8a' : '#0e1420',
          border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
          boxShadow: saving ? 'none' : '0 2px 10px rgba(74,114,196,0.4)',
        }}>
          {saving
            ? <span style={{ width: 12, height: 12, borderRadius: '50%', border: '2px solid #6b7a8a', borderTopColor: 'transparent', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />
            : '✓ 存檔'}
        </button>
      </div>

      {/* 對應說明 + 重查 */}
      <div style={{
        flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6,
        padding: '6px 10px',
        background: 'rgba(8,12,20,0.6)',
        borderBottom: '1px solid rgba(201,169,110,0.06)',
      }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 11, color: '#7a6a5a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {editFields.matched_name && editFields.matched_name !== name
            ? `「${name}」→「${editFields.matched_name}」`
            : !wikiTitle ? '⚠ 維基未找到，以 AI 知識為準' : '資料已確認，可修改後存檔'}
        </span>
        <button onClick={onRetry} style={{
          flexShrink: 0, padding: '4px 10px',
          background: 'rgba(201,169,110,0.06)', border: '1px solid rgba(201,169,110,0.15)',
          borderRadius: 8, fontSize: 11, color: '#c9a96e', fontWeight: 600,
        }}>↩ 重查</button>
      </div>

      {/* ── 可滾動區域 ── */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '14px 16px 0' }}>

        {/* 封面選擇 */}
        {(aiImg || photos.length > 0) && (
          <div style={{ marginBottom: 18 }}>
            <label style={S.label}>選擇封面</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {aiImg && (
                <div onClick={() => setCoverSource('ai')} style={{
                  position: 'relative', cursor: 'pointer', borderRadius: 10, overflow: 'hidden', flexShrink: 0,
                  border: `2px solid ${coverSource === 'ai' ? '#d4a855' : 'rgba(201,169,110,0.15)'}`,
                  transition: 'border-color 0.2s',
                }}>
                  <img src={`/api/image-proxy?url=${encodeURIComponent(aiImg)}`} alt="AI"
                    style={{ width: 80, height: 80, objectFit: 'cover', display: 'block' }}
                    onError={e => e.target.style.display = 'none'} />
                  <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '2px 0', background: 'rgba(8,20,46,0.75)', textAlign: 'center', fontSize: 9, color: coverSource === 'ai' ? '#d4a855' : '#6b7a8a', fontWeight: 700 }}>
                    {coverSource === 'ai' ? '✓ 封面' : 'AI 圖'}
                  </div>
                </div>
              )}
              {photos.map((p, i) => (
                <div key={i} onClick={() => setCoverSource(`user:${i}`)} style={{
                  position: 'relative', cursor: 'pointer', borderRadius: 10, overflow: 'hidden', flexShrink: 0,
                  border: `2px solid ${coverSource === `user:${i}` ? '#d4a855' : 'rgba(201,169,110,0.15)'}`,
                  transition: 'border-color 0.2s',
                }}>
                  <img src={p.preview} style={{ width: 80, height: 80, objectFit: 'cover', display: 'block' }} />
                  <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '2px 0', background: 'rgba(8,20,46,0.75)', textAlign: 'center', fontSize: 9, color: coverSource === `user:${i}` ? '#d4a855' : '#6b7a8a', fontWeight: 700 }}>
                    {coverSource === `user:${i}` ? '✓ 封面' : `照片${i + 1}`}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 分類 */}
        <div style={{ marginBottom: 18 }}>
          <label style={S.label}>分類</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {CATEGORIES.map(c => (
              <button key={c} onClick={() => setCat(c)} style={{
                padding: '5px 14px', borderRadius: 20, fontSize: 13,
                background: cat === c ? 'rgba(201,169,110,0.15)' : 'rgba(28,40,64,0.6)',
                color: cat === c ? '#d4a855' : '#6b7a8a',
                border: `1px solid ${cat === c ? 'rgba(201,169,110,0.45)' : 'rgba(201,169,110,0.08)'}`,
                transition: 'all 0.15s', fontWeight: cat === c ? 600 : 400,
              }}>{c}</button>
            ))}
          </div>
        </div>

        {/* 所有欄位 */}
        {Object.entries(FIELD_LABELS).map(([key, label]) => (
          <div key={key} style={{ marginBottom: 14 }}>
            <label style={S.label}>{label}</label>
            {key === 'description' || key === 'cooking_methods' ? (
              <textarea value={editFields[key] || ''} onChange={e => setEditFields(f => ({ ...f, [key]: e.target.value }))}
                rows={3} style={{ ...S.input, resize: 'vertical', lineHeight: 1.7, boxSizing: 'border-box' }}
                onFocus={focusIn} onBlur={focusOut} />
            ) : (
              <input value={editFields[key] || ''} onChange={e => setEditFields(f => ({ ...f, [key]: e.target.value }))}
                style={{ ...S.input, boxSizing: 'border-box' }}
                onFocus={focusIn} onBlur={focusOut} />
            )}
          </div>
        ))}
        <div style={{ height: 24 }} />
      </div>
    </div>
  )
}

export default function AddPage() {
  const navigate     = useNavigate()
  const fileInputRef = useRef(null)

  const [name, setName]           = useState('')
  const [photos, setPhotos]       = useState([])
  const [aiLoading, setAiLoading] = useState(false)
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState('')
  const [preview, setPreview]     = useState(null)

  async function handleAILookup() {
    if (!name.trim()) return
    setAiLoading(true); setError('')
    try {
      const res = await fetch('/api/fish-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      const { latin_name, ...rest } = data
      const ruleCategory = inferCategory(name.trim()) || inferCategory(rest.matched_name || '')
      const resolved     = ruleCategory || rest.category || '其他'
      setPreview({ fields: { ...rest }, category: resolved })
    } catch (e) {
      setError('AI 查詢失敗：' + e.message)
    } finally {
      setAiLoading(false)
    }
  }

  function handlePhotoSelect(e) {
    const files = Array.from(e.target.files)
    const toAdd = files.slice(0, 10 - photos.length).map(f => ({ file: f, preview: URL.createObjectURL(f) }))
    setPhotos(prev => [...prev, ...toAdd])
  }

  function removePhoto(idx) {
    setPhotos(prev => {
      const next = [...prev]
      URL.revokeObjectURL(next[idx].preview)
      next.splice(idx, 1)
      return next
    })
  }

  async function handleConfirm(confirmedFields, confirmedCat, coverIsAi, coverUserIdx) {
    setSaving(true); setError('')
    try {
      const saveName   = confirmedFields.matched_name || name.trim()
      const aiImageUrl = confirmedFields.suggested_image || null

      const { data: fish, error: insertErr } = await supabase
        .from('fishes')
        .insert({
          name:            saveName,
          category:        confirmedCat,
          scientific_name: confirmedFields.scientific_name || null,
          common_names:    confirmedFields.common_names    || null,
          flavor:          confirmedFields.flavor          || null,
          texture:         confirmedFields.texture         || null,
          market_price:    confirmedFields.market_price    ? parseFloat(confirmedFields.market_price)  : null,
          cooking_methods: confirmedFields.cooking_methods || null,
          habitat_depth:   confirmedFields.habitat_depth   ? parseFloat(confirmedFields.habitat_depth) : null,
          description:     confirmedFields.description     || null,
          cover_photo:    coverIsAi ? aiImageUrl : null,
          ai_cover_photo: aiImageUrl,
          photos:         [],
        })
        .select().single()
      if (insertErr) throw insertErr

      if (photos.length > 0) {
        const urls = []
        for (const { file } of photos) {
          const ext  = file.name.split('.').pop()
          const path = `${fish.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
          await supabase.storage.from('fish-photos').upload(path, file)
          const { data } = supabase.storage.from('fish-photos').getPublicUrl(path)
          urls.push(data.publicUrl)
        }
        const userCover = coverUserIdx !== null ? (urls[coverUserIdx] ?? urls[0]) : null
        await supabase.from('fishes').update({
          photos: urls,
          cover_photo: userCover || (coverIsAi ? aiImageUrl : urls[0]),
        }).eq('id', fish.id)
      }

      navigate(`/fish/${fish.id}`)
    } catch (e) {
      setError('儲存失敗：' + e.message)
      setSaving(false)
    }
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', position: 'relative', zIndex: 1, overflowX: 'hidden' }}>

      {preview && (
        <PreviewOverlay
          name={name} fields={preview.fields} category={preview.category}
          photos={photos} saving={saving}
          onConfirm={handleConfirm}
          onCancel={() => { setPreview(null); setSaving(false) }}
          onRetry={() => { setPreview(null); handleAILookup() }}
        />
      )}

      {/* Header */}
      <div style={{
        padding: 'calc(var(--safe-top) + 8px) 16px 14px',
        background: 'rgba(8,12,20,0.96)',
        backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
        borderBottom: '1px solid rgba(201,169,110,0.10)',
        position: 'sticky', top: 0, zIndex: 10,
      }}>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700 }}>食刻時光</h2>
      </div>

      <div style={{ padding: '16px 16px 100px', maxWidth: '100%', boxSizing: 'border-box' }}>

        {/* Fish name */}
        <section style={{ marginBottom: 18 }}>
          <label style={S.label}>魚種名稱</label>
          <p style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 8, lineHeight: 1.6 }}>輸入市場俗名、台語名都可以</p>
          {/* input + button stacked to prevent horizontal overflow */}
          <input
            value={name} onChange={e => setName(e.target.value)}
            placeholder="例：石狗公、金花魚、三牙..."
            style={{ ...S.input, marginBottom: 8 }}
            onFocus={focusIn} onBlur={focusOut}
            onKeyDown={e => e.key === 'Enter' && handleAILookup()}
          />
          <button onClick={handleAILookup} disabled={aiLoading || !name.trim()} style={{
            width: '100%', padding: '12px',
            background: aiLoading ? 'rgba(28,40,64,0.6)' : 'linear-gradient(135deg, #d4a855, #c9a96e)',
            color: aiLoading ? 'var(--text-muted)' : '#0e1420',
            borderRadius: 10, fontSize: 13, fontWeight: 700,
            border: aiLoading ? '1px solid rgba(201,169,110,0.12)' : 'none',
            boxShadow: aiLoading ? 'none' : '0 2px 12px rgba(212,168,85,0.35)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}>
            {aiLoading
              ? <><span style={{ width: 13, height: 13, borderRadius: '50%', border: '2px solid rgba(212,168,85,0.5)', borderTopColor: 'transparent', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />查詢中...</>
              : '🔍 搜尋魚料'}
          </button>
          {error && (
            <div style={{ marginTop: 10, padding: '9px 12px', background: 'rgba(255,100,80,0.08)', border: '1px solid rgba(255,100,80,0.25)', borderRadius: 8, color: 'var(--accent-coral)', fontSize: 12 }}>{error}</div>
          )}
        </section>



        <div style={{ padding: '11px 13px', borderRadius: 10, background: 'rgba(201,169,110,0.05)', border: '1px solid rgba(201,169,110,0.14)', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.8 }}>
          <span style={{ color: '#d4a855', fontWeight: 600 }}>使用說明</span><br />
          1. 輸入魚名 → 點「🔍 搜尋魚料」<br />
          2. 預覽頁右上角直接按「✓ 存檔」<br />
          3. 不對 → 左上角「取消」或右側「↩ 重查」
        </div>
      </div>
    </div>
  )
}
