import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AppliedPatch,
  CaseSnapshot,
  Cue,
  EvidenceNote,
  HeardHistory,
  SaveSlot,
  SceneId,
} from "../shared/types";
import {
  CASE_CONTENT,
  createInvestigation,
  enterScene,
  applyChoice,
  resolveEpisode,
} from "../features/story";
import { useTransport, recordPosition } from "../features/listening";
import {
  createEvidence,
  addNote,
  collectClue,
  editNote,
  deleteNote,
  togglePinned,
} from "../features/evidence";
import {
  readSlots,
  createSnapshot,
  createSlot,
  writeSlot,
  deleteSlot,
  parseImported,
  exportSlot,
  validateSnapshot,
} from "../features/profiles";
import {
  applyPatch,
  hydrateAudio,
  isAudioRef,
  audioUrl,
  withPatchedEpisodes,
  resolvePlayableEpisode,
  versionChoice,
  embedPatchAudio,
  absorbPatchAudio,
  mapForwardThroughChain,
  mapBackThroughChain,
  type PatchPreview,
} from "../features/versions";
export function useCase() {
  const [boot] = useState(() => readSlots(CASE_CONTENT));
  const [story, setStory] = useState(createInvestigation),
    [evidence, setEvidence] = useState(createEvidence),
    [heard, setHeard] = useState<HeardHistory>({}),
    [slots, setSlots] = useState<SaveSlot[]>(boot.slots),
    [activeId, setActiveId] = useState<string | null>(null),
    [applied, setApplied] = useState<AppliedPatch[]>([]),
    [originalScenes, setOriginalScenes] = useState<SceneId[]>([]),
    // 从笔记或补丁跳转时临时指定要听的音源（例如另一条同场景录音）。
    [override, setOverride] = useState<{
      sceneId: SceneId;
      episodeId: string;
    } | null>(null),
    [audioEpoch, setAudioEpoch] = useState(0),
    [notice, setNotice] = useState(
      boot.warning || "戴上耳机，从第一通来电开始调查。",
    ),
    [dirty, setDirty] = useState(false);

  // 已启用的补丁音源并入案件内容；原版音源始终保留。
  const content = useMemo(
    () => withPatchedEpisodes(CASE_CONTENT, applied),
    // 本机音频恢复后（audioEpoch 变化）重新解析可播放地址。
    [applied, audioEpoch],
  );
  const canonical = resolveEpisode(content, story.sceneId, evidence.clues);
  const playable = resolvePlayableEpisode(
    content,
    story.sceneId,
    evidence.clues,
    applied,
    originalScenes,
  );
  const overrideEpisode =
    override?.sceneId === story.sceneId
      ? content.episodes.find((item) => item.id === override.episodeId)
      : undefined;
  const episode =
    overrideEpisode &&
    (!isAudioRef(overrideEpisode.audio) || audioUrl(overrideEpisode.audio))
      ? overrideEpisode
      : playable;
  const versions = versionChoice(
    content,
    story.sceneId,
    applied,
    evidence.clues,
  );

  // 本机保存的补丁音频按需恢复成可播放地址；恢复后重新挂载播放器。
  useEffect(() => {
    const refs = applied
      .flatMap((entry) =>
        entry.patch.recordings.map((recording) => recording.audio),
      )
      .filter(isAudioRef);
    if (!refs.length) return;
    let live = true;
    void hydrateAudio(refs).then((restored) => {
      if (live && restored) {
        setAudioEpoch((n) => n + 1);
        setNotice("新录音已从本机存档恢复，可继续回听。");
      }
    });
    return () => {
      live = false;
    };
  }, [applied]);

  const onHeard = useCallback((id: string, position: number) => {
    setHeard((h) => recordPosition(h, id, position));
  }, []);
  const audio = useTransport(episode, onHeard);

  const run = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "操作未完成，请重试");
    }
  };
  const go = (id: SceneId, position = 0) => {
    audio.pause();
    // 章节导航回到该场景默认版本；同一场景内定位（如时间码）保留当前版本。
    if (id !== story.sceneId || position === 0) setOverride(null);
    if (id === story.sceneId) {
      audio.seek(position);
    } else {
      audio.queueSeek(position);
    }
    if (id !== story.sceneId) setStory((s) => enterScene(CASE_CONTENT, s, id));
    setDirty(true);
  };
  const choose = (id: string) =>
    run(() => {
      const next = applyChoice(CASE_CONTENT, story, id, evidence.clues);
      audio.pause();
      audio.queueSeek(0);
      setStory(next);
      setDirty(true);
      setNotice(
        next.ending
          ? "你已还原案件。仍可回听录音、整理证据。"
          : "调查方向已更新，点击播放继续收听。",
      );
    });
  const note = () => {
    const anchor = audio.captureRange(story.sceneId, 5);
    if (!anchor) {
      setNotice("请等待录音载入后再标记");
      return;
    }
    setEvidence((s) =>
      addNote(
        s,
        { ...anchor, sourceEpisodeId: anchor.sourceEpisodeId ?? episode.id },
        "在这里写下你的观察…",
        "声音标记",
      ),
    );
    setDirty(true);
    setNotice("已记录最近五秒，可在笔记中编辑或回听。");
  };
  const collect = (cue: Cue) => {
    const anchor = audio.captureRange(
      story.sceneId,
      Math.max(1, (cue.sound?.end || cue.end) - (cue.sound?.start || cue.start)),
    );
    if (!anchor) return;
    const sound = cue.sound;
    const result = collectClue(evidence, episode, cue, heard, {
      ...anchor,
      start: sound?.start ?? cue.start,
      end: sound?.end ?? cue.end,
      sourceEpisodeId: episode.id,
    });
    if (!result) {
      setNotice("请先听完这段声音，或检查是否已收集。");
      return;
    }
    audio.pause();
    setEvidence(result);
    setDirty(true);
    setNotice(
      "声音线索已归档，对话可能因此发生变化。若录音经过版本补丁迁移，请重新核对声窗。",
    );
  };
  const jump = (n: EvidenceNote) => {
    const sourceId = n.anchor.sourceEpisodeId;
    const target = sourceId
      ? content.episodes.find((item) => item.id === sourceId)
      : undefined;
    if (target) {
      // 笔记可能指向另一版录音。切换到那一版，再按它自己的秒数定位，
      // 绝不在新版上按旧秒数硬跳。
      setOverride({ sceneId: target.sceneId, episodeId: target.id });
      if (target.patchId) {
        // 指向补丁新版时，场景默认就应播放新版，无需强制原版。
        setOriginalScenes((list) =>
          list.filter((scene) => scene !== target.sceneId),
        );
      }
      if (target.sceneId !== story.sceneId || target.id !== episode.id) {
        // 播放器即将换源，先记下目标位置，等新音源载入后再定位。
        if (target.sceneId !== story.sceneId)
          setStory((s) => enterScene(CASE_CONTENT, s, target.sceneId));
        audio.queueSeek(n.anchor.start);
        audio.queueRate(audio.view.rate);
      } else {
        audio.seek(n.anchor.start);
      }
      setNotice(
        `已切换到「${target.version}」并定位到「${n.title}」的原始秒数。`,
      );
      return;
    }
    go(n.anchor.sceneId, n.anchor.start);
    setNotice(`已定位到「${n.title}」对应声音，点击播放回听。`);
  };

  // 在场景内切换原版 / 新版录音，并尽量停在同一声画位置。
  const setSceneVersion = (sceneId: SceneId, original: boolean) => {
    const nextOriginal = original
      ? [...new Set([...originalScenes, sceneId])]
      : originalScenes.filter((id) => id !== sceneId);
    const next = resolvePlayableEpisode(
      content,
      sceneId,
      evidence.clues,
      applied,
      nextOriginal,
    );
    if (next.id === episode.id) return;
    // 沿补丁链换算位置：切回原版用反向映射，切到新版用正向映射。
    const position = original
      ? mapBackThroughChain(applied, episode.id, next.id, audio.view.position)
      : mapForwardThroughChain(
          applied,
          episode.id,
          next.id,
          audio.view.position,
        );
    audio.pause();
    audio.queueSeek(
      position ?? Math.min(audio.view.position, next.duration),
    );
    audio.queueRate(audio.view.rate);
    setOriginalScenes(nextOriginal);
    setOverride(null);
    setDirty(true);
    setNotice(
      position !== null
        ? `已切换到「${next.version}」，停在同一声画。`
        : `已切换到「${next.version}」，这一处无法精确对应，已停在相近位置。`,
    );
  };

  const save = (name: string) =>
    run(() => {
      const snapshot = createSnapshot(
        CASE_CONTENT,
        story,
        evidence,
        heard,
        {
          sceneId: story.sceneId,
          position: audio.view.position,
          rate: audio.view.rate,
          episodeId: episode.id,
        },
        applied,
        originalScenes,
      );
      const old = slots.find((s) => s.id === activeId);
      const slot =
        old && name === old.name
          ? { ...old, updatedAt: Date.now(), snapshot }
          : createSlot(name, snapshot);
      const next = writeSlot(slots, slot);
      setSlots(next);
      setActiveId(slot.id);
      setDirty(false);
      setNotice(`调查进度「${slot.name}」已保存。`);
    });

  const load = (id: string) =>
    run(() => {
      const slot = slots.find((s) => s.id === id);
      if (!slot) throw new Error("存档不存在");
      const snap: CaseSnapshot = validateSnapshot(
        slot.snapshot,
        CASE_CONTENT,
        slot.snapshot.appliedPatches ?? [],
      );
      const loadedContent = withPatchedEpisodes(
        CASE_CONTENT,
        snap.appliedPatches ?? [],
      );
      const nextEpisode = resolvePlayableEpisode(
        loadedContent,
        snap.story.sceneId,
        snap.evidence.clues,
        snap.appliedPatches ?? [],
        snap.originalScenes,
      );
      audio.pause();
      // 载入后播放的音源可能不同；即使编号相同，也重新排队定位，
      // 避免沿用上一份调查的位置。
      if (nextEpisode.id !== episode.id) {
        audio.queueSeek(snap.resume.position);
        audio.queueRate(snap.resume.rate);
      }
      setApplied(snap.appliedPatches ?? []);
      setOriginalScenes(snap.originalScenes ?? []);
      setOverride(null);
      setStory(snap.story);
      setEvidence(snap.evidence);
      setHeard(snap.heard);
      setActiveId(id);
      setDirty(false);
      setNotice(`已载入「${slot.name}」，点击播放继续调查。`);
      if (nextEpisode.id === episode.id) {
        audio.seek(snap.resume.position);
        audio.setRate(snap.resume.rate);
      }
      // 补丁音频可能刚由本机索引恢复，重新计算可播放地址。
      setAudioEpoch((n) => n + 1);
    });

  const importText = (text: string) =>
    run(() => {
      const slot = parseImported(text, CASE_CONTENT);
      const inlineAudio = (slot.snapshot.appliedPatches ?? []).flatMap(
        (entry) =>
          entry.patch.recordings
            .map((recording) => recording.audio)
            .filter((ref) => ref.startsWith("data:")),
      );
      void (async () => {
        try {
          if (inlineAudio.length) {
            const absorbed = await absorbPatchAudio(
              slot.snapshot.appliedPatches ?? [],
            );
            const stored = {
              ...slot,
              snapshot: {
                ...slot.snapshot,
                appliedPatches: absorbed,
              },
            };
            setSlots(writeSlot(slots, createSlot(slot.name, stored.snapshot)));
          } else {
            setSlots(writeSlot(slots, slot));
          }
          setNotice(
            inlineAudio.length
              ? "导入成功，补丁迁移依据与新录音已一并恢复。"
              : "导入成功，已另存为独立调查进度。",
          );
        } catch (e) {
          setNotice(e instanceof Error ? e.message : "导入失败");
        }
      })();
    });

  const download = (id: string) => {
    const s = slots.find((s) => s.id === id);
    if (!s) {
      setNotice("存档不存在");
      return;
    }
    void (async () => {
      try {
        // 把本机索引里的补丁音频内联进导出文件，迁移依据随档案一起走。
        const embedded = await embedPatchAudio(s.snapshot.appliedPatches ?? []);
        const blob = new Blob(
          [
            exportSlot({
              ...s,
              snapshot: { ...s.snapshot, appliedPatches: embedded },
            }),
          ],
          { type: "application/json" },
        );
        const url = URL.createObjectURL(blob),
          a = document.createElement("a");
        a.href = url;
        a.download = `雾港来电-${s.name}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (e) {
        setNotice(e instanceof Error ? e.message : "导出失败");
      }
    })();
  };

  // 用户确认补丁后，把预览结果写进当前调查。
  const enablePatch = (payload: {
    applied: AppliedPatch;
    snapshot: CaseSnapshot;
    preview: PatchPreview;
  }) => {
    const { applied: entry, snapshot } = payload;
    const currentSceneMigrated = payload.preview.scenes.some(
      (scene) =>
        scene.sceneId === story.sceneId &&
        scene.resume?.kind === "migrated",
    );
    const currentScenePending = payload.preview.scenes.some(
      (scene) =>
        scene.sceneId === story.sceneId &&
        scene.resume?.kind === "pending",
    );
    audio.pause();
    setApplied((list) => [...list, entry]);
    setOverride(null);
    setEvidence(snapshot.evidence);
    setHeard(snapshot.heard);
    // 新补丁默认启用新版；只有继续播放位置无法迁移时才退回原版。
    setOriginalScenes((list) =>
      list.filter(
        (scene) => !entry.recordings.some((item) => item.sceneId === scene),
      ),
    );
    if (currentSceneMigrated) {
      audio.queueSeek(snapshot.resume.position);
      audio.queueRate(audio.view.rate);
    } else if (currentScenePending)
      // 无法迁移时继续停在原版录音当前的位置。
      setOriginalScenes((list) =>
        list.includes(story.sceneId) ? list : [...list, story.sceneId],
      );
    setDirty(true);
    const missing = payload.preview.counts.clueWindowMissing;
    setNotice(
      missing
        ? `补丁已启用；${missing} 条正式线索的声窗需要重新核对。原始录音仍可切换回听。`
        : "补丁已启用，原版录音仍保留随时可回听。",
    );
  };

  const pendingNotes = evidence.notes.filter(
    (note) => note.migration?.status === "pending",
  );
  // 版本补丁启用后，声窗在新录音中找不到的正式线索需要重新核对。
  const missingClues = useMemo(
    () =>
      new Set(
        applied.flatMap((entry) =>
          (entry.clueChecks ?? [])
            .filter((check) => check.status === "missing")
            .map((check) => check.clueId),
        ),
      ),
    [applied],
  );

  // 手动处理一条待迁移笔记：在当前录音中重新标记声窗，或继续保留旧源。
  const resolvePending = (
    id: string,
    anchor?: { start: number; end: number },
  ) => {
    setEvidence((state) => ({
      ...state,
      notes: state.notes.map((note) => {
        if (note.id !== id || !note.migration) return note;
        if (!anchor)
          // 「继续保留旧源」明确结束这次自动迁移，旧秒数保持不动。
          return {
            ...note,
            migration: {
              ...note.migration,
              status: "pending",
              reason: note.migration.reason ?? "ambiguous",
            },
          };
        return {
          ...note,
          anchor: {
            sceneId: story.sceneId,
            start: anchor.start,
            end: anchor.end,
            sourceEpisodeId: episode.id,
          },
          migration: {
            ...note.migration,
            status: "migrated",
            reason: undefined,
          },
        };
      }),
    }));
    setDirty(true);
    setNotice(
      anchor
        ? "已用当前录音中的声窗重新定位这条笔记。"
        : "笔记继续保留旧源，可点回听切换到原版。",
    );
  };

  return {
    story,
    evidence,
    heard,
    slots,
    activeId,
    applied,
    originalScenes,
    versions,
    pendingNotes,
    missingClues,
    notice,
    dirty,
    episode,
    canonical,
    content,
    audio,
    go,
    choose,
    note,
    collect,
    jump,
    save,
    load,
    importText,
    download,
    enablePatch,
    setSceneVersion,
    resolvePending,
    edit: (id: string, text: string) => {
      setEvidence((s) => editNote(s, id, text));
      setDirty(true);
    },
    remove: (id: string) => {
      setEvidence((s) => deleteNote(s, id));
      setDirty(true);
    },
    pin: (id: string) => {
      setEvidence((s) => togglePinned(s, id));
      setDirty(true);
    },
    removeSlot: (id: string) =>
      run(() => {
        setSlots(deleteSlot(slots, id));
        if (activeId === id) setActiveId(null);
      }),
    reset: () => {
      audio.pause();
      if (story.sceneId !== "arrival") audio.queueSeek(0);
      setStory(createInvestigation());
      setEvidence(createEvidence());
      setHeard({});
      setActiveId(null);
      setApplied([]);
      setOriginalScenes([]);
      setOverride(null);
      setDirty(false);
      if (story.sceneId === "arrival") audio.seek(0);
      setNotice("已开始一条独立调查路线，已有存档保持不变。");
    },
  };
}
