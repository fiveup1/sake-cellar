import { useLocation, useNavigate } from 'react-router-dom'

const tabs = [
  {
    path: '/',
    label: '鰭跡地圖',
    icon: (active) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <rect x="3"  y="3"  width="8" height="8" rx="2.5"
          fill={active ? 'rgba(201,169,110,0.15)' : 'none'}
          stroke={active ? '#d4a855' : '#3d4d5e'} strokeWidth="1.5"/>
        <rect x="13" y="3"  width="8" height="8" rx="2.5"
          fill={active ? 'rgba(201,169,110,0.08)' : 'none'}
          stroke={active ? '#c9a96e' : '#3d4d5e'} strokeWidth="1.5"/>
        <rect x="3"  y="13" width="8" height="8" rx="2.5"
          fill={active ? 'rgba(201,169,110,0.08)' : 'none'}
          stroke={active ? '#c9a96e' : '#3d4d5e'} strokeWidth="1.5"/>
        <rect x="13" y="13" width="8" height="8" rx="2.5"
          fill='none'
          stroke={active ? '#c9a96e' : '#3d4d5e'} strokeWidth="1.5"/>
      </svg>
    ),
  },
  {
    path: '/add',
    label: '食刻時光',
    icon: (active) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="9"
          fill={active ? 'rgba(201,169,110,0.12)' : 'none'}
          stroke={active ? '#d4a855' : '#3d4d5e'} strokeWidth="1.5"/>
        <path d="M12 8v8M8 12h8"
          stroke={active ? '#e8dcc8' : '#3d4d5e'} strokeWidth="2" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    path: '/depth',
    label: '深度圖',
    icon: (active) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <path d="M2 7c3.5 0 3.5 4 7 4s3.5-4 7-4 3.5 4 6 4"
          stroke={active ? '#d4a855' : '#3d4d5e'} strokeWidth="1.5" strokeLinecap="round"/>
        <path d="M2 13c3.5 0 3.5 4 7 4s3.5-4 7-4 3.5 4 6 4"
          stroke={active ? '#c9a96e' : '#3d4d5e'} strokeWidth="1.5" strokeLinecap="round" opacity="0.6"/>
        <path d="M2 19c3.5 0 3.5 3 7 3s3.5-3 7-3 3.5 3 6 3"
          stroke={active ? '#b8966a' : '#3d4d5e'} strokeWidth="1.5" strokeLinecap="round" opacity="0.3"/>
      </svg>
    ),
  },
]

export default function TabBar() {
  const location = useLocation()
  const navigate = useNavigate()

  if (location.pathname.startsWith('/fish/') || location.pathname.startsWith('/share/')) return null

  return (
    <nav style={{
      position: 'relative', zIndex: 100,
      display: 'flex', alignItems: 'stretch',
      background: 'rgba(8,12,20,0.97)',
      backdropFilter: 'blur(24px)',
      WebkitBackdropFilter: 'blur(24px)',
      borderTop: '1px solid rgba(201,169,110,0.12)',
      paddingBottom: 'env(safe-area-inset-bottom, 20px)',
    }}>
      {tabs.map(tab => {
        const active = location.pathname === tab.path
        return (
          <button key={tab.path} onClick={() => navigate(tab.path)} style={{
            flex: 1,
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            gap: 4, padding: '10px 0',
            background: 'none',
            opacity: active ? 1 : 0.45,
            transition: 'opacity 0.2s',
            position: 'relative',
          }}>
            {active && (
              <div style={{
                position: 'absolute', top: 0, left: '50%',
                transform: 'translateX(-50%)',
                width: 28, height: 2,
                background: 'linear-gradient(90deg, transparent, #d4a855, transparent)',
                borderRadius: 2,
              }} />
            )}
            {tab.icon(active)}
            <span style={{
              fontSize: 10,
              fontFamily: 'var(--font-body)',
              color: active ? '#d4a855' : 'var(--text-dim)',
              letterSpacing: '0.04em',
              fontWeight: active ? 600 : 400,
            }}>{tab.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
