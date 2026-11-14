import type {
  AudioBookmark,
  CaseContent,
  CaseSnapshot,
  Episode,
  EvidenceNote,
  HeardHistory,
  NoteMigration,
  SceneId,
} from "../../../shared/types";
import { patchedEpisodes } from "../../versions/model/catalog";
type Obj = Record<string, unknown>;
function object(value: unknown, label: string): Obj {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label}格式无效`);
  return value as Obj;
}
function string(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label}必须是文字`);
  return value;
}
function number(value: unknown, label: string, min = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min)
    throw new Error(`${label}数值无效`);
  return value;
}
function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label}必须是列表`);
  return value;
}
function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label}必须是布尔值`);
  return value;
}

const REASONS = [
  "deleted",
  "split",
  "changed",
  "ambiguous",
  "outside",
] as const;

/**
 * 校验存档。`appliedPatches` 为存档自带、且已经校验过的补丁；
 * 补丁音源会并入 `content` 后再检查秒数是否落在对应录音内。
 */
export function validateSnapshot(
  input: unknown,
  content: CaseContent,
  appliedPatches: CaseSnapshot["appliedPatches"] = [],
): CaseSnapshot {
  const root = object(input, "存档");
  if (root.version !== 1) throw new Error("不支持的存档版本");
  if (root.caseId !== content.id) throw new Error("存档不属于当前案件");
  const episodes: Episode[] = appliedPatches.length
    ? patchedEpisodes(content.episodes, appliedPatches)
    : content.episodes;
  const episodeIds = new Set(episodes.map((episode) => episode.id));
  const scene = (value: unknown): SceneId => {
    const id = string(value, "场景");
    if (!content.scenes.some((item) => item.id === id))
      throw new Error("存档包含未知场景");
    return id as SceneId;
  };
  const clue = (value: unknown): string => {
    const id = string(value, "线索");
    if (!content.clues.some((item) => item.id === id))
      throw new Error("存档包含未知线索");
    return id;
  };
  const episode = (value: unknown, label: string): string => {
    const id = string(value, label);
    if (!episodeIds.has(id)) throw new Error(`${label}指向未知录音`);
    return id;
  };
  const duration = (sceneId: SceneId) =>
    Math.max(
      0,
      ...episodes
        .filter((item) => item.sceneId === sceneId)
        .map((item) => item.duration),
    );
  const anchor = (value: unknown): AudioBookmark => {
    const a = object(value, "笔记锚点");
    const sceneId = scene(a.sceneId),
      start = number(a.start, "范围起点"),
      end = number(a.end, "范围终点");
    if (end < start) throw new Error("笔记范围无效");
    const sourceEpisodeId =
      a.sourceEpisodeId === undefined
        ? undefined
        : episode(a.sourceEpisodeId, "笔记来源");
    const limit = sourceEpisodeId
      ? episodes.find((item) => item.id === sourceEpisodeId)!.duration
      : duration(sceneId);
    if (end > limit + 0.05) throw new Error("笔记范围超出音频");
    return {
      sceneId,
      start,
      end,
      ...(sourceEpisodeId ? { sourceEpisodeId } : {}),
    };
  };
  // 迁移依据指向补丁中的旧/新音源，因此必须在补丁音源合并后才能校验。
  const migration = (value: unknown): NoteMigration | undefined => {
    if (value === undefined || value === null) return undefined;
    const m = object(value, "迁移依据");
    const status = m.status === "migrated" || m.status === "pending"
      ? m.status
      : (() => {
          throw new Error("迁移状态无效");
        })();
    const reason =
      m.reason === undefined
        ? undefined
        : (REASONS as readonly string[]).includes(String(m.reason))
          ? (m.reason as NoteMigration["reason"])
          : (() => {
              throw new Error("迁移原因无效");
            })();
    if (status === "migrated" && reason) throw new Error("已迁移的笔记不应带待处理原因");
    if (status === "pending" && !reason) throw new Error("待处理笔记缺少原因");
    return {
      patchId: string(m.patchId, "补丁编号"),
      baseEpisodeId: episode(m.baseEpisodeId, "迁移旧源"),
      targetEpisodeId: episode(m.targetEpisodeId, "迁移新源"),
      status,
      ...(reason ? { reason } : {}),
      oldAnchor: anchor(m.oldAnchor),
      migratedAt: number(m.migratedAt, "迁移时间"),
    };
  };
  const rawStory = object(root.story, "调查进度");
  const decisions = array(rawStory.decisions, "决策").map((value) => {
    const d = object(value, "决策");
    const sceneId = scene(d.sceneId),
      choiceId = string(d.choiceId, "选项");
    if (
      !content.scenes
        .find((item) => item.id === sceneId)
        ?.choices.some((item) => item.id === choiceId)
    )
      throw new Error("存档包含未知选项");
    return { sceneId, choiceId };
  });
  const story = {
    sceneId: scene(rawStory.sceneId),
    visited: array(rawStory.visited, "到访场景").map(scene),
    decisions,
    ending: rawStory.ending === null ? null : string(rawStory.ending, "结局"),
  };
  const rawEvidence = object(root.evidence, "手记");
  const notes: EvidenceNote[] = array(rawEvidence.notes, "笔记").map(
    (value) => {
      const n = object(value, "笔记");
      const id = string(n.id, "笔记编号");
      if (!id) throw new Error("笔记编号为空");
      return {
        id,
        clueId: n.clueId === null ? null : clue(n.clueId),
        title: string(n.title, "笔记标题"),
        text: string(n.text, "笔记内容"),
        anchor: anchor(n.anchor),
        createdAt: number(n.createdAt, "笔记日期"),
        pinned: boolean(n.pinned, "置顶"),
        ...(n.migration !== undefined
          ? { migration: migration(n.migration) }
          : {}),
      };
    },
  );
  if (new Set(notes.map((note) => note.id)).size !== notes.length)
    throw new Error("笔记编号重复");
  const clues = array(rawEvidence.clues, "线索").map(clue);
  if (new Set(clues).size !== clues.length) throw new Error("线索重复");
  const selectedId =
    rawEvidence.selectedId === null
      ? null
      : string(rawEvidence.selectedId, "选中笔记");
  if (selectedId && !notes.some((note) => note.id === selectedId))
    throw new Error("选中的笔记不存在");
  const heard: HeardHistory = {};
  for (const [id, value] of Object.entries(object(root.heard, "收听记录"))) {
    const item = episodes.find((entry) => entry.id === id);
    if (!item) throw new Error("收听记录包含未知音源");
    const position = number(value, "收听位置");
    if (position > item.duration + 0.05) throw new Error("收听位置超出音频");
    heard[id] = position;
  }
  const rawResume = object(root.resume, "播放进度");
  const sceneId = scene(rawResume.sceneId),
    position = number(rawResume.position, "播放位置"),
    rate = number(rawResume.rate, "播放速度");
  const episodeId =
    rawResume.episodeId === undefined
      ? undefined
      : episode(rawResume.episodeId, "播放音源");
  if (position > duration(sceneId) || rate < 0.25 || rate > 4)
    throw new Error("播放进度无效");
  const originalScenes = Array.isArray(root.originalScenes)
    ? root.originalScenes.map(scene)
    : undefined;
  return {
    version: 1,
    caseId: content.id,
    story,
    evidence: { notes, clues, selectedId },
    heard,
    resume: { sceneId, position, rate, ...(episodeId ? { episodeId } : {}) },
    ...(appliedPatches.length ? { appliedPatches } : {}),
    ...(originalScenes && originalScenes.length ? { originalScenes } : {}),
  };
}
