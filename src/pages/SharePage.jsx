import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { proxyImage } from '../lib/imageProxy'

export default function SharePage() {
  const { id } = useParams()
  const [fish, setFish] = useState(null)
  const [loading, setLoading] = useState(true)
  const [photoIdx, setPhotoIdx] = useState(0)

  useEffect(() => {
    supabase.from('fishes').select('*').eq('id', id).single().then(({ data }) => {
      setFish(data); setLoading(false)
    })
  }, [id])

  if (loading) return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1, position: 'relative' }}>
      <div style={{ width: 32, height: 32, borderRadius: '50%', border: '2px solid var(--accent-sky)', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} />
    </div>
  )

  if (!fish) return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#6b7a6a', gap: 12 }}>
      <span style={{ fontSize: 48 }}>🌊</span>
      <span>找不到這筆資料</span>
    </div>
  )

  const rows = [
    fish.scientific_name && { label: '學名', value: fish.scientific_name, italic: true },
    fish.flavor          && { label: '味道', value: fish.flavor },
    fish.texture         && { label: '肉質', value: fish.texture },
    fish.market_price    && { label: '市場價格', value: `${fish.market_price} 元/斤` },
    fish.cooking_methods && { label: '料理方式', value: fish.cooking_methods },
    fish.habitat_depth   && { label: '棲息深度', value: `${fish.habitat_depth} m` },
    fish.description     && { label: '備註', value: fish.description },
  ].filter(Boolean)

  const photos = fish.photos?.length ? fish.photos : (fish.cover_photo ? [fish.cover_photo] : [])

  return (
    <div style={{ height: '100%', overflowY: 'auto', position: 'relative', zIndex: 1 }}>
      <div style={{
        position: 'fixed', top: 'calc(var(--safe-top) + 10px)', right: 14, zIndex: 20,
        padding: '4px 12px',
        background: 'rgba(8,20,46,0.88)', backdropFilter: 'blur(10px)',
        border: '1px solid rgba(201,169,110,0.18)',
        borderRadius: 20, fontSize: 10, color: '#d4a855',
        fontFamily: 'var(--font-mono)',
      }}>海鮮圖鑑</div>

      {photos.length > 0 && (
        <div style={{ position: 'relative', aspectRatio: '4/3', background: 'var(--bg-surface)' }}>
          <img src={proxyImage(photos[photoIdx])} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          {photos.length > 1 && (
            <div style={{ position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 5 }}>
              {photos.map((_, i) => (
                <div key={i} onClick={() => setPhotoIdx(i)} style={{
                  width: i === photoIdx ? 16 : 6, height: 6, borderRadius: 3,
                  background: i === photoIdx ? '#d4a855' : 'rgba(201,169,110,0.25)',
                  transition: 'all 0.3s', cursor: 'pointer',
                }} />
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{ padding: '24px 20px 60px' }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 700, color: 'var(--cream)', marginBottom: 4 }}>{fish.name}</h1>
        {fish.scientific_name && (
          <p style={{ fontStyle: 'italic', color: '#6b7a6a', fontSize: 14, marginBottom: 20 }}>{fish.scientific_name}</p>
        )}
        <div style={{
          background: 'linear-gradient(145deg, rgba(28,40,64,0.8), rgba(33,47,74,0.7))',
          borderRadius: 16, border: '1px solid rgba(201,169,110,0.1)', overflow: 'hidden',
          backdropFilter: 'blur(8px)',
        }}>
          {rows.map((row, i) => (
            <div key={row.label} style={{
              padding: '13px 16px',
              borderBottom: i < rows.length - 1 ? '1px solid var(--border-subtle)' : 'none',
              display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16,
            }}>
              <span style={{ fontSize: 11, color: '#6b7a6a', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>{row.label}</span>
              <span style={{ fontSize: 14, color: '#e8dcc8', textAlign: 'right', fontStyle: row.italic ? 'italic' : 'normal', lineHeight: 1.5 }}>
                {row.value}
              </span>
            </div>
          ))}
        </div>
        <p style={{ textAlign: 'center', marginTop: 20, fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
          由海鮮圖鑑分享
        </p>
      </div>
    </div>
  )
}
