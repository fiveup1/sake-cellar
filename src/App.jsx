import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { fetchSakes, insertSake, updateSake, deleteSake, hasSupabase } from "./lib/db";
import { analyzeImage, compressImage } from "./lib/analyze";
import { extractExif, reverseGeocode } from "./lib/exif";
import { buildTidyCollage, buildScatteredCollage, downloadDataUrl } from "./lib/collage";
import TasteMap from "./components/TasteMap";
import TempScale from "./components/TempScale";

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// 酒種顏色
const catColor = (cat) => {
  if (cat === "日本酒") return "#c9922a";
  if (cat === "ワイン") return "#9c3b4f";
  return "#7a6a4a";
};

export default function App() {
  const [sakes, setSakes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("cellar");
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("全部");
  const [sortBy, setSortBy] = useState("new");
  const [selected, setSelected] = useState(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [detail, setDetail] = useState(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const fileRef = useRef();

  // 載入資料
  useEffect(() => {
    fetchSakes().then(data => { setSakes(data); setLoading(false); });
  }, []);

  // ── 篩選 / 排序 ──
  const cats = useMemo(() => ["全部", ...new Set(sakes.map(s => s.info?.category).filter(Boolean))], [sakes]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = sakes.filter(s => {
      const i = s.info || {};
      const matchQ = !q || [i.name, i.name_kana, i.brewery, i.region, i.rice, i.tokutei, i.grapes, ...(i.tags || [])]
        .filter(Boolean).some(v => String(v).toLowerCase().includes(q));
      const matchCat = filterCat === "全部" || i.category === filterCat;
      return matchQ && matchCat;
    });
    if (sortBy === "new") list = [...list].sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));
    if (sortBy === "name") list = [...list].sort((a, b) => (a.info?.name || "").localeCompare(b.info?.name || "", "ja"));
    if (sortBy === "brewery") list = [...list].sort((a, b) => (a.info?.brewery || "").localeCompare(b.info?.brewery || "", "ja"));
    return list;
  }, [sakes, search, filterCat, sortBy]);

  // ── 匯入 ──
  const handleImport = useCallback(async (files) => {
    const arr = Array.from(files).filter(f => f.type.startsWith("image/"));
    if (!arr.length) return;
    setImporting(true);
    setTab("cellar");
    setProgress({ done: 0, total: arr.length });

    for (let i = 0; i < arr.length; i++) {
      const id = uid();
      try {
        // 先讀原始檔的 EXIF（拍攝日期 + GPS），務必在壓縮前讀，壓縮會清掉 EXIF
        const exif = await extractExif(arr[i]);
        let photoDate = exif.date || null;
        let location = null;
        if (exif.lat != null && exif.lng != null) {
          location = await reverseGeocode(exif.lat, exif.lng);
        }

        const { blob, dataUrl, base64 } = await compressImage(arr[i]);
        // 先放佔位卡
        const placeholder = { id, imageUrl: dataUrl, imageBlob: blob, info: null, status: "analyzing", addedAt: new Date().toISOString(), photoDate, location };
        setSakes(prev => [placeholder, ...prev]);

        const info = await analyzeImage(base64, "image/jpeg");
        // 把拍攝日期與地點併入 info，方便顯示與儲存
        const enrichedInfo = info ? { ...info, photo_date: photoDate, location } : info;
        const finished = { ...placeholder, info: enrichedInfo, status: info ? "done" : "error" };

        // 存到 DB（Supabase 會上傳圖片並回傳公開 URL）
        const saved = await insertSake(finished);
        setSakes(prev => prev.map(s => s.id === id ? { ...finished, imageUrl: saved.imageUrl || dataUrl, imageBlob: undefined } : s));
      } catch (e) {
        setSakes(prev => prev.map(s => s.id === id ? { ...s, status: "error" } : s));
      }
      setProgress({ done: i + 1, total: arr.length });
    }
    setImporting(false);
  }, []);

  // ── 選取 ──
  const toggleSelect = (id) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectAll = () => setSelected(new Set(filtered.map(s => s.id)));
  const clearSelect = () => { setSelected(new Set()); setSelectMode(false); };

  // ── 刪除 ──
  const handleDelete = async (id) => {
    await deleteSake(id);
    setSakes(prev => prev.filter(s => s.id !== id));
    setSelected(s => { const n = new Set(s); n.delete(id); return n; });
  };

  const gold = "#c9922a";

  return (
    <div style={{ maxWidth: 460, margin: "0 auto", minHeight: "100dvh", display: "flex", flexDirection: "column", position: "relative" }}>

      {/* ─── Header ─── */}
      <header style={{ padding: "max(20px, env(safe-area-inset-top)) 20px 14px", background: "linear-gradient(180deg, #170f05, transparent)", position: "sticky", top: 0, zIndex: 20, backdropFilter: "blur(8px)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div className="mincho" style={{ fontSize: 26, fontWeight: 800, color: gold, letterSpacing: 4, lineHeight: 1 }}>酒蔵録</div>
            <div style={{ fontSize: 10, color: "#6a5d45", letterSpacing: 3, marginTop: 5 }}>SAKE CELLAR · 蔵 {sakes.length} 本</div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {!hasSupabase && (
              <span style={{ fontSize: 9, color: "#8a6a3a", background: "rgba(201,146,42,0.1)", padding: "3px 7px", borderRadius: 6, border: "1px solid rgba(201,146,42,0.2)" }}>本機模式</span>
            )}
            <div className="mincho" style={{ width: 46, height: 46, background: "rgba(201,146,42,0.1)", border: "1px solid rgba(201,146,42,0.25)", borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, color: gold }}>盃</div>
          </div>
        </div>
      </header>

      {/* ─── Body ─── */}
      <main className="no-scrollbar" style={{ flex: 1, overflowY: "auto", padding: "4px 16px 90px" }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: "80px 0", color: "#555" }}>
            <div style={{ width: 32, height: 32, border: `3px solid ${gold}33`, borderTop: `3px solid ${gold}`, borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto" }} />
          </div>
        ) : (
          <>
            {tab === "cellar" && (
              <CellarView
                sakes={sakes} filtered={filtered} cats={cats}
                search={search} setSearch={setSearch}
                filterCat={filterCat} setFilterCat={setFilterCat}
                sortBy={sortBy} setSortBy={setSortBy}
                selected={selected} selectMode={selectMode} setSelectMode={setSelectMode}
                toggleSelect={toggleSelect} selectAll={selectAll} clearSelect={clearSelect}
                onOpen={setDetail} onGoImport={() => setTab("import")} onGoCollage={() => setTab("collage")}
                importing={importing} progress={progress}
              />
            )}
            {tab === "import" && (
              <ImportView fileRef={fileRef} onImport={handleImport} importing={importing} progress={progress} />
            )}
            {tab === "collage" && (
              <CollageView sakes={sakes} selected={selected} setSelected={setSelected} setSelectMode={setSelectMode} goCellar={() => setTab("cellar")} />
            )}
          </>
        )}
      </main>

      {/* ─── Bottom Nav ─── */}
      <nav style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 460, background: "rgba(10,6,2,0.92)", backdropFilter: "blur(20px)", borderTop: "1px solid var(--line)", display: "flex", paddingBottom: "env(safe-area-inset-bottom)" }}>
        {[
          { k: "cellar", icon: "蔵", label: "酒窖" },
          { k: "import", icon: "入", label: "匯入" },
          { k: "collage", icon: "繪", label: "拼接" },
        ].map(t => (
          <button key={t.k} onClick={() => setTab(t.k)} style={{
            flex: 1, padding: "11px 4px 9px", background: "none", border: "none",
            color: tab === t.k ? gold : "#5a5042",
            borderTop: `2px solid ${tab === t.k ? gold : "transparent"}`,
            display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
          }}>
            <span className="mincho" style={{ fontSize: 19, fontWeight: 600 }}>{t.icon}</span>
            <span style={{ fontSize: 10, letterSpacing: 1 }}>{t.label}</span>
          </button>
        ))}
      </nav>

      {detail && <DetailSheet sake={detail} onClose={() => setDetail(null)} onDelete={handleDelete} />}
    </div>
  );
}

// ═══════════════════════════ 酒窖 ═══════════════════════════
function CellarView(props) {
  const { sakes, filtered, cats, search, setSearch, filterCat, setFilterCat, sortBy, setSortBy,
    selected, selectMode, setSelectMode, toggleSelect, selectAll, clearSelect, onOpen, onGoImport, onGoCollage, importing, progress } = props;
  const gold = "#c9922a";
  const [showSort, setShowSort] = useState(false);
  const sortLabels = { new: "最新加入", name: "酒名", brewery: "酒造" };

  return (
    <div className="fade-in">
      {/* 搜尋列 */}
      <div style={{ position: "relative", marginBottom: 10 }}>
        <span style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", color: "#5a5042", fontSize: 14 }}>🔍</span>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜尋 酒名 · 酒造 · 産地 · 酒米 · 銘柄"
          style={{ width: "100%", background: "rgba(255,255,255,0.05)", border: "1px solid var(--line)", borderRadius: 12, padding: "11px 14px 11px 38px", color: "var(--ink)", fontSize: 13, outline: "none" }} />
      </div>

      {/* 分類 + 排序 */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <div className="no-scrollbar" style={{ display: "flex", gap: 7, overflowX: "auto", flex: 1 }}>
          {cats.map(c => (
            <button key={c} onClick={() => setFilterCat(c)} style={{
              whiteSpace: "nowrap", padding: "6px 13px", borderRadius: 99, fontSize: 12,
              background: filterCat === c ? gold : "rgba(255,255,255,0.05)",
              border: filterCat === c ? "none" : "1px solid var(--line)",
              color: filterCat === c ? "#0e0a06" : "#999", fontWeight: filterCat === c ? 600 : 400,
            }}>{c}</button>
          ))}
        </div>
        <button onClick={() => setShowSort(v => !v)} style={{ background: "rgba(255,255,255,0.05)", border: "1px solid var(--line)", borderRadius: 10, padding: "7px 10px", color: "#999", fontSize: 11, whiteSpace: "nowrap" }}>
          ↕ {sortLabels[sortBy]}
        </button>
      </div>
      {showSort && (
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          {Object.entries(sortLabels).map(([k, v]) => (
            <button key={k} onClick={() => { setSortBy(k); setShowSort(false); }} style={{
              flex: 1, padding: "8px", borderRadius: 9, fontSize: 12,
              background: sortBy === k ? "rgba(201,146,42,0.2)" : "rgba(255,255,255,0.04)",
              border: `1px solid ${sortBy === k ? "rgba(201,146,42,0.4)" : "var(--line)"}`,
              color: sortBy === k ? gold : "#888",
            }}>{v}</button>
          ))}
        </div>
      )}

      {/* 匯入進度 */}
      {importing && (
        <div style={{ background: "rgba(201,146,42,0.08)", border: "1px solid rgba(201,146,42,0.2)", borderRadius: 12, padding: 13, marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 7, fontSize: 12 }}>
            <span style={{ color: gold }}>AI 辨識中…</span>
            <span style={{ color: "#888" }}>{progress.done}/{progress.total}</span>
          </div>
          <div style={{ background: "rgba(255,255,255,0.08)", borderRadius: 99, height: 5 }}>
            <div style={{ height: "100%", background: `linear-gradient(90deg,${gold},#e8b84b)`, borderRadius: 99, width: `${(progress.done / progress.total) * 100}%`, transition: "width .3s" }} />
          </div>
        </div>
      )}

      {/* 選取工具列 */}
      {(selectMode || selected.size > 0) && (
        <div style={{ background: "rgba(201,146,42,0.12)", border: "1px solid rgba(201,146,42,0.25)", borderRadius: 12, padding: "9px 13px", marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 13, color: gold }}>已選 {selected.size}</span>
          <div style={{ display: "flex", gap: 12 }}>
            <button onClick={selectAll} style={{ background: "none", border: "none", color: "#aaa", fontSize: 12 }}>全選</button>
            <button onClick={clearSelect} style={{ background: "none", border: "none", color: "#aaa", fontSize: 12 }}>取消</button>
            {selected.size > 0 && <button onClick={onGoCollage} style={{ background: gold, border: "none", color: "#0e0a06", borderRadius: 8, padding: "4px 13px", fontSize: 12, fontWeight: 600 }}>製作拼接</button>}
          </div>
        </div>
      )}

      {/* 空狀態 */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "70px 20px", color: "#4a4236" }}>
          <div className="mincho" style={{ fontSize: 52, marginBottom: 18, color: "#3a3025" }}>蔵</div>
          <div style={{ fontSize: 14, marginBottom: 6 }}>{sakes.length === 0 ? "酒窖還是空的" : "找不到符合的酒"}</div>
          {sakes.length === 0 && (
            <>
              <div style={{ fontSize: 12, color: "#666", marginBottom: 20 }}>從相簿匯入你的酒瓶照片開始記錄</div>
              <button onClick={onGoImport} style={{ background: gold, border: "none", color: "#0e0a06", borderRadius: 11, padding: "11px 28px", fontSize: 13, fontWeight: 600 }}>匯入照片</button>
            </>
          )}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {filtered.map(s => (
            <SakeCard key={s.id} sake={s} selected={selected.has(s.id)}
              selectMode={selectMode || selected.size > 0}
              onSelect={toggleSelect} onOpen={onOpen} onLongPress={() => setSelectMode(true)} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── 酒卡 ──
function SakeCard({ sake, selected, selectMode, onSelect, onOpen, onLongPress }) {
  const i = sake.info || {};
  const color = catColor(i.category);
  const pressTimer = useRef();

  const start = () => { pressTimer.current = setTimeout(onLongPress, 500); };
  const cancel = () => clearTimeout(pressTimer.current);

  return (
    <div
      onClick={() => selectMode ? onSelect(sake.id) : onOpen(sake)}
      onTouchStart={start} onTouchEnd={cancel} onTouchMove={cancel}
      style={{
        background: selected ? "rgba(201,146,42,0.16)" : "rgba(255,255,255,0.035)",
        border: `1px solid ${selected ? gold : "var(--line)"}`,
        borderRadius: 14, overflow: "hidden", position: "relative", transition: "all .18s",
      }}
    >
      {selectMode && (
        <div onClick={e => { e.stopPropagation(); onSelect(sake.id); }} style={{ position: "absolute", top: 8, left: 8, zIndex: 3, width: 22, height: 22, borderRadius: 7, background: selected ? gold : "rgba(0,0,0,0.55)", border: `1.5px solid ${selected ? gold : "rgba(255,255,255,0.4)"}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {selected && <span style={{ color: "#fff", fontSize: 12, fontWeight: 700 }}>✓</span>}
        </div>
      )}

      <div style={{ aspectRatio: "3/4", overflow: "hidden", background: "#0a0704", position: "relative" }}>
        {sake.imageUrl && <img src={sake.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
        {sake.status === "analyzing" && (
          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.65)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <div style={{ width: 26, height: 26, border: `2.5px solid ${gold}44`, borderTop: `2.5px solid ${gold}`, borderRadius: "50%", animation: "spin 1s linear infinite" }} />
            <span style={{ fontSize: 10, color: gold }}>辨識中</span>
          </div>
        )}
        {sake.status === "error" && (
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "rgba(180,50,50,0.85)", fontSize: 9, color: "#fff", textAlign: "center", padding: "3px" }}>辨識失敗 · 點擊重看</div>
        )}
        {/* 類別標 */}
        {i.category && (
          <div className="mincho" style={{ position: "absolute", top: 8, right: 8, fontSize: 10, background: `${color}dd`, color: "#fff", padding: "2px 8px", borderRadius: 99, fontWeight: 600 }}>{i.category}</div>
        )}
      </div>

      <div style={{ padding: "9px 11px 11px" }}>
        {i.tokutei && <div style={{ fontSize: 9, color: gold, marginBottom: 3, letterSpacing: 0.5 }}>{i.tokutei}</div>}
        <div className="mincho" style={{ fontSize: 13, color: "var(--ink)", fontWeight: 600, lineHeight: 1.3, marginBottom: 3, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", minHeight: 34 }}>
          {i.name || (sake.status === "analyzing" ? "…" : "未知")}
        </div>
        <div style={{ fontSize: 10.5, color: "#8a7a5a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i.brewery || ""}</div>
        <div style={{ fontSize: 10, color: "#665a44" }}>{i.region || ""}{i.seimai ? ` · 精米${i.seimai}` : ""}</div>
        {(sake.photoDate || i.photo_date) && (
          <div style={{ fontSize: 9.5, color: "#554a38", marginTop: 2 }}>📅 {sake.photoDate || i.photo_date}</div>
        )}
      </div>
    </div>
  );
}

const gold = "#c9922a";

// ═══════════════════════════ 匯入 ═══════════════════════════
function ImportView({ fileRef, onImport, importing, progress }) {
  return (
    <div className="fade-in">
      <div style={{ marginBottom: 22 }}>
        <div className="mincho" style={{ fontSize: 20, color: gold, marginBottom: 6 }}>匯入照片</div>
        <div style={{ fontSize: 12, color: "#777", lineHeight: 1.6 }}>從相簿選擇酒瓶照片，AI 自動辨識酒標、查詢風味與搭配建議</div>
      </div>

      <div onClick={() => fileRef.current?.click()} style={{ border: `2px dashed rgba(201,146,42,0.3)`, borderRadius: 18, padding: "46px 20px", textAlign: "center", background: "rgba(201,146,42,0.04)" }}>
        <div className="mincho" style={{ fontSize: 44, color: gold, marginBottom: 14 }}>入</div>
        <div style={{ fontSize: 14, color: gold, marginBottom: 6 }}>從相簿選擇照片</div>
        <div style={{ fontSize: 11.5, color: "#5a5042" }}>支援多選 · 一次可匯入數千張</div>
        <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={e => onImport(e.target.files)} />
      </div>

      {importing && (
        <div style={{ marginTop: 20, background: "rgba(201,146,42,0.08)", border: "1px solid rgba(201,146,42,0.2)", borderRadius: 12, padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 13 }}>
            <span style={{ color: gold }}>AI 辨識中…</span>
            <span style={{ color: "#888" }}>{progress.done}/{progress.total}</span>
          </div>
          <div style={{ background: "rgba(255,255,255,0.08)", borderRadius: 99, height: 6 }}>
            <div style={{ height: "100%", background: `linear-gradient(90deg,${gold},#e8b84b)`, borderRadius: 99, width: `${(progress.done / progress.total) * 100}%`, transition: "width .3s" }} />
          </div>
          <div style={{ fontSize: 11, color: "#5a5042", marginTop: 8 }}>可切換到酒窖即時查看辨識結果</div>
        </div>
      )}

      <div style={{ marginTop: 24, padding: 16, background: "rgba(255,255,255,0.03)", borderRadius: 12 }}>
        <div style={{ fontSize: 12, color: "#888", lineHeight: 1.9 }}>
          <strong style={{ color: gold }}>辨識小提示</strong><br />
          ・ 酒標清晰、正面朝鏡頭，辨識最準<br />
          ・ 日本酒會擷取：特定名稱、精米歩合、日本酒度、酸度、酒米<br />
          ・ 葡萄酒會擷取：品種、年份、產區、甜度<br />
          ・ 每張約需 3–6 秒，可放著批次處理
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════ 拼接 ═══════════════════════════
function CollageView({ sakes, selected, setSelected, setSelectMode, goCellar }) {
  const [layout, setLayout] = useState("tidy");
  const [result, setResult] = useState(null);
  const [building, setBuilding] = useState(false);
  const [seed, setSeed] = useState(1);

  const chosen = sakes.filter(s => selected.has(s.id) && s.imageUrl);

  const build = useCallback(async () => {
    if (chosen.length === 0) return;
    setBuilding(true);
    setResult(null);
    const urls = chosen.map(s => s.imageUrl);
    try {
      const dataUrl = layout === "tidy"
        ? await buildTidyCollage(urls)
        : await buildScatteredCollage(urls, { seed });
      setResult(dataUrl);
    } catch (e) { console.error(e); }
    setBuilding(false);
  }, [chosen, layout, seed]);

  // 切換版面自動重建
  useEffect(() => { if (chosen.length > 0) build(); /* eslint-disable-next-line */ }, [layout, seed]);

  return (
    <div className="fade-in">
      <div style={{ marginBottom: 18 }}>
        <div className="mincho" style={{ fontSize: 20, color: gold, marginBottom: 6 }}>照片拼接</div>
        <div style={{ fontSize: 12, color: "#777" }}>
          {chosen.length > 0 ? `已選 ${chosen.length} 張 · 正方形輸出` : "請先到酒窖選擇照片"}
        </div>
      </div>

      {chosen.length === 0 ? (
        <div style={{ textAlign: "center", padding: "50px 20px", color: "#4a4236" }}>
          <div className="mincho" style={{ fontSize: 46, color: "#3a3025", marginBottom: 14 }}>繪</div>
          <div style={{ fontSize: 13, marginBottom: 18 }}>到酒窖長按或點選照片，挑選要拼接的酒</div>
          <button onClick={() => { setSelectMode(true); goCellar(); }} style={{ background: gold, border: "none", color: "#0e0a06", borderRadius: 11, padding: "11px 26px", fontSize: 13, fontWeight: 600 }}>前往酒窖選擇</button>
        </div>
      ) : (
        <>
          {/* 版面切換 */}
          <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
            {[
              { k: "tidy", label: "整齊式", desc: "對稱網格", icon: "▦" },
              { k: "scattered", label: "散亂式", desc: "拍立得隨機", icon: "❖" },
            ].map(o => (
              <button key={o.k} onClick={() => setLayout(o.k)} style={{
                flex: 1, padding: "14px 10px", borderRadius: 13, textAlign: "center",
                background: layout === o.k ? "rgba(201,146,42,0.16)" : "rgba(255,255,255,0.04)",
                border: `1.5px solid ${layout === o.k ? gold : "var(--line)"}`,
                color: layout === o.k ? gold : "#888",
              }}>
                <div style={{ fontSize: 22, marginBottom: 5 }}>{o.icon}</div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{o.label}</div>
                <div style={{ fontSize: 10, color: "#665a44", marginTop: 2 }}>{o.desc}</div>
              </button>
            ))}
          </div>

          {/* 預覽 */}
          <div style={{ aspectRatio: "1", borderRadius: 14, overflow: "hidden", background: "#0a0704", border: "1px solid var(--line)", marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
            {building && (
              <div style={{ textAlign: "center" }}>
                <div style={{ width: 30, height: 30, border: `3px solid ${gold}33`, borderTop: `3px solid ${gold}`, borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto 10px" }} />
                <span style={{ fontSize: 12, color: gold }}>合成中…</span>
              </div>
            )}
            {!building && result && <img src={result} alt="collage" style={{ width: "100%", height: "100%", objectFit: "contain" }} />}
          </div>

          {/* 操作 */}
          <div style={{ display: "flex", gap: 10 }}>
            {layout === "scattered" && (
              <button onClick={() => setSeed(s => s + 1)} style={{ padding: "13px 16px", background: "rgba(255,255,255,0.05)", border: "1px solid var(--line)", borderRadius: 12, color: "#aaa", fontSize: 13 }}>🎲 換排列</button>
            )}
            <button disabled={!result || building} onClick={() => downloadDataUrl(result, `sake-cellar-${layout}-${Date.now()}.jpg`)} style={{ flex: 1, background: result && !building ? `linear-gradient(135deg,${gold},#e8b84b)` : "#333", border: "none", color: result && !building ? "#0e0a06" : "#666", borderRadius: 12, padding: "13px", fontSize: 14, fontWeight: 700 }}>
              ⬇ 儲存拼接圖
            </button>
          </div>
          <div style={{ fontSize: 11, color: "#5a5042", textAlign: "center", marginTop: 12 }}>
            儲存後可長按圖片存到相簿，或直接分享
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════ 詳情 ═══════════════════════════
function DetailSheet({ sake, onClose, onDelete }) {
  const i = sake.info || {};
  const isSake = i.category === "日本酒";
  const color = catColor(i.category);

  const sakeRows = [
    ["精米步合", i.seimai], ["使用酒米", i.rice], ["使用酵母", i.yeast],
    ["酒精濃度", i.alcohol], ["甘辛度", i.sweetness],
  ].filter(([, v]) => v);

  const wineRows = [
    ["品種", i.grapes], ["年份", i.vintage], ["甜度", i.sweetness],
    ["酒精濃度", i.alcohol],
  ].filter(([, v]) => v);

  const rows = isSake ? sakeRows : wineRows;

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#15100a", borderRadius: "22px 22px 0 0", maxWidth: 460, width: "100%", maxHeight: "92dvh", overflowY: "auto", animation: "slideUp .3s cubic-bezier(0.2,0.8,0.2,1)", paddingBottom: "env(safe-area-inset-bottom)" }} className="no-scrollbar">
        {/* 頂部固定列：返回鍵 + 抓桿 */}
        <div style={{ position: "sticky", top: 0, paddingTop: 10, paddingBottom: 8, background: "linear-gradient(180deg,#15100a 80%,transparent)", zIndex: 5 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", position: "relative", paddingLeft: 16, paddingRight: 16 }}>
            <button
              onClick={onClose}
              style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", display: "flex", alignItems: "center", gap: 4, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", color: "var(--ink)", borderRadius: 99, padding: "7px 14px 7px 10px", fontSize: 13, fontWeight: 500 }}
            >
              <span style={{ fontSize: 16, lineHeight: 1 }}>‹</span> 返回
            </button>
            <div style={{ width: 40, height: 4, background: "#3a3025", borderRadius: 99 }} />
            <button
              onClick={onClose}
              style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", color: "#aaa", borderRadius: 99, fontSize: 15 }}
            >
              ✕
            </button>
          </div>
        </div>

        {sake.imageUrl && (
          <div style={{ padding: "8px 16px 0" }}>
            <div style={{ borderRadius: 14, overflow: "hidden", maxHeight: 280, display: "flex", justifyContent: "center", background: "#0a0704" }}>
              <img src={sake.imageUrl} alt="" style={{ width: "100%", objectFit: "contain", maxHeight: 280 }} />
            </div>
          </div>
        )}

        <div style={{ padding: "16px 20px 28px" }}>
          {/* 標題區 */}
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 10 }}>
            <span className="mincho" style={{ fontSize: 11, background: color, color: "#fff", padding: "3px 11px", borderRadius: 99, fontWeight: 600 }}>{i.category || "酒"}</span>
            {i.tokutei && <span style={{ fontSize: 11, background: "rgba(201,146,42,0.18)", color: gold, padding: "3px 11px", borderRadius: 99 }}>{i.tokutei}</span>}
            {(i.tags || []).map((t, x) => <span key={x} style={{ fontSize: 11, background: "rgba(255,255,255,0.06)", color: "#aaa", padding: "3px 11px", borderRadius: 99 }}>{t}</span>)}
          </div>

          <div className="mincho" style={{ fontSize: 21, color: "var(--ink)", fontWeight: 700, lineHeight: 1.35, marginBottom: 3 }}>{i.name || "未知酒款"}</div>
          {i.name_kana && <div style={{ fontSize: 12, color: "#7a6a4a", marginBottom: 6 }}>{i.name_kana}</div>}
          <div style={{ fontSize: 13, color: gold, marginBottom: 12 }}>{[i.brewery, i.region].filter(Boolean).join(" · ")}</div>

          {/* 拍攝日期 + 地點 */}
          {(sake.photoDate || sake.location || i.photo_date || i.location) && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
              {(sake.photoDate || i.photo_date) && (
                <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, background: "rgba(255,255,255,0.05)", color: "#bba080", padding: "5px 11px", borderRadius: 99 }}>
                  📅 {sake.photoDate || i.photo_date}
                </span>
              )}
              {(sake.location || i.location) && (
                <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, background: "rgba(255,255,255,0.05)", color: "#bba080", padding: "5px 11px", borderRadius: 99 }}>
                  📍 {sake.location || i.location}
                </span>
              )}
            </div>
          )}

          {/* 風味 */}
          {i.flavors && (
            <div style={{ background: "rgba(201,146,42,0.07)", border: "1px solid rgba(201,146,42,0.15)", borderRadius: 12, padding: "13px 15px", marginBottom: 16 }}>
              <div style={{ fontSize: 10, color: gold, letterSpacing: 1.5, marginBottom: 5 }}>味わい / TASTING</div>
              <div style={{ fontSize: 13, color: "#d0c0a0", lineHeight: 1.7 }}>{i.flavors}</div>
            </div>
          )}

          {/* 味わいMAP（日本酒專屬） */}
          {isSake && (i.sake_meter || i.acidity) && (
            <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 12, padding: "16px", marginBottom: 16, display: "flex", justifyContent: "center" }}>
              <TasteMap info={i} />
            </div>
          )}

          {/* 溫度帶 */}
          {i.temps && i.temps.length > 0 && (
            <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 11, color: "#888", marginBottom: 10 }}>🌡️ 適飲溫度{i.best_temp ? `（推薦 ${i.best_temp}）` : ""}</div>
              {isSake ? <TempScale temps={i.temps} best={i.best_temp} /> : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {i.temps.map((t, x) => <span key={x} style={{ fontSize: 12, background: "rgba(91,168,211,0.15)", color: "#7bb8d3", padding: "4px 11px", borderRadius: 99, border: "1px solid rgba(91,168,211,0.3)" }}>{t}</span>)}
                </div>
              )}
            </div>
          )}

          {/* 規格表 */}
          {rows.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
              {rows.map(([k, v]) => (
                <div key={k} style={{ background: "rgba(255,255,255,0.04)", borderRadius: 10, padding: "10px 12px" }}>
                  <div style={{ fontSize: 10, color: "#665a44", marginBottom: 3 }}>{k}</div>
                  <div className="mincho" style={{ fontSize: 14, color: "var(--ink)", fontWeight: 600 }}>{v}</div>
                </div>
              ))}
            </div>
          )}

          {/* 酒器 */}
          {i.vessel && (
            <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "11px 14px", background: "rgba(255,255,255,0.03)", borderRadius: 10, marginBottom: 12 }}>
              <span style={{ fontSize: 18 }}>🥂</span>
              <div>
                <div style={{ fontSize: 10, color: "#665a44" }}>建議酒器</div>
                <div style={{ fontSize: 13, color: "var(--ink)" }}>{i.vessel}</div>
              </div>
            </div>
          )}

          {/* 搭餐 */}
          {i.food_pairing && (
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "11px 14px", background: "rgba(255,255,255,0.03)", borderRadius: 10, marginBottom: 18 }}>
              <span style={{ fontSize: 18 }}>🍽️</span>
              <div>
                <div style={{ fontSize: 10, color: "#665a44", marginBottom: 2 }}>搭配建議</div>
                <div style={{ fontSize: 13, color: "var(--ink)", lineHeight: 1.6 }}>{i.food_pairing}</div>
              </div>
            </div>
          )}

          <div style={{ fontSize: 11, color: "#4a4236", marginBottom: 14 }}>記錄於 {new Date(sake.addedAt).toLocaleDateString("zh-TW")}</div>

          <button onClick={() => { if (confirm("確定刪除這瓶酒的記錄？")) { onDelete(sake.id); onClose(); } }} style={{ width: "100%", background: "rgba(183,58,50,0.12)", border: "1px solid rgba(183,58,50,0.3)", color: "#d96a62", borderRadius: 11, padding: "11px", fontSize: 13 }}>刪除此記錄</button>
        </div>
      </div>
    </div>
  );
}
