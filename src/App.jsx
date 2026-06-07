import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { fetchSakes, fetchAllSakes, insertSake, updateSake, deleteSake, hasSupabase, uploadBackImage, createShareToken, getShareToken, deleteShareToken, fetchSakesPublic, fetchAllSakesPublic, verifyShareToken } from "./lib/db";
import { analyzeImage, compressImage, urlToBase64 } from "./lib/analyze";
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
  // ── 分享頁路由：URL 是 /share/xxx 就直接顯示唯讀酒窖 ──
  // 注意：這裡不能提早 return（React hooks 規則），改用 AppInner 包裝
  const shareMatch = typeof window !== "undefined" && window.location.pathname.match(/^\/share\/([a-f0-9-]{36})$/i);
  if (shareMatch) {
    return <SharedCellar token={shareMatch[1]} />;
  }
  return <AppInner />;
}

function AppInner() {
  const [sakes, setSakes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("cellar");
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("全部");
  const [sortBy, setSortBy] = useState("time-desc");
  const [selected, setSelected] = useState(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [detail, setDetail] = useState(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [hasMore, setHasMore] = useState(true);
  const [bgLoading, setBgLoading] = useState(false); // 背景預載中
  const PAGE = 20;
  const abortImportRef = useRef(false);
  const scrollRef = useRef(null);
  const scrubRef = useRef(null);
  const isDragging = useRef(false);
  const onScrubMove = (clientY) => {
    if (!scrollRef.current || !scrubRef.current) return;
    const track = scrubRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientY - track.top) / track.height));
    const el = scrollRef.current;
    el.scrollTop = ratio * (el.scrollHeight - el.clientHeight);
  };
  const importingRef = useRef(false);      // 匯入中時暫停背景預載
  const bgStopRef = useRef(false);         // 卸載時停止背景預載
  const fileRef = useRef();

  // 初次載入：固定 5 秒內盡量載（至少 20 筆保底），時間到才進酒窖
  useEffect(() => {
    let cancelled = false;
    const INITIAL_MS = 5000;

    (async () => {
      const start = Date.now();
      let buffer = [];
      let offset = 0;
      let more = true;

      // 5 秒內連續載入；但至少要載到第一批（20 筆）才結束
      while (!cancelled && more) {
        let batch = [];
        try {
          batch = await fetchSakes({ limit: PAGE, offset });
        } catch { batch = []; }
        buffer = buffer.concat(batch);
        offset += batch.length;
        more = batch.length === PAGE;

        const elapsed = Date.now() - start;
        // 結束條件：時間到且至少有一批（或沒有更多了）
        if ((elapsed >= INITIAL_MS && buffer.length >= PAGE) || !more) break;
        // 還沒到 5 秒就全速續載（不間隔）
      }

      if (cancelled) return;
      // 補足動畫至少播放 5 秒（避免網路太快動畫一閃而過）
      const remain = INITIAL_MS - (Date.now() - start);
      if (remain > 0) await new Promise(r => setTimeout(r, remain));
      if (cancelled) return;

      setSakes(buffer);
      setHasMore(more);
      setLoading(false);

      // 進酒窖後，啟動「操作優先」的背景漸進預載，把剩下的慢慢補完
      if (more) startBackgroundPreload(offset);
    })();

    return () => { cancelled = true; bgStopRef.current = true; };
  }, []);

  // 背景漸進預載：操作優先，利用瀏覽器空閒時段，一批批載到全部完成
  const startBackgroundPreload = useCallback((startOffset) => {
    bgStopRef.current = false;
    setBgLoading(true);
    let offset = startOffset;

    const idle = (cb) => {
      if ("requestIdleCallback" in window) window.requestIdleCallback(cb, { timeout: 2000 });
      else setTimeout(cb, 300);
    };

    const loadNext = async () => {
      if (bgStopRef.current) { setBgLoading(false); return; }
      // 匯入辨識中 → 暫停背景載入，把資源讓給辨識，稍後再試
      if (importingRef.current) { setTimeout(loadNext, 2000); return; }

      let batch = [];
      try {
        batch = await fetchSakes({ limit: PAGE, offset });
      } catch { batch = []; }

      if (batch.length > 0) {
        setSakes(prev => {
          const ids = new Set(prev.map(s => s.id));
          const fresh = batch.filter(s => !ids.has(s.id));
          return [...prev, ...fresh];
        });
        offset += batch.length;
      }

      if (batch.length < PAGE) {
        // 沒有更多了，背景預載完成
        setHasMore(false);
        setBgLoading(false);
        return;
      }
      // 還有更多 → 等空閒 + 間隔後再載下一批（操作優先、禮讓）
      idle(() => setTimeout(loadNext, 1200));
    };

    idle(() => setTimeout(loadNext, 800));
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
    // 排序：sortBy 形如 "time-desc" / "time-asc" / "price-desc" / "price-asc"
    const parsePrice = (info) => {
      const p = info?.price;
      if (!p || p === "null") return null;
      // 抓出所有數字（去掉逗號），取平均當作代表價
      const nums = String(p).replace(/,/g, "").match(/\d+/g);
      if (!nums || nums.length === 0) return null;
      const vals = nums.map(Number);
      return vals.reduce((a, b) => a + b, 0) / vals.length;
    };
    const [sortKey, sortDir] = (sortBy || "time-desc").split("-");
    const dir = sortDir === "asc" ? 1 : -1;
    list = [...list].sort((a, b) => {
      if (sortKey === "price") {
        const pa = parsePrice(a.info), pb = parsePrice(b.info);
        // 沒有價格的排到最後（不受升降影響）
        if (pa == null && pb == null) return new Date(b.addedAt) - new Date(a.addedAt);
        if (pa == null) return 1;
        if (pb == null) return -1;
        return (pa - pb) * dir;
      }
      // 預設依加入時間
      return (new Date(a.addedAt) - new Date(b.addedAt)) * dir;
    });
    return list;
  }, [sakes, search, filterCat, sortBy]);

  // ── 匯入 ──
  const handleImport = useCallback(async (files) => {
    const arr = Array.from(files).filter(f => f.type.startsWith("image/"));
    if (!arr.length) return;
    abortImportRef.current = false; // 重置中斷旗標
    importingRef.current = true;    // 暫停背景預載，資源優先給辨識
    setImporting(true);
    setTab("cellar");
    setProgress({ done: 0, total: arr.length });

    // 🔋 取得螢幕喚醒鎖：匯入期間防止 iPhone 螢幕自動休眠而中斷辨識
    let wakeLock = null;
    const acquireWakeLock = async () => {
      try {
        if ("wakeLock" in navigator) {
          wakeLock = await navigator.wakeLock.request("screen");
        }
      } catch (e) { console.warn("wakeLock 取得失敗:", e); }
    };
    // 螢幕短暫關閉再回來時，重新取得鎖
    const onVisible = () => { if (document.visibilityState === "visible") acquireWakeLock(); };
    document.addEventListener("visibilitychange", onVisible);
    await acquireWakeLock();

    let done = 0;

    // 處理單一張照片
    const processOne = async (file) => {
      const id = uid();
      try {
        // EXIF 要在壓縮前讀（壓縮會清掉 EXIF）
        const exif = await extractExif(file);
        const photoDate = exif.date || null;

        const { blob, dataUrl, base64 } = await compressImage(file);
        // 先放佔位卡（地點稍後補上，不阻塞辨識）
        const placeholder = { id, imageUrl: dataUrl, imageBlob: blob, info: null, status: "analyzing", addedAt: new Date().toISOString(), photoDate, location: null };
        setSakes(prev => [placeholder, ...prev]);

        // 🚀 地理編碼與 AI 辨識「同時」進行，不互相等待
        const geoPromise = (exif.lat != null && exif.lng != null)
          ? reverseGeocode(exif.lat, exif.lng).catch(() => null)
          : Promise.resolve(null);
        const aiPromise = analyzeImage(base64, "image/jpeg");

        const [location, result] = await Promise.all([geoPromise, aiPromise]);

        // 若辨識回來時已被中斷，移除這張佔位卡、不儲存
        if (abortImportRef.current) {
          setSakes(prev => prev.filter(s => s.id !== id));
          return;
        }

        const info = result.info;
        const enrichedInfo = info ? { ...info, photo_date: photoDate, location } : info;
        const finished = { ...placeholder, location, info: enrichedInfo, status: info ? "done" : "error", errorMsg: result.error || null, rawDebug: result.raw || null };

        try {
          const saved = await insertSake(finished);
          setSakes(prev => prev.map(s => s.id === id ? { ...finished, imageUrl: saved.imageUrl || dataUrl, imageBlob: undefined } : s));
        } catch (dbErr) {
          setSakes(prev => prev.map(s => s.id === id ? { ...finished, status: "error", errorMsg: "儲存失敗：" + dbErr.message, imageBlob: undefined } : s));
        }
      } catch (e) {
        setSakes(prev => prev.map(s => s.id === id ? { ...s, status: "error", errorMsg: e.message } : s));
      }
      done += 1;
      setProgress({ done, total: arr.length });
    };

    // 🚀 並行處理：同時跑 CONCURRENCY 張，跑完一張就補下一張
    // 設為 2 以避免觸發 API 速率限制（搭配 analyzeImage 內建的自動重試）
    const CONCURRENCY = 2;
    let cursor = 0;
    const worker = async () => {
      while (cursor < arr.length) {
        if (abortImportRef.current) break; // 中斷：不再開始新的辨識
        const myIndex = cursor++;
        await processOne(arr[myIndex]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, arr.length) }, worker));

    // 釋放螢幕喚醒鎖、移除監聽
    document.removeEventListener("visibilitychange", onVisible);
    try { if (wakeLock) await wakeLock.release(); } catch {}
    wakeLock = null;

    abortImportRef.current = false;
    importingRef.current = false;   // 恢復背景預載
    setImporting(false);
  }, []);

  // 中斷批量匯入
  const cancelImport = useCallback(() => {
    abortImportRef.current = true;
    // 立刻清掉所有還在「辨識中」的佔位卡
    setSakes(prev => prev.filter(s => s.status !== "analyzing"));
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

  // 批量刪除已選的酒
  const handleBatchDelete = useCallback(async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (!confirm(`確定刪除已選的 ${ids.length} 筆記錄？此動作無法復原。`)) return;
    // 先從畫面移除（即時反應），再背景刪除資料庫
    setSakes(prev => prev.filter(s => !selected.has(s.id)));
    setSelected(new Set());
    setSelectMode(false);
    for (const id of ids) {
      try { await deleteSake(id); } catch (e) { console.error("刪除失敗", id, e); }
    }
  }, [selected]);

  // 快速選取所有「辨識失敗」的酒
  const selectFailed = useCallback(() => {
    const failedIds = filtered.filter(s => s.status === "error").map(s => s.id);
    setSelected(new Set(failedIds));
    if (failedIds.length > 0) setSelectMode(true);
  }, [filtered]);

  // 修正酒名後重新辨識（可附加背面圖）
  const handleReanalyze = useCallback(async (sake, correctedName, backImageBase64 = null) => {
    if (!sake?.imageUrl) return;
    setSakes(prev => prev.map(s => s.id === sake.id ? { ...s, status: "analyzing" } : s));
    setDetail(prev => prev && prev.id === sake.id ? { ...prev, status: "analyzing" } : prev);
    try {
      const base64 = await urlToBase64(sake.imageUrl);
      const result = await analyzeImage(base64, "image/jpeg", correctedName, 0, backImageBase64, "image/jpeg");
      const info = result.info
        ? { ...result.info, name: correctedName || result.info.name, photo_date: sake.photoDate || sake.info?.photo_date || null, location: sake.location || sake.info?.location || null }
        : null;
      const updated = { ...sake, info: info || sake.info, status: info ? "done" : "error", errorMsg: result.error || null };
      await updateSake(sake.id, { info: updated.info });
      setSakes(prev => prev.map(s => s.id === sake.id ? updated : s));
      setDetail(prev => prev && prev.id === sake.id ? updated : prev);
    } catch (e) {
      setSakes(prev => prev.map(s => s.id === sake.id ? { ...s, status: "error", errorMsg: "重新辨識失敗：" + e.message } : s));
      setDetail(prev => prev && prev.id === sake.id ? { ...prev, status: "error", errorMsg: "重新辨識失敗：" + e.message } : prev);
    }
  }, []);

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
          </div>
        </div>
      </header>

      {/* ─── Body ─── */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden", display: "flex" }}>
      <main ref={scrollRef} id="cellar-main" className="no-scrollbar" style={{ flex: 1, overflowY: "auto", padding: "4px 16px", paddingBottom: "calc(96px + env(safe-area-inset-bottom))" }}>
        {loading ? (
          <StickmanLoading />
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
                handleBatchDelete={handleBatchDelete} selectFailed={selectFailed}
                onOpen={setDetail} onGoImport={() => setTab("import")} onGoCollage={() => setTab("collage")}
                importing={importing} progress={progress} cancelImport={cancelImport}
                bgLoading={bgLoading} hasMore={hasMore}
              />
            )}
            {tab === "import" && (
              <ImportView fileRef={fileRef} onImport={handleImport} importing={importing} progress={progress} cancelImport={cancelImport} sakes={sakes} />
            )}
            {tab === "collage" && (
              <CollageView sakes={sakes} selected={selected} setSelected={setSelected} setSelectMode={setSelectMode} goCellar={() => setTab("cellar")} />
            )}
            {tab === "manage" && (
              <ManageView sakes={sakes} />
            )}
          </>
        )}
      </main>
      {/* Big scrubber — only show when cellar tab and enough items */}
      {tab === "cellar" && filtered.length > 10 && (
        <div
          ref={scrubRef}
          onPointerDown={e => {
            isDragging.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            e.preventDefault();
            onScrubMove(e.clientY);
          }}
          onPointerMove={e => {
            if (!isDragging.current) return;
            e.preventDefault();
            onScrubMove(e.clientY);
          }}
          onPointerUp={e => { isDragging.current = false; }}
          onPointerCancel={e => { isDragging.current = false; }}
          style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 36,
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "ns-resize", zIndex: 10, touchAction: "none",
            WebkitUserSelect: "none", userSelect: "none" }}
        >
          <div style={{ width: 4, height: "60%", background: "rgba(201,146,42,0.2)", borderRadius: 99, position: "relative" }}>
            <div style={{ position: "absolute", top: "50%", left: "50%",
              transform: "translate(-50%,-50%)",
              width: 28, height: 52,
              background: "rgba(201,146,42,0.28)",
              border: "2px solid rgba(201,146,42,0.6)",
              borderRadius: 10,
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 2px 8px rgba(0,0,0,0.4)" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {[0,1,2].map(i => <div key={i} style={{ width: 14, height: 2.5, background: "#c9922a", borderRadius: 99, opacity: 0.9 }} />)}
              </div>
            </div>
          </div>
        </div>
      )}
      </div>

      {/* ─── Bottom Nav ─── */}
      <nav style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 460, background: "rgba(10,6,2,0.92)", backdropFilter: "blur(20px)", borderTop: "1px solid var(--line)", display: "flex", paddingBottom: "env(safe-area-inset-bottom)" }}>
        {[
          { k: "cellar", icon: "蔵", label: "酒窖" },
          { k: "import", icon: "入", label: "匯入" },
          { k: "collage", icon: "繪", label: "拼接" },
          { k: "manage", icon: "管", label: "管理" },
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

      {detail && <DetailSheet sake={detail} onClose={() => setDetail(null)} onDelete={handleDelete} onReanalyze={handleReanalyze}
        onSaveBackImage={async (sakeId, blob, dataUrl) => {
          // 儲存背面圖片 URL 到 DB
          let backUrl = dataUrl;
          if (hasSupabase) {
            const uploaded = await uploadBackImage(sakeId, blob);
            if (uploaded) backUrl = uploaded;
          }
          await updateSake(sakeId, { backImageUrl: backUrl });
          setSakes(prev => prev.map(s => s.id === sakeId ? { ...s, backImageUrl: backUrl } : s));
          setDetail(prev => prev && prev.id === sakeId ? { ...prev, backImageUrl: backUrl } : prev);
        }}
      />}
    </div>
  );
}

// ═══════════════════════════ 酒窖 ═══════════════════════════
function CellarView(props) {
  const { sakes, filtered, cats, search, setSearch, filterCat, setFilterCat, sortBy, setSortBy,
    selected, selectMode, setSelectMode, toggleSelect, selectAll, clearSelect, handleBatchDelete, selectFailed, onOpen, onGoImport, onGoCollage, importing, progress, cancelImport,
    bgLoading, hasMore } = props;
  const gold = "#c9922a";
  const [showSort, setShowSort] = useState(false);
  // 排序選項：依加入時間 / 依價格，各有升降序
  const sortOptions = [
    { k: "time-desc", label: "加入時間（新→舊）" },
    { k: "time-asc", label: "加入時間（舊→新）" },
    { k: "price-desc", label: "價格（高→低）" },
    { k: "price-asc", label: "價格（低→高）" },
  ];
  const sortShort = { "time-desc": "最新加入", "time-asc": "最早加入", "price-desc": "價格高→低", "price-asc": "價格低→高" };
  const failedCount = filtered.filter(s => s.status === "error").length;

  return (
    <div className="fade-in">
      {/* 搜尋列 + 選取按鈕 */}
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <div style={{ position: "relative", flex: 1 }}>
          <span style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", color: "#5a5042", fontSize: 14 }}>🔍</span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜尋 酒名 · 酒造 · 産地 · 酒米"
            style={{ width: "100%", background: "rgba(255,255,255,0.05)", border: "1px solid var(--line)", borderRadius: 12, padding: "11px 36px 11px 38px", color: "var(--ink)", fontSize: 13, outline: "none" }} />
          {search && (
            <button onClick={() => setSearch("")} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "rgba(255,255,255,0.1)", border: "none", color: "#aaa", borderRadius: 99, width: 22, height: 22, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>✕</button>
          )}
        </div>
        <button
          onClick={() => { if (selectMode) { clearSelect(); } else { setSelectMode(true); } }}
          style={{ whiteSpace: "nowrap", background: selectMode ? gold : "rgba(255,255,255,0.05)", border: selectMode ? "none" : "1px solid var(--line)", color: selectMode ? "#0e0a06" : "#bba080", borderRadius: 12, padding: "0 16px", fontSize: 13, fontWeight: 600 }}
        >
          {selectMode ? "完成" : "選取"}
        </button>
      </div>

      {/* 有辨識失敗時，顯示快速選取按鈕 */}
      {failedCount > 0 && selected.size === 0 && !selectMode && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(183,58,50,0.1)", border: "1px solid rgba(183,58,50,0.25)", borderRadius: 12, padding: "9px 13px", marginBottom: 12 }}>
          <span style={{ fontSize: 12, color: "#d99" }}>有 {failedCount} 筆辨識失敗</span>
          <button onClick={selectFailed} style={{ background: "rgba(183,58,50,0.2)", border: "1px solid rgba(183,58,50,0.4)", color: "#e07a72", borderRadius: 8, padding: "5px 13px", fontSize: 12, fontWeight: 600 }}>一鍵選取失敗項</button>
        </div>
      )}

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
        <button onClick={() => setShowSort(v => !v)} style={{ background: "rgba(255,255,255,0.05)", border: "1px solid var(--line)", borderRadius: 10, padding: "7px 10px", color: "#bba080", fontSize: 11, whiteSpace: "nowrap" }}>
          ↕ {sortShort[sortBy] || "排序"}
        </button>
      </div>
      {showSort && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12, background: "rgba(255,255,255,0.03)", borderRadius: 12, padding: 8 }}>
          {sortOptions.map(({ k, label }) => (
            <button key={k} onClick={() => { setSortBy(k); setShowSort(false); }} style={{
              textAlign: "left", padding: "10px 12px", borderRadius: 9, fontSize: 13,
              background: sortBy === k ? "rgba(201,146,42,0.2)" : "rgba(255,255,255,0.04)",
              border: `1px solid ${sortBy === k ? "rgba(201,146,42,0.4)" : "var(--line)"}`,
              color: sortBy === k ? gold : "#aaa", fontWeight: sortBy === k ? 600 : 400,
            }}>{sortBy === k ? "✓ " : ""}{label}</button>
          ))}
        </div>
      )}

      {/* 匯入進度 */}
      {importing && (
        <div style={{ background: "rgba(201,146,42,0.08)", border: "1px solid rgba(201,146,42,0.2)", borderRadius: 12, padding: 13, marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 7, fontSize: 12 }}>
            <span style={{ color: gold }}>AI 辨識中…</span>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ color: "#888" }}>{progress.done}/{progress.total}</span>
              <button onClick={cancelImport} style={{ background: "rgba(183,58,50,0.18)", border: "1px solid rgba(183,58,50,0.4)", color: "#e07a72", borderRadius: 8, padding: "4px 12px", fontSize: 12, fontWeight: 600 }}>中斷</button>
            </div>
          </div>
          <div style={{ background: "rgba(255,255,255,0.08)", borderRadius: 99, height: 5 }}>
            <div style={{ height: "100%", background: `linear-gradient(90deg,${gold},#e8b84b)`, borderRadius: 99, width: `${(progress.done / progress.total) * 100}%`, transition: "width .3s" }} />
          </div>
        </div>
      )}

      {/* 選取動作列：固定浮動在底部主功能列上方，捲動絕不跑掉 */}
      {(selectMode || selected.size > 0) && (
        <div style={{ position: "fixed", left: "50%", transform: "translateX(-50%)", bottom: "calc(64px + env(safe-area-inset-bottom))", width: "calc(100% - 24px)", maxWidth: 436, zIndex: 30, background: "rgba(28,20,8,0.97)", backdropFilter: "blur(12px)", border: "1px solid rgba(201,146,42,0.35)", borderRadius: 14, padding: "10px 13px", boxShadow: "0 6px 24px rgba(0,0,0,0.5)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: selected.size > 0 ? 9 : 0 }}>
            <span style={{ fontSize: 13, color: gold }}>已選 {selected.size} 筆</span>
            <div style={{ display: "flex", gap: 14 }}>
              <button onClick={selectAll} style={{ background: "none", border: "none", color: "#bba080", fontSize: 12 }}>全選</button>
              <button onClick={clearSelect} style={{ background: "none", border: "none", color: "#bba080", fontSize: 12 }}>取消</button>
            </div>
          </div>
          {selected.size > 0 && (
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={handleBatchDelete} style={{ flex: 1, background: "rgba(183,58,50,0.2)", border: "1px solid rgba(183,58,50,0.4)", color: "#e07a72", borderRadius: 9, padding: "10px", fontSize: 13, fontWeight: 600 }}>🗑️ 刪除 {selected.size} 筆</button>
              <button onClick={onGoCollage} style={{ flex: 1, background: gold, border: "none", color: "#0e0a06", borderRadius: 9, padding: "10px", fontSize: 13, fontWeight: 600 }}>🖼️ 製作拼接</button>
            </div>
          )}
        </div>
      )}

      {/* 計數列 */}
      {sakes.length > 0 && (
        <div style={{ fontSize: 11, color: "#4a4236", marginBottom: 12 }}>
          {(filterCat !== "全部" || search) ? (
            <>{filtered.length} 支{filterCat !== "全部" ? ` ${filterCat}` : ""}{search ? ` · 搜尋「${search}」` : ""} <span style={{ color: "#3a3228" }}>（共 {sakes.length} 支）</span></>
          ) : (
            <>共 {sakes.length} 支酒</>
          )}
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
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {filtered.map(s => (
              <SakeCard key={s.id} sake={s} selected={selected.has(s.id)}
                selectMode={selectMode || selected.size > 0}
                onSelect={toggleSelect} onOpen={onOpen} onLongPress={() => setSelectMode(true)} />
            ))}
          </div>
          {/* 背景自動載入指示（操作優先，不需手動點） */}
          {hasMore && bgLoading && (
            <div style={{ textAlign: "center", padding: "18px 0", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              <div style={{ width: 14, height: 14, border: `2px solid ${gold}44`, borderTop: `2px solid ${gold}`, borderRadius: "50%", animation: "spin 1s linear infinite" }} />
              <span style={{ fontSize: 11, color: "#665a44" }}>背景載入更多酒款中…</span>
            </div>
          )}
          {!hasMore && filtered.length > PAGE_HINT && (
            <div style={{ textAlign: "center", padding: "18px 0", fontSize: 11, color: "#4a4236" }}>— 已全部載入 —</div>
          )}
        </>
      )}
    </div>
  );
}

const PAGE_HINT = 20;

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
        {sake.imageUrl && <img src={sake.imageUrl} alt="" loading="lazy" decoding="async" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
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

// ═══════════════════════════ 即時掃描比對 ═══════════════════════════
function ScanView({ sakes }) {
  const gold = "#c9922a";
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [matches, setMatches] = useState(null);
  const [snapUrl, setSnapUrl] = useState(null);
  const [err, setErr] = useState("");
  // 固定鏡頭區塊高度，避免拍照後版面跳動
  const CAM_H = 340;

  // 用 callback ref：video 元素 mount 後立刻綁 stream
  const videoCallbackRef = useCallback((node) => {
    videoRef.current = node;
    if (node && streamRef.current) {
      node.srcObject = streamRef.current;
      node.play().catch(() => {});
    }
  }, []);

  const startCamera = async () => {
    setErr("");
    setSnapUrl(null);
    setMatches(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } }
      });
      streamRef.current = stream;
      // 若 video 已 mount，直接綁（避免時序問題）
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }
      setCameraOn(true);
    } catch (e) {
      setErr("無法開啟相機，請確認已授權相機權限（設定 → Safari → 相機）");
    }
  };

  const stopCamera = () => {
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    setCameraOn(false);
    setMatches(null);
    setSnapUrl(null);
    setErr("");
  };

  // 重拍：清掉 snapshot，重新綁 stream 到 video
  const reset = () => {
    setMatches(null);
    setSnapUrl(null);
    setErr("");
    // video 元素重新出現後 videoCallbackRef 會自動綁 stream
  };

  useEffect(() => () => {
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
  }, []);
  const snap = async () => {
    const v = videoRef.current;
    const canvas = canvasRef.current;
    if (!v || !canvas || v.readyState < 2) { setErr("鏡頭尚未就緒，請稍後再試"); return; }
    canvas.width = v.videoWidth || 1280;
    canvas.height = v.videoHeight || 720;
    canvas.getContext("2d").drawImage(v, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
    setSnapUrl(dataUrl);
    setScanning(true);
    setMatches(null);
    setErr("");
    try {
      const base64 = dataUrl.split(",")[1];
      // 使用標準 /api/analyze 格式（image 欄位），和正常辨識一樣
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: base64, mimeType: "image/jpeg" })
      });
      const data = await res.json();
      const info = data.info;
      if (!info || !info.name) {
        setMatches({ exact: null, similar: [], query: "" });
        setScanning(false);
        return;
      }
      const q = (info.name || "").toLowerCase().replace(/\s+/g, "");
      const qBr = (info.brewery || "").toLowerCase();
      const scored = sakes.map(s => {
        const si = s.info || {};
        const sName = (si.name || s.name || "").toLowerCase().replace(/\s+/g, "");
        const sBr = (si.brewery || "").toLowerCase();
        let score = 0;
        if (sName && sName === q) score = 100;
        else if (sName && (sName.includes(q) || q.includes(sName))) score = 75;
        else if (sName && q) {
          const a = new Set(q.split("")); const b = new Set(sName.split(""));
          const inter = [...a].filter(c => b.has(c)).length;
          score = Math.round((inter / Math.max(a.size, b.size, 1)) * 55);
        }
        if (qBr && sBr && sBr.includes(qBr)) score = Math.min(100, score + 20);
        return { sake: s, score };
      }).filter(x => x.score > 25).sort((a, b) => b.score - a.score);
      setMatches({
        exact: scored.find(x => x.score >= 95)?.sake || null,
        similar: scored.filter(x => x.score < 95 && x.score >= 45).slice(0, 3).map(x => x.sake),
        query: info.name,
        brewery: info.brewery,
      });
    } catch (e) {
      setErr("辨識請求失敗，請再試一次");
    }
    setScanning(false);
  };

  return (
    <div className="fade-in" style={{ paddingBottom: 20 }}>
      <div style={{ marginBottom: 14 }}>
        <div className="mincho" style={{ fontSize: 20, color: gold, marginBottom: 4 }}>📷 掃描比對</div>
        <div style={{ fontSize: 12, color: "#777" }}>開啟鏡頭對準酒標，確認酒窖裡是否有這支酒</div>
      </div>

      {err && <div style={{ background: "rgba(183,58,50,0.15)", border: "1px solid rgba(183,58,50,0.3)", borderRadius: 10, padding: "10px 14px", fontSize: 12, color: "#e07a72", marginBottom: 12 }}>{err}</div>}

      {!cameraOn ? (
        <div style={{ textAlign: "center", padding: "36px 20px", border: "2px dashed rgba(201,146,42,0.3)", borderRadius: 18, background: "rgba(201,146,42,0.04)" }}>
          <div style={{ fontSize: 44, marginBottom: 12 }}>📷</div>
          <div style={{ fontSize: 14, color: gold, marginBottom: 6 }}>開啟鏡頭比對酒標</div>
          <div style={{ fontSize: 11, color: "#5a5042", marginBottom: 18 }}>拍一張照片，AI 比對你的酒窖資料庫</div>
          <button onClick={startCamera} style={{ background: `linear-gradient(135deg,${gold},#e8b84b)`, border: "none", color: "#0e0a06", borderRadius: 11, padding: "12px 28px", fontSize: 14, fontWeight: 700 }}>開啟相機</button>
        </div>
      ) : (
        <div>
          {/* 固定高度的鏡頭/截圖區 — 高度不變，版面不跳 */}
          <div style={{ position: "relative", borderRadius: 14, overflow: "hidden", background: "#111", marginBottom: 12, height: CAM_H }}>
            {/* video 和 img 都撐滿同一個容器，互斥顯示 */}
            <video
              ref={videoCallbackRef}
              autoPlay playsInline muted
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: snapUrl ? "none" : "block" }}
            />
            {snapUrl && (
              <img src={snapUrl} alt="snap"
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
            )}
            {/* 瞄準框 */}
            {!snapUrl && (
              <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: "65%", height: "50%", border: "2px dashed rgba(201,146,42,0.8)", borderRadius: 8, pointerEvents: "none" }} />
            )}
            {/* 外框 */}
            <div style={{ position: "absolute", inset: 0, border: "1.5px solid rgba(201,146,42,0.3)", borderRadius: 14, pointerEvents: "none" }} />
          </div>

          <canvas ref={canvasRef} style={{ display: "none" }} />

          {/* 按鈕 */}
          <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
            {!snapUrl ? (
              <>
                <button onClick={snap} disabled={scanning} style={{ flex: 2, background: `linear-gradient(135deg,${gold},#e8b84b)`, border: "none", color: "#0e0a06", borderRadius: 12, padding: "14px", fontSize: 15, fontWeight: 700 }}>
                  📸 拍照比對
                </button>
                <button onClick={stopCamera} style={{ flex: 1, background: "rgba(255,255,255,0.05)", border: "1px solid var(--line)", color: "#aaa", borderRadius: 12, padding: "14px", fontSize: 13 }}>關閉</button>
              </>
            ) : (
              <>
                <button onClick={reset} style={{ flex: 1, background: `linear-gradient(135deg,${gold},#e8b84b)`, border: "none", color: "#0e0a06", borderRadius: 12, padding: "14px", fontSize: 14, fontWeight: 700 }}>🔄 重拍</button>
                <button onClick={stopCamera} style={{ flex: 1, background: "rgba(255,255,255,0.05)", border: "1px solid var(--line)", color: "#aaa", borderRadius: 12, padding: "14px", fontSize: 13 }}>關閉</button>
              </>
            )}
          </div>

          {/* Scanning indicator */}
          {scanning && (
            <div style={{ textAlign: "center", padding: "20px 0" }}>
              <div style={{ width: 30, height: 30, border: `3px solid ${gold}33`, borderTop: `3px solid ${gold}`, borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto 10px" }} />
              <div style={{ fontSize: 13, color: gold }}>AI 辨識比對中…</div>
            </div>
          )}

          {/* Results */}
          {matches && !scanning && (
            <div>
              <div style={{ fontSize: 12, color: "#8a7055", marginBottom: 12 }}>
                辨識結果：<span style={{ color: gold }}>{matches.query || "無法辨識"}</span>
                {matches.brewery ? <span style={{ color: "#6a5a3a" }}> · {matches.brewery}</span> : ""}
              </div>

              {matches.exact ? (
                <div style={{ background: "rgba(40,180,80,0.1)", border: "1px solid rgba(40,180,80,0.3)", borderRadius: 12, padding: 14, marginBottom: 12 }}>
                  <div style={{ fontSize: 12, color: "#4fc87a", marginBottom: 8, fontWeight: 700 }}>✅ 完全符合 — 酒窖裡有這支酒！</div>
                  <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                    {matches.exact.imageUrl && <img src={matches.exact.imageUrl} style={{ width: 52, height: 68, objectFit: "cover", borderRadius: 6 }} alt="" />}
                    <div>
                      <div style={{ fontSize: 14, color: "var(--ink)", fontWeight: 600 }}>{matches.exact.info?.name || matches.exact.name}</div>
                      {matches.exact.info?.brewery && <div style={{ fontSize: 11, color: "#8a7055", marginTop: 3 }}>{matches.exact.info.brewery}</div>}
                      {matches.exact.info?.date && <div style={{ fontSize: 11, color: "#5a5042", marginTop: 2 }}>喝過：{matches.exact.info.date}</div>}
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ background: "rgba(201,146,42,0.08)", border: "1px solid rgba(201,146,42,0.2)", borderRadius: 10, padding: "10px 14px", marginBottom: 12, fontSize: 12, color: "#8a7055" }}>
                  {matches.query ? "❌ 酒窖裡沒有完全符合的酒" : "⚠️ 無法從圖片辨識酒名，請確認酒標清晰"}
                </div>
              )}

              {matches.similar.length > 0 && (
                <div>
                  <div style={{ fontSize: 12, color: "#8a7055", marginBottom: 10 }}>相似度高的酒（{matches.similar.length} 支）</div>
                  {matches.similar.map(s => (
                    <div key={s.id} style={{ display: "flex", gap: 12, alignItems: "center", padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
                      {s.imageUrl && <img src={s.imageUrl} style={{ width: 44, height: 58, objectFit: "cover", borderRadius: 6, flexShrink: 0 }} alt="" />}
                      <div>
                        <div style={{ fontSize: 13, color: "var(--ink)" }}>{s.info?.name || s.name}</div>
                        {s.info?.brewery && <div style={{ fontSize: 11, color: "#8a7055", marginTop: 2 }}>{s.info.brewery}</div>}
                        {s.info?.date && <div style={{ fontSize: 11, color: "#5a5042", marginTop: 2 }}>喝過：{s.info.date}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {!matches.exact && matches.similar.length === 0 && matches.query && (
                <div style={{ textAlign: "center", padding: "14px 0", fontSize: 12, color: "#5a5042" }}>酒窖裡沒有相似的酒，可以放心買！🍶</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ImportView({ fileRef, onImport, importing, progress, cancelImport, sakes }) {
  const gold = "#c9922a";
  const [subTab, setSubTab] = useState("import"); // "import" | "scan"

  return (
    <div className="fade-in">
      {/* 子頁切換 */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20, background: "rgba(255,255,255,0.04)", borderRadius: 12, padding: 5 }}>
        {[{ k: "import", label: "📥 匯入照片" }, { k: "scan", label: "📷 掃描比對" }].map(o => (
          <button key={o.k} onClick={() => setSubTab(o.k)} style={{
            flex: 1, padding: "10px", borderRadius: 9, fontSize: 13, fontWeight: subTab === o.k ? 700 : 400,
            background: subTab === o.k ? `linear-gradient(135deg,${gold},#e8b84b)` : "transparent",
            border: "none", color: subTab === o.k ? "#0e0a06" : "#888", transition: "all .18s",
          }}>{o.label}</button>
        ))}
      </div>

      {subTab === "scan" ? <ScanView sakes={sakes} /> : (
      <div>
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
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, fontSize: 13 }}>
            <span style={{ color: gold }}>AI 辨識中…</span>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ color: "#888" }}>{progress.done}/{progress.total}</span>
              <button onClick={cancelImport} style={{ background: "rgba(183,58,50,0.18)", border: "1px solid rgba(183,58,50,0.4)", color: "#e07a72", borderRadius: 8, padding: "5px 13px", fontSize: 12, fontWeight: 600 }}>中斷</button>
            </div>
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
      )}
    </div>
  );
}

// ═══════════════════════════ 拼接 ═══════════════════════════
const COLLAGE_MAX = 50; // 單張上限

function chunkArray(arr, size) {
  const chunks = [];
  const n = arr.length;
  const numGroups = Math.ceil(n / size);
  const base = Math.floor(n / numGroups);
  let remainder = n % numGroups;
  let i = 0;
  for (let g = 0; g < numGroups; g++) {
    const len = base + (remainder-- > 0 ? 1 : 0);
    chunks.push(arr.slice(i, i + len));
    i += len;
  }
  return chunks;
}

function CollageView({ sakes, selected, setSelected, setSelectMode, goCellar }) {
  const gold = "#c9922a";
  const [layout, setLayout] = useState("tidy");
  const [mode, setMode] = useState("single"); // "single" | "multi"
  const [result, setResult] = useState(null);
  const [results, setResults] = useState([]); // multi mode
  const [building, setBuilding] = useState(false);
  const [seed, setSeed] = useState(1);

  const chosen = sakes.filter(s => selected.has(s.id) && s.imageUrl);
  const overLimit = mode === "single" && chosen.length > COLLAGE_MAX;

  const build = useCallback(async () => {
    if (chosen.length === 0) return;
    setBuilding(true);
    setResult(null);
    setResults([]);
    try {
      if (mode === "single") {
        const urls = chosen.slice(0, COLLAGE_MAX).map(s => s.imageUrl);
        const dataUrl = layout === "tidy"
          ? await buildTidyCollage(urls)
          : await buildScatteredCollage(urls, { seed });
        setResult(dataUrl);
      } else {
        // multi: auto-split into groups of max 50
        const allUrls = chosen.map(s => s.imageUrl);
        const groups = chunkArray(allUrls, COLLAGE_MAX);
        const built = [];
        for (const grp of groups) {
          const dataUrl = layout === "tidy"
            ? await buildTidyCollage(grp)
            : await buildScatteredCollage(grp, { seed });
          built.push(dataUrl);
        }
        setResults(built);
      }
    } catch (e) { console.error(e); }
    setBuilding(false);
  }, [chosen, layout, seed, mode]);

  useEffect(() => { if (chosen.length > 0) build(); /* eslint-disable-next-line */ }, [layout, seed, mode]);

  return (
    <div className="fade-in">
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 18 }}>
        <div>
          <div className="mincho" style={{ fontSize: 20, color: gold, marginBottom: 6 }}>照片拼接</div>
          <div style={{ fontSize: 12, color: overLimit ? "#e07a72" : "#777" }}>
            {chosen.length > 0
              ? mode === "single"
                ? overLimit
                  ? `已選 ${chosen.length} 張 · 單張模式上限 ${COLLAGE_MAX} 張，將取前 ${COLLAGE_MAX} 張`
                  : `已選 ${chosen.length} 張 · 正方形輸出`
                : `已選 ${chosen.length} 張 · 自動分成 ${Math.ceil(chosen.length / COLLAGE_MAX)} 張大圖`
              : "請先到酒窖選擇照片"}
          </div>
        </div>
        <button
          onClick={() => { setSelected(new Set()); setSelectMode(false); goCellar(); }}
          style={{ flexShrink: 0, background: "rgba(255,255,255,0.06)", border: "1px solid var(--line)", color: "#bba080", borderRadius: 99, padding: "7px 14px", fontSize: 12 }}
        >✕ 取消</button>
      </div>

      {/* 模式切換 */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14, background: "rgba(255,255,255,0.04)", borderRadius: 12, padding: 4 }}>
        {[
          { k: "single", label: `單張（最多${COLLAGE_MAX}張）`, icon: "□" },
          { k: "multi",  label: "多張自動分組", icon: "⊟" },
        ].map(o => (
          <button key={o.k} onClick={() => setMode(o.k)} style={{
            flex: 1, padding: "9px 6px", borderRadius: 9, fontSize: 12, fontWeight: mode === o.k ? 700 : 400,
            background: mode === o.k ? `linear-gradient(135deg,${gold},#e8b84b)` : "transparent",
            border: "none", color: mode === o.k ? "#0e0a06" : "#888", transition: "all .15s",
          }}>{o.icon} {o.label}</button>
        ))}
      </div>

      {chosen.length === 0 ? (
        <div style={{ textAlign: "center", padding: "50px 20px", color: "#4a4236" }}>
          <div className="mincho" style={{ fontSize: 46, color: "#3a3025", marginBottom: 14 }}>繪</div>
          <div style={{ fontSize: 13, marginBottom: 6 }}>到酒窖長按或點選照片，挑選要拼接的酒</div>
          <div style={{ fontSize: 11, color: "#5a5042", marginBottom: 18 }}>
            單張模式：最多選 {COLLAGE_MAX} 張 · 多張模式：無上限，自動分組
          </div>
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

          {/* 預覽 — single */}
          {mode === "single" && (
            <div style={{ aspectRatio: "1", borderRadius: 14, overflow: "hidden", background: "#0a0704", border: "1px solid var(--line)", marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
              {building && <div style={{ textAlign: "center" }}><div style={{ width: 30, height: 30, border: `3px solid ${gold}33`, borderTop: `3px solid ${gold}`, borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto 10px" }} /><span style={{ fontSize: 12, color: gold }}>合成中…</span></div>}
              {!building && result && <img src={result} alt="collage" style={{ width: "100%", height: "100%", objectFit: "contain" }} />}
            </div>
          )}

          {/* 預覽 — multi */}
          {mode === "multi" && (
            <div style={{ marginBottom: 16 }}>
              {building && <div style={{ textAlign: "center", padding: "30px 0" }}><div style={{ width: 30, height: 30, border: `3px solid ${gold}33`, borderTop: `3px solid ${gold}`, borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto 10px" }} /><span style={{ fontSize: 12, color: gold }}>合成中…</span></div>}
              {!building && results.map((r, i) => (
                <div key={i} style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, color: "#8a7055", marginBottom: 6 }}>第 {i + 1} 張 / 共 {results.length} 張</div>
                  <div style={{ aspectRatio: "1", borderRadius: 14, overflow: "hidden", background: "#0a0704", border: "1px solid var(--line)", marginBottom: 8 }}>
                    <img src={r} alt={`collage-${i}`} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                  </div>
                  <button onClick={() => downloadDataUrl(r, `sake-cellar-${layout}-${i+1}-${Date.now()}.jpg`)} style={{ width: "100%", background: `linear-gradient(135deg,${gold},#e8b84b)`, border: "none", color: "#0e0a06", borderRadius: 12, padding: "11px", fontSize: 13, fontWeight: 700 }}>
                    ⬇ 儲存第 {i + 1} 張
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* 操作 */}
          {mode === "single" && (
            <div style={{ display: "flex", gap: 10 }}>
              {layout === "scattered" && (
                <button onClick={() => setSeed(s => s + 1)} style={{ padding: "13px 16px", background: "rgba(255,255,255,0.05)", border: "1px solid var(--line)", borderRadius: 12, color: "#aaa", fontSize: 13 }}>🎲 換排列</button>
              )}
              <button disabled={!result || building} onClick={() => downloadDataUrl(result, `sake-cellar-${layout}-${Date.now()}.jpg`)} style={{ flex: 1, background: result && !building ? `linear-gradient(135deg,${gold},#e8b84b)` : "#333", border: "none", color: result && !building ? "#0e0a06" : "#666", borderRadius: 12, padding: "13px", fontSize: 14, fontWeight: 700 }}>
                ⬇ 儲存拼接圖
              </button>
            </div>
          )}
          <div style={{ fontSize: 11, color: "#5a5042", textAlign: "center", marginTop: 12 }}>
            儲存後可長按圖片存到相簿，或直接分享
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════ 載入動畫 ═══════════════════════════
function StickmanLoading({ label = "今天又開哪支酒 ?" }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "60vh", gap: 24 }}>
      <svg width="320" height="200" viewBox="0 0 680 300" style={{ overflow: "hidden", width: "100%", maxWidth: 360 }}>
        <defs><clipPath id="splashClip"><rect x="0" y="0" width="680" height="260"/></clipPath></defs>
        <style>{`
          @keyframes splashParade { 0%{transform:translateX(-50%)} 100%{transform:translateX(0%)} }
          .splash-trk { animation: splashParade 16s linear infinite; }
        `}</style>
        <g clipPath="url(#splashClip)">
        <g className="splash-trk">
          {/* B1 十四代 */}
          <g transform="translate(5,10)">
            <rect x="28" y="0" width="14" height="16" rx="2.5" fill="none" stroke="#c9922a" strokeWidth="2.2"/>
            <rect x="29" y="16" width="12" height="58" rx="1" fill="none" stroke="#c9922a" strokeWidth="2.2"/>
            <path d="M29 74 Q16 86 13 98" fill="none" stroke="#c9922a" strokeWidth="2.2" strokeLinecap="round"/>
            <path d="M41 74 Q54 86 57 98" fill="none" stroke="#c9922a" strokeWidth="2.2" strokeLinecap="round"/>
            <rect x="13" y="98" width="44" height="132" rx="2" fill="none" stroke="#c9922a" strokeWidth="2.2"/>
            <line x1="13" y1="230" x2="57" y2="230" stroke="#c9922a" strokeWidth="2.2" strokeLinecap="round"/>
            <rect x="15" y="148" width="40" height="64" rx="1" fill="none" stroke="#c9922a" strokeWidth="1.5" opacity="0.7"/>
            <text x="35" y="199" textAnchor="middle" fontSize="11" fill="#c9922a" fontFamily="serif" writingMode="tb" letterSpacing="1">十四代</text>
          </g>
          {/* B2 新政 diagonal */}
          <g transform="translate(135,10)">
            <rect x="28" y="0" width="14" height="14" rx="2.5" fill="none" stroke="#c9922a" strokeWidth="2.2"/>
            <rect x="29" y="14" width="12" height="62" rx="1" fill="none" stroke="#c9922a" strokeWidth="2.2"/>
            <path d="M29 76 Q15 88 12 100" fill="none" stroke="#c9922a" strokeWidth="2.2" strokeLinecap="round"/>
            <path d="M41 76 Q55 88 58 100" fill="none" stroke="#c9922a" strokeWidth="2.2" strokeLinecap="round"/>
            <rect x="12" y="100" width="46" height="130" rx="2" fill="none" stroke="#c9922a" strokeWidth="2.2"/>
            <line x1="12" y1="230" x2="58" y2="230" stroke="#c9922a" strokeWidth="2.2" strokeLinecap="round"/>
            <path d="M13 148 L57 126 L57 186 L13 208 Z" fill="none" stroke="#c9922a" strokeWidth="1.5" opacity="0.7"/>
            <text transform="translate(35,168) rotate(-24)" textAnchor="middle" fontSize="11" fill="#c9922a" fontFamily="serif" letterSpacing="1">新政</text>
          </g>
          {/* B3 信州亀齢 wide cap */}
          <g transform="translate(265,10)">
            <rect x="25" y="0" width="20" height="16" rx="3" fill="none" stroke="#c9922a" strokeWidth="2.2"/>
            <rect x="29" y="16" width="12" height="56" rx="1" fill="none" stroke="#c9922a" strokeWidth="2.2"/>
            <path d="M29 72 Q16 84 13 96" fill="none" stroke="#c9922a" strokeWidth="2.2" strokeLinecap="round"/>
            <path d="M41 72 Q54 84 57 96" fill="none" stroke="#c9922a" strokeWidth="2.2" strokeLinecap="round"/>
            <rect x="13" y="96" width="44" height="134" rx="2" fill="none" stroke="#c9922a" strokeWidth="2.2"/>
            <line x1="13" y1="230" x2="57" y2="230" stroke="#c9922a" strokeWidth="2.2" strokeLinecap="round"/>
            <rect x="15" y="144" width="40" height="68" rx="1" fill="none" stroke="#c9922a" strokeWidth="1.5" opacity="0.7"/>
            <line x1="15" y1="158" x2="55" y2="158" stroke="#c9922a" strokeWidth="1" opacity="0.4"/>
            <text x="35" y="202" textAnchor="middle" fontSize="9.5" fill="#c9922a" fontFamily="serif" writingMode="tb" letterSpacing="0.5">信州亀齢</text>
          </g>
          {/* B4 金雀 diagonal */}
          <g transform="translate(395,10)">
            <rect x="28" y="0" width="14" height="18" rx="2.5" fill="none" stroke="#c9922a" strokeWidth="2.2"/>
            <rect x="29" y="18" width="12" height="64" rx="1" fill="none" stroke="#c9922a" strokeWidth="2.2"/>
            <path d="M29 82 Q15 93 12 104" fill="none" stroke="#c9922a" strokeWidth="2.2" strokeLinecap="round"/>
            <path d="M41 82 Q55 93 58 104" fill="none" stroke="#c9922a" strokeWidth="2.2" strokeLinecap="round"/>
            <rect x="12" y="104" width="46" height="126" rx="2" fill="none" stroke="#c9922a" strokeWidth="2.2"/>
            <line x1="12" y1="230" x2="58" y2="230" stroke="#c9922a" strokeWidth="2.2" strokeLinecap="round"/>
            <path d="M13 150 L57 128 L57 182 L13 204 Z" fill="none" stroke="#c9922a" strokeWidth="1.5" opacity="0.7"/>
            <text transform="translate(35,167) rotate(-24)" textAnchor="middle" fontSize="11" fill="#c9922a" fontFamily="serif" letterSpacing="1">金雀</text>
          </g>
          {/* B5 而今 round cap */}
          <g transform="translate(525,10)">
            <rect x="26" y="0" width="18" height="22" rx="4" fill="none" stroke="#c9922a" strokeWidth="2.2"/>
            <rect x="29" y="22" width="12" height="54" rx="1" fill="none" stroke="#c9922a" strokeWidth="2.2"/>
            <path d="M29 76 Q15 87 12 98" fill="none" stroke="#c9922a" strokeWidth="2.2" strokeLinecap="round"/>
            <path d="M41 76 Q55 87 58 98" fill="none" stroke="#c9922a" strokeWidth="2.2" strokeLinecap="round"/>
            <rect x="12" y="98" width="46" height="132" rx="2" fill="none" stroke="#c9922a" strokeWidth="2.2"/>
            <line x1="12" y1="230" x2="58" y2="230" stroke="#c9922a" strokeWidth="2.2" strokeLinecap="round"/>
            <rect x="14" y="148" width="42" height="64" rx="1" fill="none" stroke="#c9922a" strokeWidth="1.5" opacity="0.7"/>
            <text x="35" y="198" textAnchor="middle" fontSize="11" fill="#c9922a" fontFamily="serif" writingMode="tb" letterSpacing="1">而今</text>
          </g>
          {/* B6 產土 */}
          <g transform="translate(655,10)">
            <rect x="28" y="0" width="14" height="16" rx="2.5" fill="none" stroke="#c9922a" strokeWidth="2.2"/>
            <rect x="29" y="16" width="12" height="58" rx="1" fill="none" stroke="#c9922a" strokeWidth="2.2"/>
            <path d="M29 74 Q16 86 13 98" fill="none" stroke="#c9922a" strokeWidth="2.2" strokeLinecap="round"/>
            <path d="M41 74 Q54 86 57 98" fill="none" stroke="#c9922a" strokeWidth="2.2" strokeLinecap="round"/>
            <rect x="13" y="98" width="44" height="132" rx="2" fill="none" stroke="#c9922a" strokeWidth="2.2"/>
            <line x1="13" y1="230" x2="57" y2="230" stroke="#c9922a" strokeWidth="2.2" strokeLinecap="round"/>
            <rect x="15" y="148" width="40" height="64" rx="1" fill="none" stroke="#c9922a" strokeWidth="1.5" opacity="0.7"/>
            <text x="35" y="198" textAnchor="middle" fontSize="11" fill="#c9922a" fontFamily="serif" writingMode="tb" letterSpacing="1">產土</text>
          </g>
          {/* B7 寒菊銘醸宮寒梅 diagonal */}
          <g transform="translate(785,10)">
            <rect x="28" y="0" width="14" height="14" rx="2.5" fill="none" stroke="#c9922a" strokeWidth="2.2"/>
            <rect x="29" y="14" width="12" height="62" rx="1" fill="none" stroke="#c9922a" strokeWidth="2.2"/>
            <path d="M29 76 Q15 88 12 100" fill="none" stroke="#c9922a" strokeWidth="2.2" strokeLinecap="round"/>
            <path d="M41 76 Q55 88 58 100" fill="none" stroke="#c9922a" strokeWidth="2.2" strokeLinecap="round"/>
            <rect x="12" y="100" width="46" height="130" rx="2" fill="none" stroke="#c9922a" strokeWidth="2.2"/>
            <line x1="12" y1="230" x2="58" y2="230" stroke="#c9922a" strokeWidth="2.2" strokeLinecap="round"/>
            <path d="M13 140 L57 118 L57 196 L13 218 Z" fill="none" stroke="#c9922a" strokeWidth="1.5" opacity="0.7"/>
            <text transform="translate(35,162) rotate(-24)" textAnchor="middle" fontSize="8" fill="#c9922a" fontFamily="serif" letterSpacing="0.5">寒菊銘醸</text>
            <text transform="translate(35,174) rotate(-24)" textAnchor="middle" fontSize="8" fill="#c9922a" fontFamily="serif" letterSpacing="0.5">宮寒梅</text>
          </g>
          {/* B8 花陽浴 wide cap */}
          <g transform="translate(915,10)">
            <rect x="25" y="0" width="20" height="16" rx="3" fill="none" stroke="#c9922a" strokeWidth="2.2"/>
            <rect x="29" y="16" width="12" height="56" rx="1" fill="none" stroke="#c9922a" strokeWidth="2.2"/>
            <path d="M29 72 Q16 84 13 96" fill="none" stroke="#c9922a" strokeWidth="2.2" strokeLinecap="round"/>
            <path d="M41 72 Q54 84 57 96" fill="none" stroke="#c9922a" strokeWidth="2.2" strokeLinecap="round"/>
            <rect x="13" y="96" width="44" height="134" rx="2" fill="none" stroke="#c9922a" strokeWidth="2.2"/>
            <line x1="13" y1="230" x2="57" y2="230" stroke="#c9922a" strokeWidth="2.2" strokeLinecap="round"/>
            <rect x="15" y="144" width="40" height="68" rx="1" fill="none" stroke="#c9922a" strokeWidth="1.5" opacity="0.7"/>
            <line x1="15" y1="158" x2="55" y2="158" stroke="#c9922a" strokeWidth="1" opacity="0.4"/>
            <text x="35" y="202" textAnchor="middle" fontSize="9.5" fill="#c9922a" fontFamily="serif" writingMode="tb" letterSpacing="0.5">花陽浴</text>
          </g>
          {/* B9 花邑 tall neck */}
          <g transform="translate(1045,10)">
            <rect x="28" y="0" width="14" height="18" rx="2.5" fill="none" stroke="#c9922a" strokeWidth="2.2"/>
            <rect x="29" y="18" width="12" height="64" rx="1" fill="none" stroke="#c9922a" strokeWidth="2.2"/>
            <path d="M29 82 Q15 93 12 104" fill="none" stroke="#c9922a" strokeWidth="2.2" strokeLinecap="round"/>
            <path d="M41 82 Q55 93 58 104" fill="none" stroke="#c9922a" strokeWidth="2.2" strokeLinecap="round"/>
            <rect x="12" y="104" width="46" height="126" rx="2" fill="none" stroke="#c9922a" strokeWidth="2.2"/>
            <line x1="12" y1="230" x2="58" y2="230" stroke="#c9922a" strokeWidth="2.2" strokeLinecap="round"/>
            <rect x="14" y="148" width="40" height="64" rx="1" fill="none" stroke="#c9922a" strokeWidth="1.5" opacity="0.7"/>
            <text x="34" y="198" textAnchor="middle" fontSize="11" fill="#c9922a" fontFamily="serif" writingMode="tb" letterSpacing="1">花邑</text>
          </g>
          {/* B10 十四代 repeat */}
          <g transform="translate(1175,10)">
            <rect x="26" y="0" width="18" height="22" rx="4" fill="none" stroke="#c9922a" strokeWidth="2.2"/>
            <rect x="29" y="22" width="12" height="54" rx="1" fill="none" stroke="#c9922a" strokeWidth="2.2"/>
            <path d="M29 76 Q15 87 12 98" fill="none" stroke="#c9922a" strokeWidth="2.2" strokeLinecap="round"/>
            <path d="M41 76 Q55 87 58 98" fill="none" stroke="#c9922a" strokeWidth="2.2" strokeLinecap="round"/>
            <rect x="12" y="98" width="46" height="132" rx="2" fill="none" stroke="#c9922a" strokeWidth="2.2"/>
            <line x1="12" y1="230" x2="58" y2="230" stroke="#c9922a" strokeWidth="2.2" strokeLinecap="round"/>
            <rect x="14" y="148" width="42" height="64" rx="1" fill="none" stroke="#c9922a" strokeWidth="1.5" opacity="0.7"/>
            <text x="35" y="198" textAnchor="middle" fontSize="11" fill="#c9922a" fontFamily="serif" writingMode="tb" letterSpacing="1">十四代</text>
          </g>
        </g>
        </g>
      </svg>

      <div style={{ textAlign: "center" }}>
        <div className="mincho" style={{ fontSize: 19, color: "#e8b84b", letterSpacing: 2, fontWeight: 700 }}>{label}</div>
        <div style={{ display: "flex", justifyContent: "center", gap: 5, marginTop: 12 }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              width: 6, height: 6, borderRadius: "50%", background: "#c9922a",
              animation: `fadeIn 0.6s ${i * 0.2}s ease-in-out infinite alternate`,
              opacity: 0.3,
            }}/>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════ 備份 ═══════════════════════════
// ═══════════════════════════ 管理（備份＋分享合一） ═══════════════════════════
function ManageView({ sakes }) {
  const [section, setSection] = useState("backup"); // "backup" | "share"
  const gold = "#c9922a";
  return (
    <div className="fade-in">
      <div className="mincho" style={{ fontSize: 20, color: gold, marginBottom: 16 }}>管理</div>
      {/* 切換列 */}
      <div style={{ display: "flex", gap: 8, marginBottom: 22, background: "rgba(255,255,255,0.04)", borderRadius: 12, padding: 5 }}>
        {[{ k: "backup", label: "⬇ 備份資料" }, { k: "share", label: "🔗 分享酒窖" }].map(o => (
          <button key={o.k} onClick={() => setSection(o.k)} style={{
            flex: 1, padding: "10px", borderRadius: 9, fontSize: 13, fontWeight: section === o.k ? 700 : 400,
            background: section === o.k ? `linear-gradient(135deg,${gold},#e8b84b)` : "transparent",
            border: "none", color: section === o.k ? "#0e0a06" : "#888", transition: "all .18s",
          }}>{o.label}</button>
        ))}
      </div>

      {/* Saketime 排名連結 */}
      <a href="https://www.saketime.jp/ranking/" target="_blank" rel="noopener noreferrer"
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
          background: "rgba(201,146,42,0.08)", border: "1px solid rgba(201,146,42,0.3)",
          borderRadius: 12, padding: "13px 16px", marginBottom: 20, textDecoration: "none",
          color: gold, transition: "background .15s" }}
        onMouseEnter={e => e.currentTarget.style.background = "rgba(201,146,42,0.15)"}
        onMouseLeave={e => e.currentTarget.style.background = "rgba(201,146,42,0.08)"}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 22 }}>🏆</span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: 1 }}>Saketime 排名</div>
            <div style={{ fontSize: 11, color: "#8a7055", marginTop: 2 }}>saketime.jp · 日本酒人氣排行榜</div>
          </div>
        </div>
        <span style={{ fontSize: 18, opacity: 0.6 }}>↗</span>
      </a>

      {section === "backup" ? <BackupView sakes={sakes} /> : <ShareView sakes={sakes} />}
    </div>
  );
}

function BackupView({ sakes }) {
  const [exporting, setExporting] = useState(false);
  const [done, setDone] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const gold = "#c9922a";

  const handleBackup = async () => {
    setExporting(true);
    setDone(false);
    setStatusMsg("讀取所有資料中…");
    try {
      const { default: JSZip } = await import("jszip");

      // 備份要包含「全部」資料，而非只有畫面上已載入的那頁
      let allSakes = [];
      try {
        allSakes = await fetchAllSakes();
      } catch {
        allSakes = sakes; // 萬一失敗，至少備份已載入的
      }
      if (!allSakes || allSakes.length === 0) allSakes = sakes;

      const zip = new JSZip();
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const folder = zip.folder(`sake_backup_${dateStr}`);
      const imgFolder = folder.folder("images");

      // 產生 data.json（全部酒資料）
      const exportData = allSakes
        .filter(s => s.status === "done" && s.info)
        .map((s, idx) => ({
          id: s.id,
          imageFilename: `images/sake_${String(idx + 1).padStart(3, "0")}.jpg`,
          addedAt: s.addedAt,
          photoDate: s.photoDate || s.info?.photo_date || null,
          location: s.location || s.info?.location || null,
          info: s.info,
        }));

      folder.file("data.json", JSON.stringify(exportData, null, 2));

      // README
      folder.file("README.txt",
        "酒蔵録 備份檔案\n" +
        "=================\n" +
        `備份時間：${new Date().toLocaleString("zh-TW")}\n` +
        `共 ${exportData.length} 筆記錄\n\n` +
        "data.json  — 所有酒的辨識資料（陣列）\n" +
        "images/    — 對應的酒瓶照片\n\n" +
        "每筆資料的 imageFilename 對應 images 資料夾內的檔案\n" +
        "可匯入任何支援此格式的酒窖 App"
      );

      // 下載圖片並加入 ZIP
      const doneList = allSakes.filter(s => s.status === "done" && s.info);
      for (let idx = 0; idx < doneList.length; idx++) {
        const sake = doneList[idx];
        setStatusMsg(`打包照片 ${idx + 1}/${doneList.length}…`);
        if (!sake?.imageUrl) continue;
        try {
          const res = await fetch(sake.imageUrl);
          const blob = await res.blob();
          const filename = `sake_${String(idx + 1).padStart(3, "0")}.jpg`;
          imgFolder.file(filename, blob);
        } catch (e) {
          console.warn("圖片下載失敗:", e);
        }
      }

      setStatusMsg("壓縮中…");
      const zipBlob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sake_backup_${dateStr}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      setStatusMsg("");
      setDone(true);
    } catch (e) {
      console.error("備份失敗:", e);
      alert("備份失敗：" + e.message);
    }
    setExporting(false);
  };

  const successCount = sakes.filter(s => s.status === "done" && s.info).length;

  return (
    <div>
      <div style={{ fontSize: 12, color: "#777", lineHeight: 1.6, marginBottom: 18 }}>將所有酒窖資料打包成 ZIP，可還原至任何裝置或新版本</div>

      {/* 統計 */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 22 }}>
        <div style={{ background: "rgba(201,146,42,0.08)", border: "1px solid rgba(201,146,42,0.2)", borderRadius: 13, padding: "16px 14px", textAlign: "center" }}>
          <div className="mincho" style={{ fontSize: 28, color: gold, fontWeight: 700 }}>{sakes.length}</div>
          <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>酒窖總筆數</div>
        </div>
        <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--line)", borderRadius: 13, padding: "16px 14px", textAlign: "center" }}>
          <div className="mincho" style={{ fontSize: 28, color: "#e8b84b", fontWeight: 700 }}>{successCount}</div>
          <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>含辨識資料</div>
        </div>
      </div>

      {/* 說明 */}
      <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--line)", borderRadius: 13, padding: "16px", marginBottom: 22 }}>
        <div style={{ fontSize: 12, color: "#888", lineHeight: 1.9 }}>
          <strong style={{ color: gold }}>備份內容</strong><br />
          📄 data.json — 所有辨識資料（酒名、品牌、產地、精米步合…全部欄位）<br />
          🖼️ images/ — 原始酒瓶照片<br />
          📋 README.txt — 欄位說明<br /><br />
          <strong style={{ color: gold }}>ZIP 結構</strong><br />
          sake_backup_日期.zip<br />
          {"  "}├ data.json<br />
          {"  "}├ images/<br />
          {"  "}└ README.txt
        </div>
      </div>

      <button
        onClick={handleBackup}
        disabled={exporting}
        style={{
          width: "100%",
          background: exporting ? "#333" : `linear-gradient(135deg,${gold},#e8b84b)`,
          border: "none",
          color: exporting ? "#888" : "#0e0a06",
          borderRadius: 13,
          padding: "15px",
          fontSize: 15,
          fontWeight: 700,
          letterSpacing: 1,
        }}
      >
        {exporting ? "備份中，請稍候…" : done ? "✅ 備份完成！" : "⬇ 一鍵備份全部資料"}
      </button>

      {exporting && (
        <div style={{ textAlign: "center", marginTop: 14, fontSize: 12, color: gold }}>
          {statusMsg || "處理中…"}
        </div>
      )}
      {done && (
        <div style={{ textAlign: "center", marginTop: 14, fontSize: 12, color: "#6a5" }}>
          ZIP 已下載到你的裝置，可存到 iCloud / Google Drive 做永久備份
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════ 詳情 ═══════════════════════════
function DetailSheet({ sake, onClose, onDelete, onReanalyze, onSaveBackImage }) {
  const gold = "#c9922a";
  const i = sake.info || {};
  const isSake = i.category === "日本酒";
  const color = catColor(i.category);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(i.name || "");
  const [imgIndex, setImgIndex] = useState(0); // 0=正面, 1=背面
  const [backPreview, setBackPreview] = useState(null); // { dataUrl, base64, blob }
  const [savingBack, setSavingBack] = useState(false);
  const backFileRef = useRef();
  const isAnalyzing = sake.status === "analyzing";

  const hasBack = !!(sake.backImageUrl || backPreview);
  const images = [sake.imageUrl, sake.backImageUrl || (backPreview?.dataUrl)].filter(Boolean);

  // 切換不同酒款時重置
  useEffect(() => {
    setNameInput((sake.info || {}).name || "");
    setEditingName(false);
    setImgIndex(0);
    setBackPreview(null);
  }, [sake.id, sake.info]);

  // 滑動切換圖片（touch）
  const touchStartX = useRef(null);
  const handleTouchStart = (e) => { touchStartX.current = e.touches[0].clientX; };
  const handleTouchEnd = (e) => {
    if (touchStartX.current === null || images.length < 2) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(dx) > 40) {
      setImgIndex(prev => {
        if (dx < 0) return Math.min(prev + 1, images.length - 1);
        return Math.max(prev - 1, 0);
      });
    }
    touchStartX.current = null;
  };

  // 選取背面圖片
  const handlePickBack = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    compressImage(file).then(({ blob, dataUrl, base64 }) => {
      setBackPreview({ dataUrl, base64, blob });
      setImgIndex(1); // 自動切換顯示背面
    });
    e.target.value = "";
  };

  // 儲存背面圖片
  const handleSaveBack = async () => {
    if (!backPreview) return;
    setSavingBack(true);
    await onSaveBackImage?.(sake.id, backPreview.blob, backPreview.dataUrl);
    setSavingBack(false);
    setBackPreview(null);
  };

  // 修正再辨識（帶入背面圖）
  const doReanalyze = () => {
    const n = nameInput.trim();
    setEditingName(false);
    const backB64 = backPreview?.base64 || null;
    onReanalyze && onReanalyze(sake, n || null, backB64);
  };

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
      <div onClick={e => e.stopPropagation()} style={{ background: "#15100a", borderRadius: "22px 22px 0 0", maxWidth: 460, width: "100%", maxHeight: "calc(100dvh - env(safe-area-inset-top) - 12px)", overflowY: "auto", animation: "slideUp .3s cubic-bezier(0.2,0.8,0.2,1)", paddingBottom: "env(safe-area-inset-bottom)" }} className="no-scrollbar">
        {/* 頂部固定列 */}
        <div style={{ position: "sticky", top: 0, paddingTop: 14, paddingBottom: 10, background: "#15100a", zIndex: 5, borderRadius: "22px 22px 0 0" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", position: "relative", paddingLeft: 14, paddingRight: 14, minHeight: 40 }}>
            <button onClick={onClose} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", display: "flex", alignItems: "center", gap: 3, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", color: "var(--ink)", borderRadius: 99, padding: "8px 15px 8px 11px", fontSize: 13, fontWeight: 500 }}>
              <span style={{ fontSize: 17, lineHeight: 1, marginTop: -1 }}>‹</span> 返回
            </button>
            <div style={{ width: 40, height: 4, background: "#3a3025", borderRadius: 99 }} />
            <button onClick={onClose} style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", color: "#aaa", borderRadius: 99, fontSize: 14 }}>✕</button>
          </div>
        </div>

        {/* 圖片區（可左右滑動切換正/背面） */}
        {sake.imageUrl && (
          <div style={{ padding: "8px 16px 0" }}>
            <div
              style={{ borderRadius: 14, overflow: "hidden", maxHeight: 280, display: "flex", justifyContent: "center", background: "#0a0704", position: "relative", userSelect: "none" }}
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
            >
              <img
                src={images[imgIndex] || sake.imageUrl}
                alt=""
                style={{ width: "100%", objectFit: "contain", maxHeight: 280, transition: "opacity .2s" }}
              />
              {/* 正/背面指示點 */}
              {images.length > 1 && (
                <div style={{ position: "absolute", bottom: 10, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 6 }}>
                  {images.map((_, idx) => (
                    <div key={idx} onClick={() => setImgIndex(idx)} style={{ width: idx === imgIndex ? 18 : 7, height: 7, borderRadius: 99, background: idx === imgIndex ? gold : "rgba(255,255,255,0.35)", transition: "all .2s", cursor: "pointer" }} />
                  ))}
                </div>
              )}
              {/* 圖片標籤 */}
              {images.length > 1 && (
                <div style={{ position: "absolute", top: 10, right: 10, background: "rgba(0,0,0,0.6)", color: imgIndex === 0 ? "#e8b84b" : "#7bb8d3", fontSize: 10, padding: "3px 9px", borderRadius: 99, backdropFilter: "blur(4px)" }}>
                  {imgIndex === 0 ? "正面" : "背面"}
                </div>
              )}
              {/* 左右箭頭（有多張時） */}
              {images.length > 1 && imgIndex > 0 && (
                <button onClick={() => setImgIndex(0)} style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", background: "rgba(0,0,0,0.5)", border: "none", color: "#fff", borderRadius: 99, width: 30, height: 30, fontSize: 16, cursor: "pointer" }}>‹</button>
              )}
              {images.length > 1 && imgIndex < images.length - 1 && (
                <button onClick={() => setImgIndex(1)} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "rgba(0,0,0,0.5)", border: "none", color: "#fff", borderRadius: 99, width: 30, height: 30, fontSize: 16, cursor: "pointer" }}>›</button>
              )}
            </div>

            {/* 背面圖片操作列 */}
            <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
              {!hasBack ? (
                <button
                  onClick={() => backFileRef.current?.click()}
                  style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: "rgba(91,168,211,0.1)", border: "1px dashed rgba(91,168,211,0.4)", color: "#7bb8d3", borderRadius: 10, padding: "8px", fontSize: 12 }}
                >
                  📷 加入背面酒標
                </button>
              ) : (
                <>
                  <button
                    onClick={() => backFileRef.current?.click()}
                    style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: "rgba(91,168,211,0.08)", border: "1px solid rgba(91,168,211,0.3)", color: "#7bb8d3", borderRadius: 10, padding: "8px", fontSize: 12 }}
                  >
                    🔄 更換背面圖
                  </button>
                  {backPreview && !savingBack && (
                    <button
                      onClick={handleSaveBack}
                      style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 4, background: "rgba(91,168,211,0.18)", border: "1px solid rgba(91,168,211,0.5)", color: "#7bb8d3", borderRadius: 10, padding: "8px", fontSize: 12, fontWeight: 600 }}
                    >
                      💾 儲存背面圖
                    </button>
                  )}
                  {savingBack && <span style={{ flex: 1, textAlign: "center", fontSize: 12, color: "#7bb8d3" }}>儲存中…</span>}
                </>
              )}
              <input ref={backFileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handlePickBack} />
            </div>
          </div>
        )}

        <div style={{ padding: "16px 20px 28px" }}>
          {/* 單瓶分享按鈕 */}
          <button id="sake-share-btn" onClick={async () => {
            const shareUrl = `${window.location.origin}/share-sake/${sake.id}`;
            try { await navigator.clipboard.writeText(shareUrl); } catch {}
            const btn = document.getElementById("sake-share-btn");
            if (btn) { btn.textContent = "✅ 連結已複製！"; setTimeout(() => { if (btn) btn.textContent = "🔗 分享這支酒（唯讀連結）"; }, 2200); }
          }} style={{ width: "100%", background: "rgba(201,146,42,0.08)", border: "1px solid rgba(201,146,42,0.3)", color: gold, borderRadius: 10, padding: "9px 14px", fontSize: 12, fontWeight: 600, marginBottom: 14, textAlign: "center" }}>
            🔗 分享這支酒（唯讀連結）
          </button>

          {/* 標題區 */}
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 10 }}>
            <span className="mincho" style={{ fontSize: 11, background: color, color: "#fff", padding: "3px 11px", borderRadius: 99, fontWeight: 600 }}>{i.category || "酒"}</span>
            {i.tokutei && <span style={{ fontSize: 11, background: "rgba(201,146,42,0.18)", color: gold, padding: "3px 11px", borderRadius: 99 }}>{i.tokutei}</span>}
            {(i.tags || []).map((t, x) => <span key={x} style={{ fontSize: 11, background: "rgba(255,255,255,0.06)", color: "#aaa", padding: "3px 11px", borderRadius: 99 }}>{t}</span>)}
          </div>

          {/* 酒名（可編輯 + 修正再辨識，現在也可加入背面圖） */}
          {!editingName ? (
            <>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 3 }}>
                <div className="mincho" style={{ flex: 1, fontSize: 21, color: "var(--ink)", fontWeight: 700, lineHeight: 1.35 }}>{i.name || "未知酒款"}</div>
                {!isAnalyzing && (
                  <button onClick={() => { setNameInput(i.name || ""); setEditingName(true); }} style={{ flexShrink: 0, marginTop: 2, background: "rgba(255,255,255,0.06)", border: "1px solid var(--line)", color: "#bba080", borderRadius: 8, padding: "5px 10px", fontSize: 11 }}>✏️ 修正</button>
                )}
              </div>
              {i.name_kana && <div style={{ fontSize: 12, color: "#7a6a4a", marginBottom: 6 }}>{i.name_kana}</div>}
            </>
          ) : (
            <div style={{ background: "rgba(201,146,42,0.08)", border: "1px solid rgba(201,146,42,0.25)", borderRadius: 12, padding: "12px 14px", marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: gold, marginBottom: 8 }}>修正酒名 + 重新辨識</div>
              <input
                value={nameInput}
                onChange={e => setNameInput(e.target.value)}
                placeholder="例如：鶴齡 純米吟釀（留空則純用圖片辨識）"
                autoFocus
                style={{ width: "100%", background: "rgba(0,0,0,0.3)", border: "1px solid var(--line)", borderRadius: 9, padding: "10px 12px", color: "var(--ink)", fontSize: 15, outline: "none", marginBottom: 10 }}
              />
              {/* 提示：有背面圖會一起送辨識 */}
              {hasBack && (
                <div style={{ fontSize: 11, color: "#7bb8d3", background: "rgba(91,168,211,0.08)", border: "1px solid rgba(91,168,211,0.25)", borderRadius: 8, padding: "7px 10px", marginBottom: 10 }}>
                  📷 背面酒標也會一起送 AI 加強辨識
                </div>
              )}
              {!hasBack && (
                <div style={{ fontSize: 11, color: "#665a44", marginBottom: 10 }}>
                  💡 可先加入背面酒標，讓 AI 辨識更準確
                </div>
              )}
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={doReanalyze} style={{ flex: 1, background: `linear-gradient(135deg,${gold},#e8b84b)`, border: "none", color: "#0e0a06", borderRadius: 9, padding: "10px", fontSize: 13, fontWeight: 700 }}>🔄 {hasBack ? "正+背面加強辨識" : "修正再辨識"}</button>
                <button onClick={() => setEditingName(false)} style={{ padding: "10px 16px", background: "rgba(255,255,255,0.06)", border: "1px solid var(--line)", color: "#aaa", borderRadius: 9, fontSize: 13 }}>取消</button>
              </div>
            </div>
          )}
          <div style={{ fontSize: 13, color: gold, marginBottom: 12 }}>{[i.brewery, i.region].filter(Boolean).join(" · ")}</div>

          {/* 重新辨識中提示 */}
          {isAnalyzing && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(201,146,42,0.08)", border: "1px solid rgba(201,146,42,0.2)", borderRadius: 12, padding: "12px 15px", marginBottom: 16 }}>
              <div style={{ width: 20, height: 20, border: `2.5px solid ${gold}44`, borderTop: `2.5px solid ${gold}`, borderRadius: "50%", animation: "spin 1s linear infinite" }} />
              <span style={{ fontSize: 13, color: gold }}>重新辨識中…</span>
            </div>
          )}

          {/* 辨識失敗訊息 */}
          {sake.status === "error" && (sake.errorMsg || sake.rawDebug) && (
            <div style={{ background: "rgba(183,58,50,0.1)", border: "1px solid rgba(183,58,50,0.3)", borderRadius: 12, padding: "13px 15px", marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: "#d96a62", marginBottom: 6, fontWeight: 600 }}>⚠️ 辨識失敗原因</div>
              {sake.errorMsg && <div style={{ fontSize: 12, color: "#d0c0a0", lineHeight: 1.6, marginBottom: sake.rawDebug ? 8 : 0 }}>{sake.errorMsg}</div>}
              {sake.rawDebug && (
                <div style={{ fontSize: 11, color: "#998", lineHeight: 1.5, background: "rgba(0,0,0,0.25)", borderRadius: 8, padding: "8px 10px", wordBreak: "break-all", maxHeight: 120, overflowY: "auto" }}>
                  AI 回應：{sake.rawDebug}
                </div>
              )}
            </div>
          )}

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

          {/* 參考價格 */}
          {i.price && i.price !== "null" && (
            <div style={{ display: "flex", alignItems: "center", gap: 12, background: "rgba(201,146,42,0.1)", border: "1px solid rgba(201,146,42,0.2)", borderRadius: 12, padding: "13px 16px", marginBottom: 16 }}>
              <span style={{ fontSize: 22 }}>💰</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, color: gold, letterSpacing: 1, marginBottom: 2 }}>台灣參考售價</div>
                <div className="mincho" style={{ fontSize: 17, color: "var(--ink)", fontWeight: 700 }}>{i.price}</div>
              </div>
              <span style={{ fontSize: 9, color: "#665a44", textAlign: "right", lineHeight: 1.4, maxWidth: 70 }}>AI 估算<br/>僅供參考</span>
            </div>
          )}

          {/* 味わいMAP */}
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

// ═══════════════════════════ 分享管理 ═══════════════════════════
function ShareView({ sakes }) {
  const [shareUrl, setShareUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [currentToken, setCurrentToken] = useState(null);
  const gold = "#c9922a";

  // 載入現有 token
  useEffect(() => {
    (async () => {
      setLoading(true);
      const token = await getShareToken();
      if (token) {
        setCurrentToken(token);
        setShareUrl(`${window.location.origin}/share/${token}`);
      }
      setLoading(false);
    })();
  }, []);

  const handleCreate = async () => {
    setCreating(true);
    const token = await createShareToken();
    if (token) {
      setCurrentToken(token);
      setShareUrl(`${window.location.origin}/share/${token}`);
    }
    setCreating(false);
  };

  const handleRevoke = async () => {
    if (!currentToken) return;
    if (!confirm("確定要關閉分享連結？舊連結將立即失效，朋友無法再瀏覽。")) return;
    await deleteShareToken(currentToken);
    setCurrentToken(null);
    setShareUrl(null);
  };

  const handleCopy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
      const el = document.createElement("textarea");
      el.value = shareUrl;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (!hasSupabase) {
    return (
      <div style={{ padding: "4px 0" }}>
        <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--line)", borderRadius: 13, padding: 20, color: "#888", fontSize: 13, lineHeight: 1.7 }}>
          分享功能需要 Supabase 資料庫支援。<br />請先在 .env 設定 VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY。
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ fontSize: 12, color: "#777", lineHeight: 1.6, marginBottom: 18 }}>產生唯讀連結，朋友可瀏覽、搜尋你的酒窖，但無法修改或刪除</div>

      {/* 功能說明 */}
      <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--line)", borderRadius: 13, padding: "16px", marginBottom: 20 }}>
        <div style={{ fontSize: 12, color: "#888", lineHeight: 1.9 }}>
          <strong style={{ color: gold }}>朋友可以做的事</strong><br />
          🔍 搜尋酒名、酒造、產地<br />
          🏷️ 按酒種分類篩選<br />
          ↕️ 依時間或價格排序<br />
          📖 查看每支酒的完整資料<br /><br />
          <strong style={{ color: gold }}>朋友不能做的事</strong><br />
          ✗ 新增 / 刪除 / 修改任何記錄
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: "30px", color: gold, fontSize: 13 }}>載入中…</div>
      ) : shareUrl ? (
        <>
          {/* 連結顯示 */}
          <div style={{ background: "rgba(201,146,42,0.08)", border: "1px solid rgba(201,146,42,0.3)", borderRadius: 13, padding: "16px", marginBottom: 14 }}>
            <div style={{ fontSize: 10, color: gold, letterSpacing: 1, marginBottom: 8 }}>✅ 分享連結已啟用</div>
            <div style={{ fontSize: 11, color: "#bba080", wordBreak: "break-all", lineHeight: 1.6, background: "rgba(0,0,0,0.2)", borderRadius: 8, padding: "8px 10px", marginBottom: 12 }}>
              {shareUrl}
            </div>
            <button
              onClick={handleCopy}
              style={{ width: "100%", background: copied ? "rgba(80,160,80,0.2)" : `linear-gradient(135deg,${gold},#e8b84b)`, border: copied ? "1px solid rgba(80,160,80,0.5)" : "none", color: copied ? "#6a8" : "#0e0a06", borderRadius: 10, padding: "12px", fontSize: 14, fontWeight: 700 }}
            >
              {copied ? "✅ 已複製！" : "📋 複製連結"}
            </button>
          </div>

          {/* 統計 */}
          <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--line)", borderRadius: 12, padding: "13px 16px", marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "#888" }}>酒窖共 {sakes.filter(s => s.status === "done").length} 支酒可供瀏覽</span>
            <span style={{ fontSize: 11, color: "#5a5042" }}>含辨識資料</span>
          </div>

          {/* 關閉連結 */}
          <button
            onClick={handleRevoke}
            style={{ width: "100%", background: "rgba(183,58,50,0.1)", border: "1px solid rgba(183,58,50,0.3)", color: "#d96a62", borderRadius: 11, padding: "11px", fontSize: 13 }}
          >
            🔒 關閉此分享連結
          </button>
          <div style={{ fontSize: 11, color: "#4a4236", textAlign: "center", marginTop: 8 }}>
            關閉後舊連結立即失效，可重新產生新連結
          </div>
        </>
      ) : (
        <>
          <div style={{ textAlign: "center", padding: "30px 20px", color: "#4a4236", marginBottom: 16 }}>
            <div className="mincho" style={{ fontSize: 44, color: "#3a3025", marginBottom: 12 }}>享</div>
            <div style={{ fontSize: 13, color: "#665a44" }}>尚未建立分享連結</div>
          </div>
          <button
            onClick={handleCreate}
            disabled={creating}
            style={{ width: "100%", background: creating ? "#333" : `linear-gradient(135deg,${gold},#e8b84b)`, border: "none", color: creating ? "#888" : "#0e0a06", borderRadius: 13, padding: "15px", fontSize: 15, fontWeight: 700 }}
          >
            {creating ? "建立中…" : "🔗 產生唯讀分享連結"}
          </button>
          <div style={{ fontSize: 11, color: "#5a5042", textAlign: "center", marginTop: 10, lineHeight: 1.6 }}>
            連結可隨時關閉，關閉後立即失效
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════ 唯讀分享酒窖 ═══════════════════════════
function SharedCellar({ token }) {
  const [sakes, setSakes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [invalid, setInvalid] = useState(false);
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("全部");
  const [sortBy, setSortBy] = useState("time-desc");
  const [showSort, setShowSort] = useState(false);
  const [detail, setDetail] = useState(null);
  const gold = "#c9922a";

  // 載入資料：分享頁一次載全部，讓朋友看到完整酒窖
  useEffect(() => {
    (async () => {
      setLoading(true);
      const all = await fetchAllSakesPublic(token);
      if (all === null) { setInvalid(true); setLoading(false); return; }
      setSakes(all);
      setLoading(false);
    })();
  }, [token]);

  const cats = useMemo(() => ["全部", ...new Set(sakes.map(s => s.info?.category).filter(Boolean))], [sakes]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = sakes.filter(s => {
      const i = s.info || {};
      const matchQ = !q || [i.name, i.name_kana, i.brewery, i.region, i.rice, i.tokutei, i.grapes, ...(i.tags || [])].filter(Boolean).some(v => String(v).toLowerCase().includes(q));
      const matchCat = filterCat === "全部" || i.category === filterCat;
      return matchQ && matchCat;
    });
    const parsePrice = (info) => {
      const p = info?.price;
      if (!p || p === "null") return null;
      const nums = String(p).replace(/,/g, "").match(/\d+/g);
      if (!nums || nums.length === 0) return null;
      const vals = nums.map(Number);
      return vals.reduce((a, b) => a + b, 0) / vals.length;
    };
    const [sortKey, sortDir] = (sortBy || "time-desc").split("-");
    const dir = sortDir === "asc" ? 1 : -1;
    list = [...list].sort((a, b) => {
      if (sortKey === "price") {
        const pa = parsePrice(a.info), pb = parsePrice(b.info);
        if (pa == null && pb == null) return new Date(b.addedAt) - new Date(a.addedAt);
        if (pa == null) return 1; if (pb == null) return -1;
        return (pa - pb) * dir;
      }
      return (new Date(a.addedAt) - new Date(b.addedAt)) * dir;
    });
    return list;
  }, [sakes, search, filterCat, sortBy]);

  const sortOptions = [
    { k: "time-desc", label: "加入時間（新→舊）" },
    { k: "time-asc", label: "加入時間（舊→新）" },
    { k: "price-desc", label: "價格（高→低）" },
    { k: "price-asc", label: "價格（低→高）" },
  ];
  const sortShort = { "time-desc": "最新加入", "time-asc": "最早加入", "price-desc": "價格高→低", "price-asc": "價格低→高" };

  if (invalid) {
    return (
      <div style={{ maxWidth: 460, margin: "0 auto", minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 30, background: "#0e0a06", color: "#888" }}>
        <div className="mincho" style={{ fontSize: 48, color: "#3a3025", marginBottom: 16 }}>酒蔵録</div>
        <div style={{ fontSize: 16, color: "#d96a62", marginBottom: 8 }}>連結已失效或不存在</div>
        <div style={{ fontSize: 12, color: "#5a5042", textAlign: "center", lineHeight: 1.7 }}>此分享連結已被主人關閉，或連結有誤。<br />請向分享者索取最新連結。</div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 460, margin: "0 auto", minHeight: "100dvh", display: "flex", flexDirection: "column", background: "#0e0a06", color: "var(--ink)" }}>
      {/* Header */}
      <header style={{ padding: "max(20px, env(safe-area-inset-top)) 20px 14px", background: "linear-gradient(180deg, #170f05, transparent)", position: "sticky", top: 0, zIndex: 20, backdropFilter: "blur(8px)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div className="mincho" style={{ fontSize: 26, fontWeight: 800, color: gold, letterSpacing: 4, lineHeight: 1 }}>酒蔵録</div>
            <div style={{ fontSize: 10, color: "#6a5d45", letterSpacing: 3, marginTop: 5 }}>SAKE CELLAR · {loading ? "共享酒窖" : `蔵 ${sakes.length} 本`}</div>
          </div>
          <div style={{ fontSize: 10, background: "rgba(201,146,42,0.12)", color: "#bba080", border: "1px solid rgba(201,146,42,0.25)", borderRadius: 8, padding: "4px 10px" }}>
            👁 唯讀模式
          </div>
        </div>
      </header>

      <main className="no-scrollbar" style={{ flex: 1, overflowY: "auto", padding: "4px 16px", paddingBottom: "calc(32px + env(safe-area-inset-bottom))" }}>
        {loading ? (
          <StickmanLoading label="載入共享酒窖中…" />
        ) : (
          <div className="fade-in">
            {/* 搜尋列 */}
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <div style={{ position: "relative", flex: 1 }}>
                <span style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", color: "#5a5042", fontSize: 14 }}>🔍</span>
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜尋 酒名 · 酒造 · 産地 · 酒米"
                  style={{ width: "100%", background: "rgba(255,255,255,0.05)", border: "1px solid var(--line)", borderRadius: 12, padding: "11px 36px 11px 38px", color: "var(--ink)", fontSize: 13, outline: "none" }} />
                {search && (
                  <button onClick={() => setSearch("")} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "rgba(255,255,255,0.1)", border: "none", color: "#aaa", borderRadius: 99, width: 22, height: 22, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>✕</button>
                )}
              </div>
            </div>

            {/* 分類 + 排序 */}
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
              <div className="no-scrollbar" style={{ display: "flex", gap: 7, overflowX: "auto", flex: 1 }}>
                {cats.map(c => (
                  <button key={c} onClick={() => setFilterCat(c)} style={{ whiteSpace: "nowrap", padding: "6px 13px", borderRadius: 99, fontSize: 12, background: filterCat === c ? gold : "rgba(255,255,255,0.05)", border: filterCat === c ? "none" : "1px solid var(--line)", color: filterCat === c ? "#0e0a06" : "#999", fontWeight: filterCat === c ? 600 : 400 }}>{c}</button>
                ))}
              </div>
              <button onClick={() => setShowSort(v => !v)} style={{ background: "rgba(255,255,255,0.05)", border: "1px solid var(--line)", borderRadius: 10, padding: "7px 10px", color: "#bba080", fontSize: 11, whiteSpace: "nowrap" }}>
                ↕ {sortShort[sortBy] || "排序"}
              </button>
            </div>
            {showSort && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12, background: "rgba(255,255,255,0.03)", borderRadius: 12, padding: 8 }}>
                {sortOptions.map(({ k, label }) => (
                  <button key={k} onClick={() => { setSortBy(k); setShowSort(false); }} style={{ textAlign: "left", padding: "10px 12px", borderRadius: 9, fontSize: 13, background: sortBy === k ? "rgba(201,146,42,0.2)" : "rgba(255,255,255,0.04)", border: `1px solid ${sortBy === k ? "rgba(201,146,42,0.4)" : "var(--line)"}`, color: sortBy === k ? gold : "#aaa", fontWeight: sortBy === k ? 600 : 400 }}>
                    {sortBy === k ? "✓ " : ""}{label}
                  </button>
                ))}
              </div>
            )}

            {/* 計數（篩選/搜尋時才顯示，總數已在 header 顯示） */}
            {(filterCat !== "全部" || search) && (
              <div style={{ fontSize: 11, color: "#4a4236", marginBottom: 12 }}>
                {filtered.length} 支{filterCat !== "全部" ? ` ${filterCat}` : ""}{search ? ` · 搜尋「${search}」` : ""}
              </div>
            )}

            {/* 酒格列表 */}
            {filtered.length === 0 ? (
              <div style={{ textAlign: "center", padding: "50px 20px", color: "#4a4236" }}>
                <div className="mincho" style={{ fontSize: 40, marginBottom: 10 }}>🍶</div>
                <div style={{ fontSize: 13 }}>找不到符合條件的酒款</div>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 11 }}>
                {filtered.map(sake => (
                  <SakeCard key={sake.id} sake={sake} selected={false} selectMode={false} onSelect={() => {}} onOpen={setDetail} />
                ))}
              </div>
            )}

            <div style={{ textAlign: "center", padding: "24px 0 8px", fontSize: 11, color: "#3a3025" }}>
              酒蔵録 · 唯讀分享模式
            </div>
          </div>
        )}
      </main>

      {/* 唯讀詳情（不顯示刪除 / 修正按鈕） */}
      {detail && (
        <SharedDetailSheet sake={detail} onClose={() => setDetail(null)} />
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes slideUp { from { transform: translateY(100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        .fade-in { animation: fadeIn .3s ease; }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        .no-scrollbar { scrollbar-width: none; }
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .mincho { font-family: 'Noto Serif JP', 'Hiragino Mincho Pro', serif; }
        * { box-sizing: border-box; }
        :root { --ink: #e8d5b0; --line: rgba(255,255,255,0.08); }
        body { background: #0e0a06; margin: 0; font-family: -apple-system, sans-serif; color: var(--ink); }
      `}</style>
    </div>
  );
}

// 唯讀詳情 Sheet（不含修正 / 刪除 / 背面上傳功能）
function SharedDetailSheet({ sake, onClose }) {
  const i = sake.info || {};
  const isSake = i.category === "日本酒";
  const color = catColor(i.category);
  const gold = "#c9922a";
  const [imgIndex, setImgIndex] = useState(0);
  const images = [sake.imageUrl, sake.backImageUrl].filter(Boolean);

  const touchStartX = useRef(null);
  const handleTouchStart = (e) => { touchStartX.current = e.touches[0].clientX; };
  const handleTouchEnd = (e) => {
    if (touchStartX.current === null || images.length < 2) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(dx) > 40) setImgIndex(prev => dx < 0 ? Math.min(prev + 1, images.length - 1) : Math.max(prev - 1, 0));
    touchStartX.current = null;
  };

  const sakeRows = [["精米步合", i.seimai], ["使用酒米", i.rice], ["使用酵母", i.yeast], ["酒精濃度", i.alcohol], ["甘辛度", i.sweetness]].filter(([, v]) => v);
  const wineRows = [["品種", i.grapes], ["年份", i.vintage], ["甜度", i.sweetness], ["酒精濃度", i.alcohol]].filter(([, v]) => v);
  const rows = isSake ? sakeRows : wineRows;

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#15100a", borderRadius: "22px 22px 0 0", maxWidth: 460, width: "100%", maxHeight: "calc(100dvh - env(safe-area-inset-top) - 12px)", overflowY: "auto", animation: "slideUp .3s cubic-bezier(0.2,0.8,0.2,1)", paddingBottom: "env(safe-area-inset-bottom)" }} className="no-scrollbar">
        <div style={{ position: "sticky", top: 0, paddingTop: 14, paddingBottom: 10, background: "#15100a", zIndex: 5, borderRadius: "22px 22px 0 0" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", position: "relative", paddingLeft: 14, paddingRight: 14, minHeight: 40 }}>
            <button onClick={onClose} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", display: "flex", alignItems: "center", gap: 3, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", color: "var(--ink)", borderRadius: 99, padding: "8px 15px 8px 11px", fontSize: 13, fontWeight: 500 }}>
              <span style={{ fontSize: 17, lineHeight: 1, marginTop: -1 }}>‹</span> 返回
            </button>
            <div style={{ width: 40, height: 4, background: "#3a3025", borderRadius: 99 }} />
            <button onClick={onClose} style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", color: "#aaa", borderRadius: 99, fontSize: 14 }}>✕</button>
          </div>
        </div>

        {sake.imageUrl && (
          <div style={{ padding: "8px 16px 0" }}>
            <div style={{ borderRadius: 14, overflow: "hidden", maxHeight: 280, display: "flex", justifyContent: "center", background: "#0a0704", position: "relative", userSelect: "none" }}
              onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
              <img src={images[imgIndex] || sake.imageUrl} alt="" style={{ width: "100%", objectFit: "contain", maxHeight: 280 }} />
              {images.length > 1 && (
                <div style={{ position: "absolute", bottom: 10, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 6 }}>
                  {images.map((_, idx) => (
                    <div key={idx} onClick={() => setImgIndex(idx)} style={{ width: idx === imgIndex ? 18 : 7, height: 7, borderRadius: 99, background: idx === imgIndex ? gold : "rgba(255,255,255,0.35)", transition: "all .2s", cursor: "pointer" }} />
                  ))}
                </div>
              )}
              {images.length > 1 && (
                <div style={{ position: "absolute", top: 10, right: 10, background: "rgba(0,0,0,0.6)", color: imgIndex === 0 ? "#e8b84b" : "#7bb8d3", fontSize: 10, padding: "3px 9px", borderRadius: 99 }}>
                  {imgIndex === 0 ? "正面" : "背面"}
                </div>
              )}
              {images.length > 1 && imgIndex > 0 && (
                <button onClick={() => setImgIndex(0)} style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", background: "rgba(0,0,0,0.5)", border: "none", color: "#fff", borderRadius: 99, width: 30, height: 30, fontSize: 16, cursor: "pointer" }}>‹</button>
              )}
              {images.length > 1 && imgIndex < images.length - 1 && (
                <button onClick={() => setImgIndex(1)} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "rgba(0,0,0,0.5)", border: "none", color: "#fff", borderRadius: 99, width: 30, height: 30, fontSize: 16, cursor: "pointer" }}>›</button>
              )}
            </div>
          </div>
        )}

        <div style={{ padding: "16px 20px 28px" }}>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 10 }}>
            <span className="mincho" style={{ fontSize: 11, background: color, color: "#fff", padding: "3px 11px", borderRadius: 99, fontWeight: 600 }}>{i.category || "酒"}</span>
            {i.tokutei && <span style={{ fontSize: 11, background: "rgba(201,146,42,0.18)", color: gold, padding: "3px 11px", borderRadius: 99 }}>{i.tokutei}</span>}
            {(i.tags || []).map((t, x) => <span key={x} style={{ fontSize: 11, background: "rgba(255,255,255,0.06)", color: "#aaa", padding: "3px 11px", borderRadius: 99 }}>{t}</span>)}
          </div>
          <div className="mincho" style={{ fontSize: 21, color: "var(--ink)", fontWeight: 700, lineHeight: 1.35, marginBottom: 3 }}>{i.name || "未知酒款"}</div>
          {i.name_kana && <div style={{ fontSize: 12, color: "#7a6a4a", marginBottom: 6 }}>{i.name_kana}</div>}
          <div style={{ fontSize: 13, color: gold, marginBottom: 12 }}>{[i.brewery, i.region].filter(Boolean).join(" · ")}</div>

          {(sake.photoDate || sake.location || i.photo_date || i.location) && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
              {(sake.photoDate || i.photo_date) && <span style={{ fontSize: 12, background: "rgba(255,255,255,0.05)", color: "#bba080", padding: "5px 11px", borderRadius: 99 }}>📅 {sake.photoDate || i.photo_date}</span>}
              {(sake.location || i.location) && <span style={{ fontSize: 12, background: "rgba(255,255,255,0.05)", color: "#bba080", padding: "5px 11px", borderRadius: 99 }}>📍 {sake.location || i.location}</span>}
            </div>
          )}

          {i.flavors && (
            <div style={{ background: "rgba(201,146,42,0.07)", border: "1px solid rgba(201,146,42,0.15)", borderRadius: 12, padding: "13px 15px", marginBottom: 16 }}>
              <div style={{ fontSize: 10, color: gold, letterSpacing: 1.5, marginBottom: 5 }}>味わい / TASTING</div>
              <div style={{ fontSize: 13, color: "#d0c0a0", lineHeight: 1.7 }}>{i.flavors}</div>
            </div>
          )}

          {i.price && i.price !== "null" && (
            <div style={{ display: "flex", alignItems: "center", gap: 12, background: "rgba(201,146,42,0.1)", border: "1px solid rgba(201,146,42,0.2)", borderRadius: 12, padding: "13px 16px", marginBottom: 16 }}>
              <span style={{ fontSize: 22 }}>💰</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, color: gold, letterSpacing: 1, marginBottom: 2 }}>台灣參考售價</div>
                <div className="mincho" style={{ fontSize: 17, color: "var(--ink)", fontWeight: 700 }}>{i.price}</div>
              </div>
              <span style={{ fontSize: 9, color: "#665a44", textAlign: "right", lineHeight: 1.4, maxWidth: 70 }}>AI 估算<br/>僅供參考</span>
            </div>
          )}

          {isSake && (i.sake_meter || i.acidity) && (
            <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 12, padding: "16px", marginBottom: 16, display: "flex", justifyContent: "center" }}>
              <TasteMap info={i} />
            </div>
          )}

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

          {i.vessel && (
            <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "11px 14px", background: "rgba(255,255,255,0.03)", borderRadius: 10, marginBottom: 12 }}>
              <span style={{ fontSize: 18 }}>🥂</span>
              <div>
                <div style={{ fontSize: 10, color: "#665a44" }}>建議酒器</div>
                <div style={{ fontSize: 13, color: "var(--ink)" }}>{i.vessel}</div>
              </div>
            </div>
          )}

          {i.food_pairing && (
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "11px 14px", background: "rgba(255,255,255,0.03)", borderRadius: 10, marginBottom: 18 }}>
              <span style={{ fontSize: 18 }}>🍽️</span>
              <div>
                <div style={{ fontSize: 10, color: "#665a44", marginBottom: 2 }}>搭配建議</div>
                <div style={{ fontSize: 13, color: "var(--ink)", lineHeight: 1.6 }}>{i.food_pairing}</div>
              </div>
            </div>
          )}

          <div style={{ fontSize: 11, color: "#4a4236" }}>記錄於 {new Date(sake.addedAt).toLocaleDateString("zh-TW")}</div>
        </div>
      </div>
    </div>
  );
}
