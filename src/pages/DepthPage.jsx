import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { proxyImage } from '../lib/imageProxy'

const DEPTH_ZONES = [
  { name: '潮間帶',   range: [0,    50],    color: '#c9a96e' },
  { name: '淺海帶',   range: [50,   200],   color: '#8aaa88' },
  { name: '中深海帶', range: [200,  500],   color: '#5a8aaa' },
  { name: '深海帶',   range: [500,  3000],  color: '#3a5a7a' },
]

const CONTAINER_H  = 1200   // total scrollable height (px)
const CARD_W       = 72     // card width
const CARD_H       = 96     // card height (photo + name)
const COL_GAP      = 8      // gap between columns
const LEFT_RULER_W = 52

// 分段線性映射：0-100m 佔 70%，100-500m 佔 20%，500-3000m 佔 10%
function getDepthY(depth, h) {
  const MAX_DEPTH = 3000
  const d = Math.min(depth, MAX_DEPTH)
  if (d <= 100) {
    return (d / 100) * h * 0.70
  } else if (d <= 500) {
    return h * 0.70 + ((d - 100) / 400) * h * 0.20
  } else {
    return h * 0.90 + ((d - 500) / 2500) * h * 0.10
  }
}

export default function DepthPage() {
  const navigate = useNavigate()
  const [fishes,  setFishes]  = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const scrollRef = useRef(null)

  useEffect(() => {
    supabase
      .from('fishes')
      .select('id, name, scientific_name, habitat_depth, category, cover_photo, photos, ai_cover_photo')
      .not('habitat_depth', 'is', null)
      .order('habitat_depth', { ascending: true })
      .then(({ data }) => { setFishes(data || []); setLoading(false) })
  }, [])

  // Group fishes by depth bucket → assign column index within same bucket
  // bucket = round to nearest 5m to cluster nearby fish
  const positionMap = (() => {
    const buckets = {}
    fishes.forEach(fish => {
      const bucket = Math.round(fish.habitat_depth / 5) * 5
      if (!buckets[bucket]) buckets[bucket] = []
      buckets[bucket].push(fish.id)
    })
    const map = {}
    fishes.forEach(fish => {
      const bucket = Math.round(fish.habitat_depth / 5) * 5
      map[fish.id] = buckets[bucket].indexOf(fish.id)
    })
    return map
  })()

  // Max columns needed (for total width calculation)
  const maxCol = fishes.length ? Math.max(...Object.values(positionMap)) : 0
  const totalCols   = maxCol + 1
  const oceanWidth  = Math.max(totalCols * (CARD_W + COL_GAP) + 24, 280)

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', position: 'relative', zIndex: 1 }}>
      {/* Header */}
      <div style={{
        paddingTop: 'calc(var(--safe-top) + 6px)',
        padding: 'calc(var(--safe-top) + 6px) 16px 14px',
        background: 'rgba(8,12,20,0.96)',
        backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
        borderBottom: '1px solid var(--border-subtle)', flexShrink: 0,
      }}>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, marginBottom: 2 }}>深海棲息圖</h2>
        <p style={{ fontSize: 11, color: '#6b7a6a', fontFamily: 'var(--font-mono)' }}>
          {fishes.length} 種 · 上下滑動看深度，左右滑動看更多
        </p>
      </div>

      {/* Body — both scroll axes */}
      <div
        ref={scrollRef}
        style={{ flex: 1, overflow: 'scroll', overscrollBehavior: 'contain' }}
      >
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200 }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', border: '2px solid #d4a855', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} />
          </div>
        ) : fishes.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 300, color: '#6b7a6a', gap: 8 }}>
            <span style={{ fontSize: 40 }}>🌊</span>
            <span style={{ fontSize: 14 }}>新增含有棲息深度資料的海鮮後顯示</span>
          </div>
        ) : (
          <div style={{ display: 'flex', minHeight: CONTAINER_H + 80 }}>
            {/* ── Depth ruler (fixed-ish left column) ── */}
            <div style={{
              width: LEFT_RULER_W, flexShrink: 0,
              position: 'sticky', left: 0, zIndex: 10,
              height: CONTAINER_H + 80,
              background: 'rgba(8,12,20,0.94)',
              backdropFilter: 'blur(12px)',
              borderRight: '1px solid var(--border-subtle)',
            }}>
              {[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 150, 200, 500, 1000, 2000, 3000].map(depth => {
                const y = getDepthY(depth, CONTAINER_H) + 40
                return (
                  <div key={depth} style={{
                    position: 'absolute', top: y, right: 6,
                    transform: 'translateY(-50%)',
                    fontFamily: 'var(--font-mono)', fontSize: 9,
                    color: '#6b7a6a', textAlign: 'right', whiteSpace: 'nowrap',
                  }}>
                    {depth >= 1000 ? `${(depth/1000).toFixed(depth===3000?1:1)}km` : `${depth}m`}
                  </div>
                )
              })}
              {/* tick marks */}
              {[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 150, 200, 500, 1000, 2000, 3000].map(depth => {
                const y = getDepthY(depth, CONTAINER_H) + 40
                return (
                  <div key={`tick-${depth}`} style={{
                    position: 'absolute', top: y, right: 0,
                    width: 6, height: 1,
                    background: 'rgba(168,192,232,0.25)',
                  }} />
                )
              })}
            </div>

            {/* ── Ocean column (scrolls horizontally) ── */}
            <div style={{ position: 'relative', height: CONTAINER_H + 80, width: oceanWidth, flexShrink: 0 }}>
              {/* Zone gradients */}
              {DEPTH_ZONES.map(zone => {
                const y1 = getDepthY(zone.range[0], CONTAINER_H) + 40
                const y2 = getDepthY(zone.range[1], CONTAINER_H) + 40
                return (
                  <div key={zone.name} style={{
                    position: 'absolute', left: 0, right: 0, top: y1, height: y2 - y1,
                    background: `linear-gradient(180deg, ${zone.color}18, ${zone.color}08)`,
                    borderBottom: `1px solid ${zone.color}25`,
                  }}>
                    <span style={{ position: 'absolute', right: 8, top: 5, fontSize: 9, color: zone.color, opacity: 0.6, fontFamily: 'var(--font-mono)' }}>
                      {zone.name}
                    </span>
                  </div>
                )
              })}

              {/* Surface line */}
              <div style={{
                position: 'absolute', top: 40, left: 0, right: 0, height: 1,
                background: 'linear-gradient(90deg, transparent, rgba(168,192,232,0.4), transparent)',
              }} />

              {/* ── Fish cards ── */}
              {fishes.map(fish => {
                const col    = positionMap[fish.id] || 0
                const y      = getDepthY(fish.habitat_depth, CONTAINER_H) + 40
                const x      = col * (CARD_W + COL_GAP) + 8
                const cover  = proxyImage(fish.cover_photo || fish.ai_cover_photo) || null
                const isSelected = selected?.id === fish.id

                return (
                  <div
                    key={fish.id}
                    onClick={() => { setSelected(isSelected ? null : fish); navigate(`/fish/${fish.id}`) }}
                    style={{
                      position: 'absolute',
                      top: y - CARD_H / 2,
                      left: x,
                      width: CARD_W,
                      cursor: 'pointer',
                      transition: 'transform 0.18s',
                      zIndex: isSelected ? 5 : 1,
                    }}
                    onTouchStart={e => e.currentTarget.style.transform = 'scale(0.95)'}
                    onTouchEnd={e => e.currentTarget.style.transform = 'scale(1)'}
                  >
                    {/* Depth connector line */}
                    <div style={{
                      position: 'absolute',
                      left: CARD_W / 2, top: CARD_H / 2,
                      width: 1, height: 12,
                      background: 'rgba(201,169,110,0.2)',
                      transform: 'translateY(-50%) translateX(-0.5px)',
                      pointerEvents: 'none',
                    }} />

                    {/* Card */}
                    <div style={{
                      width: CARD_W,
                      background: isSelected
                        ? 'rgba(74,114,196,0.35)'
                        : 'rgba(14,20,32,0.92)',
                      backdropFilter: 'blur(10px)',
                      border: `1px solid ${isSelected ? 'rgba(201,169,110,0.45)' : 'rgba(201,169,110,0.08)'}`,
                      borderRadius: 10,
                      overflow: 'hidden',
                      boxShadow: isSelected ? '0 0 14px rgba(74,114,196,0.45)' : '0 2px 8px rgba(8,20,46,0.5)',
                      transition: 'all 0.18s',
                    }}>
                      {/* Photo */}
                      <div style={{ width: CARD_W, height: CARD_W, background: '#192238', position: 'relative', overflow: 'hidden' }}>
                        {cover ? (
                          <img src={cover} alt={fish.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (
                          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, opacity: 0.2 }}>🐟</div>
                        )}
                      </div>
                      {/* Name */}
                      <div style={{
                        padding: '4px 5px 5px',
                        textAlign: 'center',
                        fontFamily: 'var(--font-display)',
                        fontSize: 11,
                        color: isSelected ? 'var(--accent-light)' : '#a89880',
                        lineHeight: 1.3,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>{fish.name}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
