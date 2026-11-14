import type { AppliedPatch, Episode } from "../../../shared/types";
import { audioUrl } from "../lib/audioStore";

/**
 * 由已启用的补丁生成可播放音源。原版音源永远保留；新音源只是新增，
 * 通过 `baseEpisodeId` 指回被替换的版本。音频尚未在本机恢复时，
 * `audio` 保持原始引用，上层会退回原版而不是播放错误的声音。
 */
export function patchedEpisodes(
  base: Episode[],
  applied: AppliedPatch[],
  resolveAudio: (ref: string) => string | null = audioUrl,
): Episode[] {
  const result = [...base];
  for (const entry of applied) {
    for (const recording of entry.patch.recordings) {
      if (result.some((episode) => episode.id === recording.id)) continue;
      // 后一个补丁可能替换前一个补丁生成的新版，因此也在已合并结果中查找。
      const source = result.find(
        (episode) => episode.id === recording.replaces,
      );
      result.push({
        id: recording.id,
        sceneId: recording.sceneId,
        title: recording.title,
        version: recording.version,
        description: recording.description || source?.description || "",
        audio: resolveAudio(recording.audio) ?? recording.audio,
        duration: recording.duration,
        cues: recording.cues ?? source?.cues ?? [],
        wave: recording.wave ?? source?.wave ?? [],
        baseEpisodeId: recording.replaces,
        patchId: entry.patch.id,
      });
    }
  }
  return result;
}

/** 生成该音源的那条补丁录音（含片段映射）。 */
export function recordingFor(
  applied: AppliedPatch[],
  episodeId: string,
) {
  for (let i = applied.length - 1; i >= 0; i--) {
    const recording = applied[i].patch.recordings.find(
      (item) => item.id === episodeId,
    );
    if (recording) return { recording, entry: applied[i] };
  }
  return null;
}

export function baseFor(
  applied: AppliedPatch[],
  episodeId: string,
): string | null {
  return recordingFor(applied, episodeId)?.recording.replaces ?? null;
}

/**
 * 沿补丁链找到最新一版音频。补丁可以连续叠加：第二个补丁既可以直接
 * 替换原版，也可以替换前一个补丁产生的新版。
 */
export function targetFor(
  applied: AppliedPatch[],
  episodeId: string,
): string | null {
  let current: string | null = episodeId;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    seen.add(current);
    const next: string | null = latestTargetFor(applied, current);
    if (!next) break;
    current = next;
  }
  return current && current !== episodeId ? current : null;
}

function latestTargetFor(
  applied: AppliedPatch[],
  episodeId: string,
): string | null {
  for (let i = applied.length - 1; i >= 0; i--) {
    const found = applied[i].recordings.find(
      (item) => item.baseId === episodeId,
    );
    if (found) return found.targetId;
  }
  return null;
}
