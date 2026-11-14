import type {
  AppliedPatch,
  CaseContent,
  Episode,
  SceneId,
} from "../../../shared/types";
import { resolveEpisode } from "../../story";
import { isAudioRef, audioUrl } from "../lib/audioStore";
import { mapPoint, mapPointBack } from "./mapping";
import { recordingFor, targetFor } from "./catalog";

/**
 * 当前场景应当播放的录音。剧情默认音源（可能因线索切换）先解析出来，
 * 再套用已启用的补丁；若该场景被标记为「继续使用原版」，则停留在原版。
 */
export function resolvePlayableEpisode(
  content: CaseContent,
  sceneId: SceneId,
  clues: string[],
  applied: AppliedPatch[],
  originalScenes: SceneId[] = [],
): Episode {
  const canonical = resolveEpisode(content, sceneId, clues);
  if (originalScenes.includes(sceneId)) return canonical;
  // 沿补丁链找到最新一版；原版录音始终保留在内容里。
  const targetId = targetFor(applied, canonical.id) ?? canonical.id;
  const target = content.episodes.find((episode) => episode.id === targetId);
  if (!target) return canonical;
  // 新录音尚未从本机恢复时退回原版，绝不悄悄播放加载失败的音源。
  if (isAudioRef(target.audio) && !audioUrl(target.audio)) return canonical;
  return target;
}

/** 该场景是否存在可供切换的原版/最新版选择。 */
export function versionChoice(
  content: CaseContent,
  sceneId: SceneId,
  applied: AppliedPatch[],
  clues: string[],
): { base: Episode; target: Episode } | null {
  // 只有当前剧情实际使用的音源被补丁替换过时，才有可比较的两个版本。
  const canonical = resolveEpisode(content, sceneId, clues);
  const latestId = targetFor(applied, canonical.id);
  if (!latestId) return null;
  const target = content.episodes.find(
    (episode) => episode.id === latestId,
  );
  const base = content.episodes.find(
    (episode) => episode.id === canonical.id,
  );
  return base && target ? { base, target } : null;
}

/**
 * 从原版往前换算到补丁链上的某一版。每一段都必须能唯一对应；
 * 任何一步失败就返回 null，由调用方停在相近位置而不是猜秒数。
 */
export function mapForwardThroughChain(
  applied: AppliedPatch[],
  fromEpisodeId: string,
  toEpisodeId: string,
  position: number,
): number | null {
  let current = fromEpisodeId,
    value = position;
  for (let guard = 0; guard < 16; guard++) {
    if (current === toEpisodeId) return value;
    const next = targetFor(applied, current);
    if (!next) return null;
    const found = recordingFor(applied, next);
    if (!found) return null;
    const mapped = mapPoint(found.recording.segments, value);
    if (!("position" in mapped)) return null;
    value = mapped.position!;
    current = next;
  }
  return null;
}

/** 从新版反向换算回原版，用于切回历史回听。 */
export function mapBackThroughChain(
  applied: AppliedPatch[],
  fromEpisodeId: string,
  toEpisodeId: string,
  position: number,
): number | null {
  let current = fromEpisodeId,
    value = position;
  for (let guard = 0; guard < 16; guard++) {
    if (current === toEpisodeId) return value;
    const found = recordingFor(applied, current);
    if (!found) return null;
    const mapped = mapPointBack(found.recording.segments, value);
    if (!("position" in mapped)) return null;
    value = mapped.position!;
    current = found.recording.replaces!;
  }
  return null;
}
