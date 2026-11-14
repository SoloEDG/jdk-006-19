/**
 * 新录音的二进制存放于 IndexedDB（localStorage 容量不够）。
 * 补丁元数据里只保存 `idb:<patchId>/<recordingId>` 引用，打开档案时
 * 再把引用还原成可播放的 blob URL。若音频不在本机，引用保持不可用，
 * 由上层退回原版录音，绝不悄悄播放错误的声音。
 */
const DB_NAME = "midnight-frequency:audio";
const STORE = "recordings";
const REF_PREFIX = "idb:";
const runtimeUrls = new Map<string, string>();
const runtimeBlobs = new Map<string, Blob>();

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("当前环境不支持音频存储"));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE))
        db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("无法打开音频库"));
  });
}

async function idbPut(key: string, blob: Blob) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(blob, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("无法保存音频"));
  });
  db.close();
}

async function idbGet(key: string): Promise<Blob | null> {
  const db = await openDb();
  const blob = await new Promise<Blob | null>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const request = tx.objectStore(STORE).get(key);
    request.onsuccess = () => resolve((request.result as Blob) ?? null);
    request.onerror = () => reject(request.error ?? new Error("无法读取音频"));
  });
  db.close();
  return blob;
}

export function audioRef(patchId: string, recordingId: string) {
  return `${REF_PREFIX}${patchId}/${recordingId}`;
}

export function isAudioRef(value: string) {
  return value.startsWith(REF_PREFIX);
}

/** 保存一条新录音，同时让本次会话立即可播放。 */
export async function storeAudio(ref: string, blob: Blob) {
  runtimeBlobs.set(ref, blob);
  runtimeUrls.set(ref, URL.createObjectURL(blob));
  if (typeof indexedDB !== "undefined") await idbPut(ref.slice(REF_PREFIX.length), blob);
}

/** 启动时按补丁中的引用恢复 blob URL。 */
export async function hydrateAudio(refs: string[]) {
  let restored = 0;
  for (const ref of refs) {
    if (!isAudioRef(ref) || runtimeUrls.has(ref)) continue;
    try {
      const blob = await idbGet(ref.slice(REF_PREFIX.length));
      if (!blob) continue;
      runtimeBlobs.set(ref, blob);
      runtimeUrls.set(ref, URL.createObjectURL(blob));
      restored++;
    } catch {
      // 恢复失败时保持不可用，上层会退回原版。
    }
  }
  return restored;
}

export function audioUrl(ref: string): string | null {
  if (isAudioRef(ref)) return runtimeUrls.get(ref) ?? null;
  return /^(blob:|data:|https?:|\/)/.test(ref) ? ref : null;
}

export function audioAvailable(ref: string) {
  return audioUrl(ref) !== null;
}

/** 导出时读取原始二进制；缺失时返回 null。 */
export async function audioBlob(ref: string): Promise<Blob | null> {
  if (runtimeBlobs.has(ref)) return runtimeBlobs.get(ref)!;
  if (!isAudioRef(ref) || typeof indexedDB === "undefined") return null;
  try {
    return await idbGet(ref.slice(REF_PREFIX.length));
  } catch {
    return null;
  }
}
