import type {
  AppliedPatch,
  CaseContent,
  VersionPatch,
} from "../../../shared/types";
import { parseVersionPatch } from "../model/patch";
import { patchedEpisodes } from "../model/catalog";

/** 将已启用的补丁音源合并进案件内容，供存档校验与播放共用。 */
export function withPatchedEpisodes(
  content: CaseContent,
  applied: AppliedPatch[],
): CaseContent {
  if (!applied.length) return content;
  return {
    ...content,
    episodes: patchedEpisodes(content.episodes, applied),
  };
}

/**
 * 校验存档中携带的补丁。补丁里的音频引用可以是 `idb:`、`data:` 或普通地址；
 * 结构必须能被完整解释，否则整份存档按损坏处理。
 */
export function validateAppliedPatches(
  input: unknown,
  content: CaseContent,
): AppliedPatch[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw new Error("存档的版本补丁格式无效");
  const applied: AppliedPatch[] = [];
  let working = content;
  for (const value of input) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("存档的版本补丁格式无效");
    const entry = value as Record<string, unknown>;
    const rawPatch = entry.patch as VersionPatch | undefined;
    const patch = parseVersionPatch(
      rawPatch,
      working,
      applied.map((item) => item.patch.id),
    );
    const appliedAt =
      typeof entry.appliedAt === "number" && Number.isFinite(entry.appliedAt)
        ? entry.appliedAt
        : patch.createdAt;
    const appliedEntry: AppliedPatch = {
      patch,
      appliedAt,
      recordings: patch.recordings.map((recording) => ({
        baseId: recording.replaces!,
        targetId: recording.id,
        sceneId: recording.sceneId,
      })),
      ...(Array.isArray(entry.clueChecks)
        ? {
            clueChecks: entry.clueChecks.flatMap((check) => {
              if (!check || typeof check !== "object") return [];
              const item = check as Record<string, unknown>;
              if (typeof item.clueId !== "string") return [];
              if (!content.clues.some((clue) => clue.id === item.clueId))
                return [];
              return [
                item.status === "ok"
                  ? {
                      clueId: item.clueId,
                      targetEpisodeId: String(item.targetEpisodeId),
                      status: "ok" as const,
                      ...(typeof item.start === "number"
                        ? { start: item.start }
                        : {}),
                      ...(typeof item.end === "number" ? { end: item.end } : {}),
                    }
                  : {
                      clueId: item.clueId,
                      targetEpisodeId: String(item.targetEpisodeId),
                      status: "missing" as const,
                    },
              ];
            }),
          }
        : {}),
    };
    applied.push(appliedEntry);
    working = withPatchedEpisodes(working, [appliedEntry]);
  }
  return applied;
}
