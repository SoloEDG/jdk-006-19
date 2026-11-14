import type { AppliedPatch } from "../../../shared/types";
import { audioBlob, audioRef, isAudioRef, storeAudio } from "./audioStore";

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("无法读取音频"));
    reader.readAsDataURL(blob);
  });
}
function dataUrlToBlob(value: string): Blob {
  const [meta, payload] = value.split(",");
  const type = /data:([^;]+)/.exec(meta)?.[1] ?? "audio/wav";
  if (meta.includes(";base64")) {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type });
  }
  return new Blob([decodeURIComponent(payload)], { type });
}

/**
 * 导出前把存放在本机的补丁音频内联为 data URL，档案文件才能被带到
 * 另一台设备继续收听同一份新录音。读不到的音频保持原引用，导入端
 * 会退回原版并提示。
 */
export async function embedPatchAudio(
  applied: AppliedPatch[],
): Promise<AppliedPatch[]> {
  return Promise.all(
    applied.map(async (entry) => ({
      ...entry,
      patch: {
        ...entry.patch,
        recordings: await Promise.all(
          entry.patch.recordings.map(async (recording) => {
            if (!isAudioRef(recording.audio)) return recording;
            const blob = await audioBlob(recording.audio);
            return blob
              ? { ...recording, audio: await blobToDataUrl(blob) }
              : recording;
          }),
        ),
      },
    })),
  );
}

/** 导入后把内联音频重新落盘，快照里只留本机引用。 */
export async function absorbPatchAudio(
  applied: AppliedPatch[],
): Promise<AppliedPatch[]> {
  return Promise.all(
    applied.map(async (entry) => ({
      ...entry,
      patch: {
        ...entry.patch,
        recordings: await Promise.all(
          entry.patch.recordings.map(async (recording) => {
            if (!recording.audio.startsWith("data:")) return recording;
            const ref = audioRef(entry.patch.id, recording.id);
            try {
              await storeAudio(ref, dataUrlToBlob(recording.audio));
              return { ...recording, audio: ref };
            } catch {
              return recording;
            }
          }),
        ),
      },
    })),
  );
}
