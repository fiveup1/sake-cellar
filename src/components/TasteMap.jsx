// 日本酒 味わいMAP — 甘辛度 × 濃淡度 視覺化

export default function TasteMap({ info, size = 140 }) {
  // 日本酒度：+ 偏辛口（右），- 偏甘口（左）。範圍約 -6 ~ +12
  const smv = parseFloat(String(info?.sake_meter || "").replace(/[^-\d.]/g, ""));
  const acidity = parseFloat(String(info?.acidity || "").replace(/[^\d.]/g, ""));

  const hasData = !isNaN(smv) || !isNaN(acidity);
  if (!hasData) return null;

  // x: 甘辛（-6→0%, +12→100%）
  const x = isNaN(smv) ? 0.5 : Math.max(0, Math.min(1, (smv + 6) / 18));
  // y: 濃淡，用酸度近似（1.0→淡麗, 2.0→濃醇）。高酸在下（濃醇）
  const y = isNaN(acidity) ? 0.5 : Math.max(0, Math.min(1, (acidity - 0.8) / 1.4));

  const px = 20 + x * (size - 40);
  const py = 20 + y * (size - 40);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      <svg width={size} height={size} style={{ overflow: "visible" }}>
        {/* 象限背景 */}
        <defs>
          <radialGradient id="tmGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(201,146,42,0.15)" />
            <stop offset="100%" stopColor="rgba(201,146,42,0)" />
          </radialGradient>
        </defs>
        <rect x="20" y="20" width={size - 40} height={size - 40} fill="url(#tmGlow)" rx="8" />
        <rect x="20" y="20" width={size - 40} height={size - 40} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="1" rx="8" />

        {/* 十字軸 */}
        <line x1={size / 2} y1="20" x2={size / 2} y2={size - 20} stroke="rgba(255,255,255,0.08)" strokeWidth="1" strokeDasharray="3 3" />
        <line x1="20" y1={size / 2} x2={size - 20} y2={size / 2} stroke="rgba(255,255,255,0.08)" strokeWidth="1" strokeDasharray="3 3" />

        {/* 軸標籤 */}
        <text x={size / 2} y="13" textAnchor="middle" fontSize="9" fill="#888" fontFamily="'Shippori Mincho',serif">淡麗</text>
        <text x={size / 2} y={size - 6} textAnchor="middle" fontSize="9" fill="#888" fontFamily="'Shippori Mincho',serif">濃醇</text>
        <text x="6" y={size / 2 + 3} textAnchor="middle" fontSize="9" fill="#888" fontFamily="'Shippori Mincho',serif" transform={`rotate(-90 6 ${size / 2})`}>甘口</text>
        <text x={size - 6} y={size / 2 + 3} textAnchor="middle" fontSize="9" fill="#888" fontFamily="'Shippori Mincho',serif" transform={`rotate(90 ${size - 6} ${size / 2})`}>辛口</text>

        {/* 定位點 */}
        <circle cx={px} cy={py} r="9" fill="rgba(201,146,42,0.25)" />
        <circle cx={px} cy={py} r="5" fill="#e8b84b" />
        <circle cx={px} cy={py} r="5" fill="none" stroke="#fff" strokeWidth="1" opacity="0.6" />
      </svg>

      <div style={{ display: "flex", gap: 12, fontSize: 10, color: "#999" }}>
        {!isNaN(smv) && <span>日本酒度 <b style={{ color: "#d4a843" }}>{smv > 0 ? "+" : ""}{smv}</b></span>}
        {!isNaN(acidity) && <span>酸度 <b style={{ color: "#d4a843" }}>{acidity}</b></span>}
      </div>
    </div>
  );
}
