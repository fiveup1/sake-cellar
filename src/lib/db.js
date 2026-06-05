import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

// 如果還沒設定 Supabase，使用 localStorage 備援模式
export const hasSupabase = Boolean(url && key);
export const supabase = hasSupabase ? createClient(url, key) : null;

const LOCAL_KEY = "sake_cellar_v1";

// ── 統一資料存取層（自動切換 Supabase / localStorage）──────────────────────

// 分頁載入（limit/offset），加速初次開啟
export async function fetchSakes({ limit = 20, offset = 0 } = {}) {
  if (hasSupabase) {
    const { data, error } = await supabase
      .from("sakes")
      .select("*")
      .order("added_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) { console.error(error); return []; }
    return (data || []).map(rowToSake);
  }
  try {
    const d = localStorage.getItem(LOCAL_KEY);
    const all = d ? JSON.parse(d) : [];
    return all.slice(offset, offset + limit);
  } catch { return []; }
}

// 備份用：一次撈全部
export async function fetchAllSakes() {
  if (hasSupabase) {
    const { data, error } = await supabase
      .from("sakes")
      .select("*")
      .order("added_at", { ascending: false });
    if (error) { console.error(error); return []; }
    return (data || []).map(rowToSake);
  }
  try {
    const d = localStorage.getItem(LOCAL_KEY);
    return d ? JSON.parse(d) : [];
  } catch { return []; }
}

export async function insertSake(sake) {
  if (hasSupabase) {
    // 上傳圖片到 storage
    let imageUrl = sake.imageUrl;
    if (sake.imageBlob) {
      const path = `sakes/${sake.id}.jpg`;
      const { error: upErr } = await supabase.storage
        .from("sake-images")
        .upload(path, sake.imageBlob, { contentType: "image/jpeg", upsert: true });
      if (upErr) {
        console.error("圖片上傳失敗:", upErr.message);
      } else {
        const { data } = supabase.storage.from("sake-images").getPublicUrl(path);
        imageUrl = data.publicUrl;
      }
    }
    const row = sakeToRow({ ...sake, imageUrl });
    const { error } = await supabase.from("sakes").insert(row);
    if (error) {
      // 寫入資料庫失敗 → 拋出，讓上層知道（會顯示在卡片上）
      console.error("資料庫寫入失敗:", error.message);
      throw new Error("DB insert failed: " + error.message);
    }
    return { ...sake, imageUrl };
  }
  // localStorage 模式
  const all = await fetchSakes();
  const next = [sake, ...all];
  saveLocal(next);
  return sake;
}

export async function updateSake(id, patch) {
  if (hasSupabase) {
    const { error } = await supabase.from("sakes").update(patchToRow(patch)).eq("id", id);
    if (error) console.error(error);
    return;
  }
  const all = await fetchSakes();
  saveLocal(all.map(s => s.id === id ? { ...s, ...patch } : s));
}

export async function deleteSake(id) {
  if (hasSupabase) {
    await supabase.storage.from("sake-images").remove([`sakes/${id}.jpg`]);
    const { error } = await supabase.from("sakes").delete().eq("id", id);
    if (error) console.error(error);
    return;
  }
  const all = await fetchSakes();
  saveLocal(all.filter(s => s.id !== id));
}

function saveLocal(arr) {
  try {
    // localStorage 模式下移除 blob 避免爆容量
    const lite = arr.map(({ imageBlob, ...rest }) => rest);
    localStorage.setItem(LOCAL_KEY, JSON.stringify(lite));
  } catch (e) { console.warn("localStorage full", e); }
}

// ── Row 轉換 ──
function rowToSake(r) {
  return {
    id: r.id,
    imageUrl: r.image_url,
    info: r.info,
    status: "done",
    addedAt: r.added_at,
  };
}
function sakeToRow(s) {
  return {
    id: s.id,
    image_url: s.imageUrl,
    info: s.info,
    added_at: s.addedAt || new Date().toISOString(),
  };
}
function patchToRow(p) {
  const row = {};
  if ("imageUrl" in p) row.image_url = p.imageUrl;
  if ("info" in p) row.info = p.info;
  return row;
}
