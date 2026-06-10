import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { proxyImage } from '../lib/imageProxy'
import { inferCategory } from '../lib/categoryRules'

const CATEGORIES = ['魚', '蝦', '蟹', '貝', '花枝', '章魚', '其他']

const INFO_ROWS = [
  { key: 'scientific_name', label: '學名',    icon: '🔬', italic: true },
  { key: 'common_names',    label: '常見別名', icon: '🏷' },
  { key: 'flavor',          label: '味道',    icon: '👅' },
  { key: 'texture',         label: '肉質',    icon: '✋' },
  { key: 'market_price',    label: '市場價格', icon: '💰', suffix: ' 元/斤' },
  { key: 'cooking_methods', label: '料理方式', icon: '🍳' },
  { key: 'habitat_depth',   label: '棲息深度', icon: '🌊', suffix: ' m' },
  { key: 'description',     label: '備註',    icon: '📝' },
]

/* ── Lightbox ───────────────────────────────────────────── */
function Lightbox({ photos, initialIndex, onClose }) {
  const [idx, setIdx] = useState(initialIndex)
  const startX = useRef(null), startY = useRef(null)
  const prev = useCallback(() => setIdx(i => (i - 1 + photos.length) % photos.length), [photos.length])
  const next = useCallback(() => setIdx(i => (i + 1) % photos.length), [photos.length])

  useEffect(() => {
    const fn = e => { if (e.key === 'ArrowLeft') prev(); if (e.key === 'ArrowRight') next(); if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [prev, next, onClose])

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(8,12,20,0.98)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}
      onTouchStart={e => { startX.current = e.touches[0].clientX; startY.current = e.touches[0].clientY }}
      onTouchEnd={e => {
        if (!startX.current) return
        const dx = e.changedTouches[0].clientX - startX.current
        const dy = Math.abs(e.changedTouches[0].clientY - startY.current)
        if (Math.abs(dx) > 40 && dy < 60) dx < 0 ? next() : prev()
        startX.current = null
      }}>
      <button onClick={onClose} style={{ position: 'absolute', top: 'calc(var(--safe-top) + 12px)', right: 16, width: 40, height: 40, borderRadius: '50%', background: 'rgba(14,20,32,0.9)', border: '1px solid rgba(201,169,110,0.3)', color: '#e8dcc8', fontSize: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
      <div style={{ position: 'absolute', top: 'calc(var(--safe-top) + 17px)', left: '50%', transform: 'translateX(-50%)', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>{idx + 1} / {photos.length}</div>
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '64px 0' }}>
        <img key={idx} src={photos[idx]} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', animation: 'bubbleUp 0.2s var(--ease-ocean)', borderRadius: 4 }} />
      </div>
      {photos.length > 1 && <>
        <button onClick={prev} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', width: 46, height: 46, borderRadius: 12, background: 'rgba(14,20,32,0.92)', border: '1px solid rgba(201,169,110,0.35)', color: '#e8dcc8', fontSize: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 12px rgba(8,12,20,0.6)' }}>‹</button>
        <button onClick={next} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', width: 46, height: 46, borderRadius: 12, background: 'rgba(14,20,32,0.92)', border: '1px solid rgba(201,169,110,0.35)', color: '#e8dcc8', fontSize: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 12px rgba(8,12,20,0.6)' }}>›</button>
        <div style={{ position: 'absolute', bottom: 'calc(var(--safe-bottom) + 16px)', display: 'flex', gap: 6 }}>
          {photos.map((_, i) => <button key={i} onClick={() => setIdx(i)} style={{ width: i === idx ? 18 : 6, height: 6, borderRadius: 3, background: i === idx ? '#d4a855' : 'rgba(201,169,110,0.25)', transition: 'all 0.2s' }} />)}
        </div>
      </>}
    </div>
  )
}

/* ── DetailPage ─────────────────────────────────────────── */
export default function DetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const fileInputRef = useRef(null)

  const [fish, setFish]         = useState(null)
  const [loading, setLoading]   = useState(true)
  const [uploading, setUploading]   = useState(false)
  const [copied, setCopied]         = useState(false)
  const [deleting, setDeleting]     = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [settingCover, setSettingCover]   = useState(null)
  const [deletingPhoto, setDeletingPhoto] = useState(null)
  const [lightboxIndex, setLightboxIndex] = useState(null)
  const [editingCategory, setEditingCategory] = useState(false)

  useEffect(() => { fetchFish() }, [id]) // eslint-disable-line

  async function fetchFish() {
    const { data, error } = await supabase.from('fishes').select('*').eq('id', id).single()
    if (error) { navigate('/'); return }
    setFish(data); setLoading(false)
  }

  async function handleSetCover(url) {
    setSettingCover(url)
    await supabase.from('fishes').update({ cover_photo: url }).eq('id', id)
    setFish(f => ({ ...f, cover_photo: url }))
    setSettingCover(null)
  }

  async function handleDeletePhoto(url) {
    setDeletingPhoto(url)
    try {
      const newPhotos = (fish.photos || []).filter(u => u !== url)
      if (url.includes('supabase.co')) {
        const path = url.split('/fish-photos/')[1]
        if (path) await supabase.storage.from('fish-photos').remove([path])
      }
      const update = { photos: newPhotos }
      if (fish.cover_photo === url) update.cover_photo = fish.ai_cover_photo || null
      await supabase.from('fishes').update(update).eq('id', id)
      setFish(f => ({ ...f, photos: newPhotos, cover_photo: f.cover_photo === url ? (f.ai_cover_photo || null) : f.cover_photo }))
    } finally { setDeletingPhoto(null) }
  }

  async function handleChangeCategory(cat) {
    await supabase.from('fishes').update({ category: cat }).eq('id', id)
    setFish(f => ({ ...f, category: cat }))
    setEditingCategory(false)
  }

  async function handleAddPhotos(e) {
    const files = Array.from(e.target.files).slice(0, 10 - (fish.photos?.length || 0))
    if (!files.length) return
    setUploading(true)
    try {
      const urls = []
      for (const file of files) {
        const ext = file.name.split('.').pop()
        const path = `${id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
        await supabase.storage.from('fish-photos').upload(path, file)
        const { data } = supabase.storage.from('fish-photos').getPublicUrl(path)
        urls.push(data.publicUrl)
      }
      const newPhotos = [...(fish.photos || []), ...urls]
      await supabase.from('fishes').update({ photos: newPhotos }).eq('id', id)
      setFish(f => ({ ...f, photos: newPhotos }))
    } finally { setUploading(false) }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      if (fish.photos?.length) {
        const paths = fish.photos.filter(u => u.includes('supabase.co')).map(u => u.split('/fish-photos/')[1]).filter(Boolean)
        if (paths.length) await supabase.storage.from('fish-photos').remove(paths)
      }
      await supabase.from('fishes').delete().eq('id', id)
      navigate('/')
    } catch { setDeleting(false); setShowDeleteConfirm(false) }
  }

  if (loading) return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1, position: 'relative' }}>
      <div style={{ width: 28, height: 28, borderRadius: '50%', border: '2px solid #d4a855', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} />
    </div>
  )

  const hasAiCoverSeparate = fish.ai_cover_photo && !(fish.photos || []).includes(fish.ai_cover_photo)
  const lightboxPhotos = [...(hasAiCoverSeparate ? [proxyImage(fish.ai_cover_photo)] : []), ...(fish.photos || [])]

  // Shared card style
  const cardStyle = {
    background: 'linear-gradient(145deg, #1c2840, #212f4a)',
    border: '1px solid rgba(201,169,110,0.14)',
    borderRadius: 16,
    overflow: 'hidden',
    boxShadow: '0 4px 20px rgba(8,12,20,0.5)',
    position: 'relative',
  }
  const goldLine = { position: 'absolute', left: 0, top: 0, bottom: 0, width: 2, background: 'linear-gradient(180deg, #d4a855, transparent)' }

  return (
    <div style={{ height: '100%', overflowY: 'auto', position: 'relative', zIndex: 1 }}>
      {lightboxIndex !== null && <Lightbox photos={lightboxPhotos} initialIndex={lightboxIndex} onClose={() => setLightboxIndex(null)} />}

      {/* Delete confirm */}
      {showDeleteConfirm && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(8,12,20,0.95)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ ...cardStyle, maxWidth: 300, width: '100%', padding: 24, animation: 'bubbleUp 0.2s var(--ease-ocean)' }}>
            <div style={goldLine} />
            <div style={{ fontSize: 28, textAlign: 'center', marginBottom: 10 }}>🗑</div>
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 17, textAlign: 'center', marginBottom: 6, color: 'var(--cream)' }}>確定要刪除？</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: 12, textAlign: 'center', marginBottom: 18 }}>「{fish.name}」的所有資料與照片將永久刪除。</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setShowDeleteConfirm(false)} style={{ flex: 1, padding: '11px', borderRadius: 10, background: 'rgba(201,169,110,0.06)', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600, border: '1px solid rgba(201,169,110,0.15)' }}>取消</button>
              <button onClick={handleDelete} disabled={deleting} style={{ flex: 1, padding: '11px', borderRadius: 10, background: 'rgba(255,100,80,0.1)', border: '1px solid rgba(255,100,80,0.3)', color: '#ff8066', fontSize: 13, fontWeight: 600 }}>{deleting ? '刪除中...' : '確定刪除'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Category edit sheet */}
      {editingCategory && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(8,12,20,0.88)', display: 'flex', alignItems: 'flex-end' }} onClick={() => setEditingCategory(false)}>
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', background: '#131b2e', borderRadius: '20px 20px 0 0', border: '1px solid rgba(201,169,110,0.15)', padding: '20px 20px calc(20px + env(safe-area-inset-bottom,0px))', animation: 'bubbleUp 0.22s var(--ease-ocean)' }}>
            <p style={{ fontSize: 11, color: '#d4a855', fontFamily: 'var(--font-mono)', textAlign: 'center', marginBottom: 16, letterSpacing: '0.08em' }}>選擇分類</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
              {CATEGORIES.map(cat => (
                <button key={cat} onClick={() => handleChangeCategory(cat)} style={{ padding: '8px 20px', borderRadius: 20, fontSize: 14, background: fish.category === cat ? 'rgba(201,169,110,0.18)' : 'rgba(28,40,64,0.8)', color: fish.category === cat ? '#d4a855' : 'var(--text-secondary)', border: `1px solid ${fish.category === cat ? 'rgba(201,169,110,0.45)' : 'rgba(201,169,110,0.1)'}`, fontWeight: fish.category === cat ? 700 : 400 }}>{cat}</button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Top bar */}
      <div style={{ position: 'sticky', top: 0, zIndex: 20, display: 'flex', alignItems: 'center', padding: 'calc(var(--safe-top) + 10px) 14px 10px', background: 'rgba(8,12,20,0.90)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', borderBottom: '1px solid rgba(201,169,110,0.08)', gap: 8 }}>
        <button onClick={() => navigate(-1)} style={{ width: 34, height: 34, borderRadius: '50%', background: 'rgba(28,40,64,0.8)', border: '1px solid rgba(201,169,110,0.2)', color: 'var(--cream)', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>←</button>
        <div style={{ flex: 1 }} />
        <button onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/share/${id}`); setCopied(true); setTimeout(() => setCopied(false), 2000) }} style={{ padding: '7px 13px', borderRadius: 18, background: copied ? 'rgba(201,169,110,0.15)' : 'rgba(28,40,64,0.7)', border: `1px solid ${copied ? 'rgba(201,169,110,0.5)' : 'rgba(201,169,110,0.15)'}`, color: copied ? '#d4a855' : 'var(--text-secondary)', fontSize: 12, transition: 'all 0.3s' }}>{copied ? '✓ 已複製' : '分享'}</button>
        <button onClick={() => setShowDeleteConfirm(true)} style={{ width: 34, height: 34, borderRadius: '50%', background: 'rgba(28,40,64,0.7)', border: '1px solid rgba(255,100,80,0.25)', color: '#ff8066', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>🗑</button>
      </div>

      {/* Cover */}
      <div style={{ position: 'relative', aspectRatio: '4/3', background: 'var(--bg-surface)', cursor: fish.cover_photo ? 'pointer' : 'default' }} onClick={() => fish.cover_photo && setLightboxIndex(0)}>
        {fish.cover_photo
          ? <img src={proxyImage(fish.cover_photo)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 56, opacity: 0.1 }}>🐟</div>}
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 60, background: 'linear-gradient(transparent, rgba(8,12,20,0.85))' }} />
        <div style={{ position: 'absolute', bottom: 10, left: 12, display: 'flex', gap: 6 }}>
          {fish.cover_photo && <div style={{ background: 'rgba(8,12,20,0.75)', backdropFilter: 'blur(8px)', border: '1px solid rgba(201,169,110,0.25)', borderRadius: 6, padding: '3px 9px', fontSize: 9, color: '#d4a855', fontFamily: 'var(--font-mono)' }}>封面照</div>}
          {fish.ai_cover_photo && fish.cover_photo !== fish.ai_cover_photo && (
            <button onClick={e => { e.stopPropagation(); handleSetCover(fish.ai_cover_photo) }} style={{ background: 'rgba(28,40,64,0.85)', backdropFilter: 'blur(8px)', border: '1px solid rgba(201,169,110,0.3)', borderRadius: 6, padding: '3px 9px', fontSize: 9, color: '#c9a96e', cursor: 'pointer' }}>↩ 還原 AI 封面</button>
          )}
        </div>
      </div>

      <div style={{ padding: '20px 16px 80px' }}>
        {/* Title */}
        <div style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 700, color: 'var(--cream)', flex: 1 }}>{fish.name}</h1>
            <button onClick={() => setEditingCategory(true)} style={{ marginTop: 4, padding: '4px 10px', borderRadius: 10, background: 'rgba(201,169,110,0.08)', border: '1px solid rgba(201,169,110,0.2)', color: '#c9a96e', fontSize: 11, flexShrink: 0 }}>{fish.category || '未分類'} ✏️</button>
          </div>
          {fish.scientific_name && <p style={{ fontStyle: 'italic', color: 'var(--text-muted)', fontSize: 13 }}>{fish.scientific_name}</p>}
        </div>

        {/* Info table */}
        <div style={{ ...cardStyle, marginBottom: 20 }}>
          <div style={goldLine} />
          {INFO_ROWS.filter(r => fish[r.key] != null && fish[r.key] !== '').map((row, i, arr) => (
            <div key={row.key} style={{ display: 'flex', alignItems: 'flex-start', padding: '11px 14px 11px 16px', borderBottom: i < arr.length - 1 ? '1px solid rgba(201,169,110,0.07)' : 'none', gap: 10 }}>
              <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}>{row.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 9, color: '#d4a855', marginBottom: 2, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.8 }}>{row.label}</div>
                <div style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.55, fontStyle: row.italic ? 'italic' : 'normal' }}>{`${fish[row.key]}${row.suffix || ''}`}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Photos */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 2, height: 14, background: 'linear-gradient(180deg, #d4a855, transparent)', borderRadius: 1 }} />
              <h3 style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: '#d4a855', letterSpacing: '0.08em', textTransform: 'uppercase', opacity: 0.8 }}>我的照片 ({fish.photos?.length || 0}/10)</h3>
            </div>
            {(fish.photos?.length || 0) < 10 && (
              <button onClick={() => fileInputRef.current?.click()} disabled={uploading} style={{ padding: '5px 12px', borderRadius: 8, fontSize: 11, background: 'rgba(201,169,110,0.08)', border: '1px solid rgba(201,169,110,0.2)', color: '#c9a96e', fontWeight: 500 }}>{uploading ? '上傳中...' : '＋ 上傳'}</button>
            )}
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={handleAddPhotos} />

          {fish.ai_cover_photo && (
            <div style={{ marginBottom: 12 }}>
              <p style={{ fontSize: 9, color: 'var(--text-dim)', marginBottom: 6, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>AI 辨識圖</p>
              <div style={{ position: 'relative', display: 'inline-block' }}>
                <img src={proxyImage(fish.ai_cover_photo)} onClick={() => setLightboxIndex(0)}
                  style={{ width: 84, height: 84, objectFit: 'cover', borderRadius: 10, border: `2px solid ${fish.cover_photo === fish.ai_cover_photo ? '#d4a855' : 'rgba(201,169,110,0.2)'}`, cursor: 'pointer', transition: 'border-color 0.2s' }} />
                {fish.cover_photo === fish.ai_cover_photo
                  ? <div style={{ position: 'absolute', bottom: 4, left: '50%', transform: 'translateX(-50%)', background: 'rgba(14,20,32,0.88)', borderRadius: 4, padding: '2px 6px', fontSize: 8, color: '#d4a855', whiteSpace: 'nowrap', fontWeight: 700 }}>✓ 封面</div>
                  : <button onClick={() => handleSetCover(fish.ai_cover_photo)} style={{ position: 'absolute', bottom: 4, left: '50%', transform: 'translateX(-50%)', background: 'rgba(14,20,32,0.88)', borderRadius: 4, padding: '2px 6px', fontSize: 8, color: '#c9a96e', whiteSpace: 'nowrap', border: '1px solid rgba(201,169,110,0.2)' }}>設封面</button>}
              </div>
            </div>
          )}

          {fish.photos?.length > 0 ? (
            <>
              <p style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 8 }}>點擊放大 · 點「設封面」可換封面</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
                {fish.photos.map((url, i) => {
                  const isCover = fish.cover_photo === url
                  const lbIdx = (hasAiCoverSeparate ? 1 : 0) + i
                  return (
                    <div key={i} style={{ position: 'relative', aspectRatio: '1', borderRadius: 10, overflow: 'hidden', border: `2px solid ${isCover ? '#d4a855' : 'rgba(201,169,110,0.12)'}`, transition: 'border-color 0.2s' }}>
                      <img src={url} onClick={() => setLightboxIndex(lbIdx)} style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: 'pointer' }} />
                      {isCover
                        ? <div style={{ position: 'absolute', bottom: 4, left: '50%', transform: 'translateX(-50%)', background: 'rgba(14,20,32,0.88)', borderRadius: 4, padding: '2px 6px', fontSize: 8, color: '#d4a855', fontWeight: 700, whiteSpace: 'nowrap' }}>✓ 封面</div>
                        : <button onClick={() => handleSetCover(url)} style={{ position: 'absolute', bottom: 4, left: '50%', transform: 'translateX(-50%)', background: 'rgba(14,20,32,0.85)', backdropFilter: 'blur(4px)', borderRadius: 4, padding: '2px 6px', fontSize: 8, color: '#c9a96e', whiteSpace: 'nowrap', border: '1px solid rgba(201,169,110,0.2)' }}>設封面</button>}
                      <button onClick={() => handleDeletePhoto(url)} disabled={deletingPhoto === url} style={{ position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: '50%', background: 'rgba(8,12,20,0.88)', border: '1px solid rgba(255,100,80,0.4)', color: '#ff8066', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{deletingPhoto === url ? '…' : '×'}</button>
                      {settingCover === url && <div style={{ position: 'absolute', inset: 0, background: 'rgba(201,169,110,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid #d4a855', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} /></div>}
                    </div>
                  )
                })}
                {fish.photos.length < 10 && <button onClick={() => fileInputRef.current?.click()} style={{ aspectRatio: '1', borderRadius: 10, background: 'rgba(28,40,64,0.5)', border: '1px dashed rgba(201,169,110,0.2)', color: 'var(--text-muted)', fontSize: 20 }}>+</button>}
              </div>
            </>
          ) : (
            <button onClick={() => fileInputRef.current?.click()} style={{ width: '100%', padding: '20px 16px', borderRadius: 12, background: 'rgba(28,40,64,0.4)', border: '1px dashed rgba(201,169,110,0.15)', color: 'var(--text-muted)', fontSize: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 24, opacity: 0.5 }}>📷</span><span>上傳自己拍的照片</span>
            </button>
          )}
        </div>

        <div style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: 10, fontFamily: 'var(--font-mono)' }}>
          {new Date(fish.created_at).toLocaleDateString('zh-TW')} 新增
        </div>
      </div>
    </div>
  )
}
