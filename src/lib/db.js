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

// 初次載入專用：只撈文字欄位（不含圖片），速度更快，搜尋立即可用
export async function fetchSakesTextOnly({ limit = 100, offset = 0 } = {}) {
  if (hasSupabase) {
    const { data, error } = await supabase
      .from("sakes")
      .select("id, info, added_at")
      .order("added_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) { console.error(error); return []; }
    return (data || []).map(r => ({
      id: r.id,
      imageUrl: null,       // 先留空，背景補
      backImageUrl: null,
      info: r.info,
      status: "done",
      addedAt: r.added_at,
    }));
  }
  // localStorage 模式：直接用現有資料
  try {
    const d = localStorage.getItem(LOCAL_KEY);
    const all = d ? JSON.parse(d) : [];
    return all.slice(offset, offset + limit).map(s => ({ ...s, imageUrl: null }));
  } catch { return []; }
}

// 背景補圖：給一組 id，回傳 { id -> imageUrl } 對照表
export async function fetchImageUrls(ids) {
  if (!hasSupabase || !ids.length) return {};
  const { data, error } = await supabase
    .from("sakes")
    .select("id, image_url, back_image_url")
    .in("id", ids);
  if (error) { console.error(error); return {}; }
  const map = {};
  for (const r of (data || [])) {
    map[r.id] = { imageUrl: r.image_url, backImageUrl: r.back_image_url || null };
  }
  return map;
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
    // 上傳正面圖片到 storage
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

// ── 背面圖片上傳 ──
export async function uploadBackImage(sakeId, blob) {
  if (!hasSupabase) return null;
  const path = `sakes/${sakeId}_back.jpg`;
  const { error } = await supabase.storage
    .from("sake-images")
    .upload(path, blob, { contentType: "image/jpeg", upsert: true });
  if (error) { console.error("背面圖片上傳失敗:", error.message); return null; }
  const { data } = supabase.storage.from("sake-images").getPublicUrl(path);
  return data.publicUrl;
}

export async function deleteSake(id) {
  if (hasSupabase) {
    await supabase.storage.from("sake-images").remove([`sakes/${id}.jpg`, `sakes/${id}_back.jpg`]);
    const { error } = await supabase.from("sakes").delete().eq("id", id);
    if (error) console.error(error);
    return;
  }
  const all = await fetchSakes();
  saveLocal(all.filter(s => s.id !== id));
}

// ── 分享功能 ──
export async function createShareToken() {
  if (!hasSupabase) return null;
  const token = crypto.randomUUID();
  const { error } = await supabase.from("share_tokens").insert({
    token,
    created_at: new Date().toISOString(),
  });
  if (error) { console.error("建立分享碼失敗:", error.message); return null; }
  return token;
}

export async function getShareToken() {
  if (!hasSupabase) return null;
  const { data, error } = await supabase
    .from("share_tokens")
    .select("token")
    .order("created_at", { ascending: false })
    .limit(1);
  if (error || !data || data.length === 0) return null;
  return data[0].token;
}

export async function deleteShareToken(token) {
  if (!hasSupabase) return;
  await supabase.from("share_tokens").delete().eq("token", token);
}

export async function verifyShareToken(token) {
  if (!hasSupabase) return false;
  const { data, error } = await supabase
    .from("share_tokens")
    .select("token")
    .eq("token", token)
    .single();
  if (error || !data) return false;
  return true;
}

export async function fetchSakesPublic(token, { limit = 20, offset = 0 } = {}) {
  if (!hasSupabase) return [];
  // 先驗 token 有效性
  const valid = await verifyShareToken(token);
  if (!valid) return null; // null 代表 token 無效
  const { data, error } = await supabase
    .from("sakes")
    .select("*")
    .order("added_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) { console.error(error); return []; }
  return (data || []).map(rowToSake);
}

export async function fetchAllSakesPublic(token) {
  if (!hasSupabase) return [];
  const valid = await verifyShareToken(token);
  if (!valid) return null;
  const { data, error } = await supabase
    .from("sakes")
    .select("*")
    .order("added_at", { ascending: false });
  if (error) { console.error(error); return []; }
  return (data || []).map(rowToSake);
}

function saveLocal(arr) {
  try {
    const lite = arr.map(({ imageBlob, ...rest }) => rest);
    localStorage.setItem(LOCAL_KEY, JSON.stringify(lite));
  } catch (e) { console.warn("localStorage full", e); }
}

// ── Row 轉換 ──
function rowToSake(r) {
  return {
    id: r.id,
    imageUrl: r.image_url,
    backImageUrl: r.back_image_url || null,
    info: r.info,
    status: "done",
    addedAt: r.added_at,
  };
}
function sakeToRow(s) {
  return {
    id: s.id,
    image_url: s.imageUrl,
    back_image_url: s.backImageUrl || null,
    info: s.info,
    added_at: s.addedAt || new Date().toISOString(),
  };
}
function patchToRow(p) {
  const row = {};
  if ("imageUrl" in p) row.image_url = p.imageUrl;
  if ("backImageUrl" in p) row.back_image_url = p.backImageUrl;
  if ("info" in p) row.info = p.info;
  return row;
}

// ── 單支酒公開查詢（分享單瓶用）──
export async function fetchSakeByIdPublic(id) {
  if (!hasSupabase) return null;
  const { data, error } = await supabase
    .from("sakes")
    .select("*")
    .eq("id", id)
    .single();
  if (error || !data) return null;
  return rowToSake(data);
}
