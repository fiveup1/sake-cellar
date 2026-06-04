// 溫度帶顯示 — 雪冷 → 熱燗

const BANDS = [
  { key: "雪冷", temp: 5, color: "#4a90d9", label: "雪冷" },
  { key: "花冷", temp: 10, color: "#5fa8d3", label: "花冷" },
  { key: "涼冷", temp: 15, color: "#7bb8c4", label: "涼冷" },
  { key: "常溫", temp: 20, color: "#9c9c7a", label: "常溫" },
  { key: "日向溫", temp: 30, color: "#d4a843", label: "日向溫" },
  { key: "人肌溫", temp: 35, color: "#d4923a", label: "人肌溫" },
  { key: "微溫", temp: 40, color: "#c97a2a", label: "微溫" },
  { key: "上溫", temp: 45, color: "#c25e22", label: "上溫" },
  { key: "熱燗", temp: 50, color: "#b73a32", label: "熱燗" },
];

function matchBand(tempStr) {
  if (!tempStr) return false;
  return BANDS.some(b => tempStr.includes(b.key)) ;
}

export default function TempScale({ temps = [], best }) {
  if (!temps || temps.length === 0) return null;

  const isActive = (band) => temps.some(t => t.includes(band.key)) || (best && best.includes(band.key));
  const isBest = (band) => best && best.includes(band.key);

  return (
    <div style={{ width: "100%" }}>
      <div style={{ display: "flex", gap: 3, borderRadius: 8, overflow: "hidden" }}>
        {BANDS.map((b) => {
          const active = isActive(b);
          const best_ = isBest(b);
          return (
            <div
              key={b.key}
              style={{
                flex: 1,
                height: best_ ? 38 : 30,
                background: active ? b.color : "rgba(255,255,255,0.05)",
                opacity: active ? 1 : 0.3,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                position: "relative",
                transition: "all .2s",
                borderRadius: 4,
                border: best_ ? "1.5px solid #fff" : "none",
              }}
              title={`${b.label} ${b.temp}℃`}
            >
              {best_ && (
                <span style={{ fontSize: 8, color: "#fff", fontWeight: 700, writingMode: "horizontal-tb" }}>★</span>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 9, color: "#777" }}>
        <span>❄️ 5℃</span>
        <span>常温 20℃</span>
        <span>🔥 50℃</span>
      </div>
      {/* 啟用的溫度帶文字 */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 8 }}>
        {BANDS.filter(isActive).map(b => (
          <span key={b.key} style={{
            fontSize: 10, padding: "2px 8px", borderRadius: 99,
            background: isBest(b) ? b.color : `${b.color}33`,
            color: isBest(b) ? "#fff" : b.color,
            border: isBest(b) ? "none" : `1px solid ${b.color}66`,
            fontWeight: isBest(b) ? 700 : 400,
          }}>
            {isBest(b) && "★ "}{b.label} {b.temp}℃
          </span>
        ))}
      </div>
    </div>
  );
}
