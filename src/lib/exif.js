// 輕量 EXIF 解析器 — 從 JPEG 讀取拍攝日期與 GPS 座標
// 不依賴外部套件，直接解析二進位

export async function extractExif(file) {
  try {
    const buffer = await file.slice(0, 256 * 1024).arrayBuffer(); // EXIF 在檔案開頭，讀前 256KB 足夠
    const view = new DataView(buffer);

    // 確認是 JPEG
    if (view.getUint16(0) !== 0xFFD8) return { date: null, lat: null, lng: null };

    let offset = 2;
    const len = view.byteLength;

    while (offset < len) {
      if (view.getUint16(offset) === 0xFFE1) {
        // APP1 區段（EXIF）
        return parseExifSegment(view, offset + 4);
      }
      // 跳到下一個 marker
      if ((view.getUint16(offset) & 0xFF00) !== 0xFF00) break;
      offset += 2 + view.getUint16(offset + 2);
    }
  } catch (e) {
    console.warn("EXIF parse failed:", e);
  }
  return { date: null, lat: null, lng: null };
}

function parseExifSegment(view, start) {
  const result = { date: null, lat: null, lng: null };

  // 確認 "Exif\0\0"
  if (view.getUint32(start) !== 0x45786966) return result;
  const tiffStart = start + 6;

  // 位元組順序
  const little = view.getUint16(tiffStart) === 0x4949;
  const get16 = (o) => view.getUint16(o, little);
  const get32 = (o) => view.getUint32(o, little);

  const ifd0 = tiffStart + get32(tiffStart + 4);
  let exifIFD = null;
  let gpsIFD = null;

  // 讀 IFD0
  const entries0 = get16(ifd0);
  for (let i = 0; i < entries0; i++) {
    const entry = ifd0 + 2 + i * 12;
    const tag = get16(entry);
    if (tag === 0x8769) exifIFD = tiffStart + get32(entry + 8); // ExifOffset
    if (tag === 0x8825) gpsIFD = tiffStart + get32(entry + 8);  // GPSInfo
  }

  // 讀 ExifIFD 取得拍攝日期 (DateTimeOriginal 0x9003)
  if (exifIFD) {
    const entriesE = get16(exifIFD);
    for (let i = 0; i < entriesE; i++) {
      const entry = exifIFD + 2 + i * 12;
      const tag = get16(entry);
      if (tag === 0x9003 || tag === 0x9004) {
        const valOffset = tiffStart + get32(entry + 8);
        const str = readString(view, valOffset, 19); // "YYYY:MM:DD HH:MM:SS"
        const m = str.match(/(\d{4}):(\d{2}):(\d{2})/);
        if (m) result.date = `${m[1]}-${m[2]}-${m[3]}`;
        break;
      }
    }
  }

  // 讀 GPS IFD
  if (gpsIFD) {
    let latRef = "N", lngRef = "E", lat = null, lng = null;
    const entriesG = get16(gpsIFD);
    for (let i = 0; i < entriesG; i++) {
      const entry = gpsIFD + 2 + i * 12;
      const tag = get16(entry);
      if (tag === 1) latRef = readString(view, gpsIFD + 2 + i * 12 + 8, 1);
      if (tag === 3) lngRef = readString(view, gpsIFD + 2 + i * 12 + 8, 1);
      if (tag === 2) lat = readGpsCoord(view, tiffStart + get32(entry + 8), little);
      if (tag === 4) lng = readGpsCoord(view, tiffStart + get32(entry + 8), little);
    }
    if (lat != null && lng != null) {
      result.lat = latRef === "S" ? -lat : lat;
      result.lng = lngRef === "W" ? -lng : lng;
    }
  }

  return result;
}

function readGpsCoord(view, offset, little) {
  const get32 = (o) => view.getUint32(o, little);
  // 3 個 rational（度/分/秒）
  const deg = get32(offset) / get32(offset + 4);
  const min = get32(offset + 8) / get32(offset + 12);
  const sec = get32(offset + 16) / get32(offset + 20);
  return deg + min / 60 + sec / 3600;
}

function readString(view, offset, maxLen) {
  let str = "";
  for (let i = 0; i < maxLen; i++) {
    const c = view.getUint8(offset + i);
    if (c === 0) break;
    str += String.fromCharCode(c);
  }
  return str;
}

// ── 反向地理編碼：GPS 座標 → 地名（如「日本 東京」「台灣 新竹」）──
// 用免費的 OpenStreetMap Nominatim API
export async function reverseGeocode(lat, lng) {
  if (lat == null || lng == null) return null;
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=10&accept-language=zh-TW`,
      { headers: { "Accept": "application/json" } }
    );
    const data = await res.json();
    const a = data.address || {};
    const country = a.country || "";
    const city = a.city || a.county || a.state || a.town || a.suburb || "";
    if (country && city) return `${country} ${city}`;
    if (country) return country;
    return null;
  } catch (e) {
    console.warn("geocode failed:", e);
    return null;
  }
}
