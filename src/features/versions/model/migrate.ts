import type {
  AppliedPatch,
  AudioBookmark,
  CaseContent,
  CaseSnapshot,
  Episode,
  EvidenceNote,
  HeardHistory,
  NoteMigration,
  PatchRecording,
  ResumePoint,
  SceneId,
  VersionPatch,
} from "../../../shared/types";
import { resolveEpisode } from "../../story";
import { mapPoint, mapRange, mapHeardThrough, type UnmappableReason } from "./mapping";

export type PreviewOutcome =
  | { kind: "migrated"; anchor: AudioBookmark }
  | { kind: "pending"; reason: UnmappableReason };

export interface ScenePreview {
  sceneId: SceneId;
  baseId: string;
  targetId: string;
  title: string;
  baseTitle: string;
  recording: PatchRecording;
  notes: { note: EvidenceNote; outcome: PreviewOutcome }[];
  /** 该旧音源的已听进度（单一数字，按点换算）。 */
  heard: { value: number; outcome: PreviewOutcome } | null;
  /** 该场景的继续播放位置。 */
  resume: PreviewOutcome | null;
  /** 已收集线索在新录音中的声窗是否仍然存在。 */
  clues: {
    clueId: string;
    title: string;
    outcome:
      | { kind: "ok"; start: number; end: number }
      | { kind: "missing"; reason: "window-gone" | "cues-changed" };
  }[];
}

export interface PatchPreview {
  patch: VersionPatch;
  scenes: ScenePreview[];
  counts: {
    migratedNotes: number;
    pendingNotes: number;
    migratedHeard: number;
    pendingHeard: number;
    migratedResume: number;
    pendingResume: number;
    clueWindows: number;
    clueWindowMissing: number;
  };
  /** 无法解释的音频映射或加载失败：整次启用被取消。 */
  blocking: string[];
}

export interface PreviewInput {
  content: CaseContent;
  snapshot: CaseSnapshot;
  patch: VersionPatch;
  /** 当前存档已掌握的线索，用于核对声窗。 */
  clues: string[];
  /** 当前章节的继续播放位置。 */
  resume: { sceneId: SceneId; position: number; rate: number };
}

function episodeOf(content: CaseContent, id: string): Episode | undefined {
  return content.episodes.find((episode) => episode.id === id);
}

/**
 * 旧存档的笔记可能没有记录来源音源。若同一场景下有多个候选音源
 * （例如守塔人的两条录音），就无法说明笔记原先取自哪一条，必须标记为
 * 不唯一，不能按任一条猜测。
 */
function noteSource(
  note: EvidenceNote,
  content: CaseContent,
): { episodeId?: string; ambiguous?: boolean } {
  if (note.anchor.sourceEpisodeId)
    return { episodeId: note.anchor.sourceEpisodeId };
  const candidates = content.episodes.filter(
    (episode) => episode.sceneId === note.anchor.sceneId,
  );
  if (candidates.length === 1) return { episodeId: candidates[0].id };
  return { ambiguous: true };
}

export function previewPatch(input: PreviewInput): PatchPreview {
  const { content, snapshot, patch } = input;
  const blocking: string[] = [];
  const seenTargets = new Set<string>();
  const seenBases = new Set<string>();
  for (const recording of patch.recordings) {
    if (seenTargets.has(recording.id))
      blocking.push(`录音「${recording.id}」重复出现`);
    seenTargets.add(recording.id);
    if (seenBases.has(recording.replaces!))
      blocking.push(`旧音源「${recording.replaces}」被多个新录音替换`);
    seenBases.add(recording.replaces!);
    if (!episodeOf(content, recording.replaces!))
      blocking.push(`找不到被替换的音源「${recording.replaces}」`);
    if (episodeOf(content, recording.id))
      blocking.push(`录音编号「${recording.id}」已经存在`);
  }

  const scenes = patch.recordings.map((recording): ScenePreview => {
    const base = episodeOf(content, recording.replaces!);
    // 补丁可以针对任意一版现有录音；旧秒数必须相对该版才能换算。
    const sceneId = base?.sceneId ?? recording.sceneId;
    const baseId = base?.id ?? recording.replaces!,
      targetId = recording.id;

    const notes = snapshot.evidence.notes
      .map((note) => ({ note, source: noteSource(note, content) }))
      .filter(
        ({ note, source }) =>
          source.episodeId === baseId ||
          (source.ambiguous && note.anchor.sceneId === sceneId),
      )
      .map(({ note, source }) => ({
        note,
        outcome: source.ambiguous
          ? ({ kind: "pending", reason: "ambiguous" } as PreviewOutcome)
          : anchorOutcome(recording, note.anchor, baseId, targetId),
      }));

    const heardValue = snapshot.heard[baseId];
    const heard =
      heardValue === undefined
        ? null
        : {
            value: heardValue,
            outcome: heardOutcome(recording, heardValue, sceneId, targetId),
          };

    const resume =
      input.resume.sceneId === sceneId
        ? pointOutcome(recording, input.resume.position, sceneId, targetId)
        : null;

    return {
      sceneId,
      baseId,
      targetId,
      title: recording.title,
      baseTitle: base?.title ?? baseId,
      recording,
      notes,
      heard,
      resume,
      clues: clueWindows(input, recording, base, baseId),
    };
  });

  const counts = {
    migratedNotes: 0,
    pendingNotes: 0,
    migratedHeard: 0,
    pendingHeard: 0,
    migratedResume: 0,
    pendingResume: 0,
    clueWindows: 0,
    clueWindowMissing: 0,
  };
  for (const scene of scenes) {
    for (const item of scene.notes) {
      if (item.outcome.kind === "migrated") counts.migratedNotes++;
      else counts.pendingNotes++;
    }
    if (scene.heard) {
      if (scene.heard.outcome.kind === "migrated") counts.migratedHeard++;
      else counts.pendingHeard++;
    }
    if (scene.resume) {
      if (scene.resume.kind === "migrated") counts.migratedResume++;
      else counts.pendingResume++;
    }
    for (const clue of scene.clues) {
      if (clue.outcome.kind === "ok") counts.clueWindows++;
      else counts.clueWindowMissing++;
    }
  }
  return { patch, scenes, counts, blocking };
}

function anchorOutcome(
  recording: PatchRecording,
  anchor: AudioBookmark,
  baseId: string,
  targetId: string,
): PreviewOutcome {
  if (anchor.sourceEpisodeId && anchor.sourceEpisodeId !== baseId)
    return { kind: "pending", reason: "ambiguous" };
  const mapped = mapRange(
    recording.segments,
    anchor.start,
    anchor.end,
    recording.sceneId,
    targetId,
  );
  return "anchor" in mapped
    ? { kind: "migrated", anchor: mapped.anchor! }
    : { kind: "pending", reason: mapped.reason! };
}

function heardOutcome(
  recording: PatchRecording,
  position: number,
  sceneId: SceneId,
  targetId: string,
): PreviewOutcome {
  const mapped = mapHeardThrough(recording.segments, position);
  return "position" in mapped
    ? {
        kind: "migrated",
        anchor: {
          sceneId,
          start: 0,
          end: mapped.position!,
          sourceEpisodeId: targetId,
        },
      }
    : { kind: "pending", reason: mapped.reason! };
}

function pointOutcome(
  recording: PatchRecording,
  position: number,
  sceneId: SceneId,
  targetId: string,
): PreviewOutcome {
  const mapped = mapPoint(recording.segments, position);
  return "position" in mapped
    ? {
        kind: "migrated",
        anchor: {
          sceneId,
          start: mapped.position!,
          end: mapped.position!,
          sourceEpisodeId: targetId,
        },
      }
    : { kind: "pending", reason: mapped.reason! };
}

function clueWindows(
  input: PreviewInput,
  recording: PatchRecording,
  base: Episode | undefined,
  baseId: string,
): ScenePreview["clues"] {
  if (!base) return [];
  // 只核对「当前剧情实际使用」的那条录音中、已经收集的线索。
  const canonical = resolveEpisode(input.content, base.sceneId, input.clues);
  if (canonical.id !== baseId) return [];
  const target = input.content.episodes.find(
    (episode) => episode.id === recording.id,
  );
  const cues = recording.cues ?? target?.cues ?? [];
  return canonical.cues
    .filter((cue) => cue.sound && input.clues.includes(cue.sound.clueId))
    .map((cue) => {
      const clueId = cue.sound!.clueId;
      const title =
        input.content.clues.find((clue) => clue.id === clueId)?.title ?? clueId;
      const mapped = mapRange(
        recording.segments,
        cue.sound!.start,
        cue.sound!.end,
        base.sceneId,
        recording.id,
      );
      if (!("anchor" in mapped))
        return {
          clueId,
          title,
          outcome: { kind: "missing", reason: "window-gone" } as const,
        };
      const window = cues.find((item) => item.sound?.clueId === clueId)?.sound;
      const matches =
        window &&
        Math.abs(window.start - mapped.anchor!.start) <= 0.5 &&
        Math.abs(window.end - mapped.anchor!.end) <= 0.5;
      if (matches)
        return {
          clueId,
          title,
          outcome: { kind: "ok", start: window.start, end: window.end } as const,
        };
      return {
        clueId,
        title,
        outcome: { kind: "missing", reason: "cues-changed" } as const,
      };
    });
}

export interface ApplyResult {
  snapshot: CaseSnapshot;
  applied: AppliedPatch;
}

/**
 * 确认启用补丁。仅改写预览判定为可迁移的锚点；无法唯一定位的笔记
 * 保留旧源与旧秒数，并留下迁移依据供之后人工处理。原版录音不会被
 * 删除，随时可以切回。
 */
export function applyPatch(
  snapshot: CaseSnapshot,
  preview: PatchPreview,
  now: number,
): ApplyResult {
  if (preview.blocking.length) throw new Error(preview.blocking.join("；"));
  const previewNote = new Map<
    string,
    { outcome: PreviewOutcome; scene: ScenePreview }
  >();
  for (const scene of preview.scenes)
    for (const item of scene.notes)
      previewNote.set(item.note.id, { outcome: item.outcome, scene });

  const notes = snapshot.evidence.notes.map((note) => {
    const entry = previewNote.get(note.id);
    if (!entry) return note;
    const { outcome, scene } = entry;
    const migration: NoteMigration = {
      patchId: preview.patch.id,
      baseEpisodeId: scene.baseId,
      targetEpisodeId: scene.targetId,
      status: outcome.kind,
      ...(outcome.kind === "pending" ? { reason: outcome.reason } : {}),
      oldAnchor: { ...note.anchor },
      migratedAt: now,
    };
    if (outcome.kind === "migrated")
      return { ...note, anchor: outcome.anchor, migration };
    return {
      ...note,
      // 保留旧源与旧秒数；只补上来源标记，方便回听。
      anchor: {
        ...note.anchor,
        sourceEpisodeId: note.anchor.sourceEpisodeId ?? scene.baseId,
      },
      migration,
    };
  });

  const heard: HeardHistory = { ...snapshot.heard };
  let resume: ResumePoint = { ...snapshot.resume };
  for (const scene of preview.scenes) {
    if (scene.heard) {
      if (scene.heard.outcome.kind === "migrated")
        heard[scene.targetId] = Math.max(
          heard[scene.targetId] ?? 0,
          scene.heard.outcome.anchor.end,
        );
      // 原版录音仍然保留，因此旧的已听进度也继续保留。
    }
    if (scene.resume?.kind === "migrated")
      resume = {
        ...resume,
        position: scene.resume.anchor.end,
        episodeId: scene.targetId,
      };
    else if (scene.resume)
      // 无法换算时继续使用原版位置，不猜测新秒数。
      resume = {
        ...resume,
        episodeId: scene.baseId,
      };
  }

  const clueChecks: AppliedPatch["clueChecks"] = [];
  for (const scene of preview.scenes)
    for (const clue of scene.clues)
      clueChecks.push(
        clue.outcome.kind === "ok"
          ? {
              clueId: clue.clueId,
              targetEpisodeId: scene.targetId,
              status: "ok",
              start: clue.outcome.start,
              end: clue.outcome.end,
            }
          : {
              clueId: clue.clueId,
              targetEpisodeId: scene.targetId,
              status: "missing",
            },
      );

  const applied: AppliedPatch = {
    patch: preview.patch,
    appliedAt: now,
    recordings: preview.scenes.map((scene) => ({
      baseId: scene.baseId,
      targetId: scene.targetId,
      sceneId: scene.sceneId,
    })),
    ...(clueChecks.length ? { clueChecks } : {}),
  };
  return {
    snapshot: {
      ...snapshot,
      evidence: { ...snapshot.evidence, notes },
      heard,
      resume,
    },
    applied,
  };
}
