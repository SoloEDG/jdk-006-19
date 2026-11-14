import test from "node:test";
import assert from "node:assert/strict";
import {
  parseVersionPatch,
  mapPoint,
  mapRange,
  mapHeardThrough,
  mapPointBack,
  previewPatch,
  applyPatch,
  patchedEpisodes,
  resolvePlayableEpisode,
  versionChoice,
  type PatchPreview,
} from "../src/features/versions/index";
import {
  validateSnapshot,
  createSnapshot,
  parseStoredSlot,
} from "../src/features/profiles/index";
import type {
  CaseContent,
  CaseSnapshot,
  Episode,
  VersionPatch,
} from "../src/shared/types";
import { resolveEpisode } from "../src/features/story";

const content: CaseContent = {
  id: "case",
  title: "雾港",
  scenes: [
    {
      id: "arrival",
      title: "来电",
      location: "电台",
      chapter: "01",
      description: "",
      choices: [],
    },
    {
      id: "interview",
      title: "守塔人",
      location: "旧宅",
      chapter: "02",
      description: "",
      choices: [],
    },
  ],
  episodes: [
    {
      id: "arrival-normal",
      sceneId: "arrival",
      title: "来电",
      version: "原始录音",
      description: "",
      audio: "/a.wav",
      duration: 30,
      wave: [0.2, 0.4, 0.6],
      cues: [
        {
          id: "line-1",
          start: 0,
          end: 10,
          speaker: "旁白",
          text: "开头",
        },
        {
          id: "line-2",
          start: 12,
          end: 18,
          speaker: "陌生人",
          text: "钟声",
          sound: { clueId: "bell", start: 13, end: 15, description: "钟" },
        },
        {
          id: "line-3",
          start: 20,
          end: 29,
          speaker: "林岚",
          text: "结尾",
        },
      ],
    },
    {
      id: "interview-normal",
      sceneId: "interview",
      title: "沉默",
      version: "初次证词",
      description: "",
      audio: "/b.wav",
      duration: 20,
      wave: [],
      cues: [],
    },
    {
      id: "interview-aware",
      sceneId: "interview",
      title: "坦白",
      version: "钟声线索",
      description: "",
      audio: "/c.wav",
      duration: 22,
      wave: [],
      cues: [],
    },
  ],
  clues: [{ id: "bell", title: "三声钟响", kind: "环境", description: "" }],
};

function patchInput(overrides: Record<string, unknown> = {}) {
  return {
    id: "patch-1",
    name: "修正钟声",
    createdAt: 100,
    recordings: [
      {
        id: "arrival-v2",
        sceneId: "arrival",
        title: "来电",
        version: "修订版",
        description: "",
        audio: "arrival-v2.wav",
        duration: 30,
        replaces: "arrival-normal",
        segments: [
          { from: { start: 0, end: 12 }, to: { start: 0, end: 12 } },
          {
            from: { start: 12, end: 18 },
            to: { start: 12, end: 18 },
            changed: true,
          },
          { from: { start: 18, end: 30 }, to: { start: 18, end: 30 } },
        ],
        cues: [
          { id: "line-1", start: 0, end: 10, speaker: "旁白", text: "开头" },
          {
            id: "line-2",
            start: 12,
            end: 18,
            speaker: "陌生人",
            text: "钟声",
            sound: {
              clueId: "bell",
              start: 13,
              end: 15,
              description: "钟",
            },
          },
          { id: "line-3", start: 20, end: 29, speaker: "林岚", text: "结尾" },
        ],
      },
    ],
    ...overrides,
  };
}

function snapshot(): CaseSnapshot {
  return {
    version: 1,
    caseId: "case",
    story: {
      sceneId: "arrival",
      visited: ["arrival"],
      decisions: [],
      ending: null,
    },
    evidence: {
      notes: [
        {
          id: "n-start",
          clueId: null,
          title: "开头笔记",
          text: "x",
          anchor: { sceneId: "arrival", start: 2, end: 6 },
          createdAt: 1,
          pinned: false,
        },
        {
          id: "n-changed",
          clueId: null,
          title: "钟声处",
          text: "y",
          anchor: { sceneId: "arrival", start: 13, end: 14 },
          createdAt: 1,
          pinned: false,
        },
        {
          id: "n-end",
          clueId: "bell",
          title: "结尾线索",
          text: "z",
          anchor: { sceneId: "arrival", start: 21, end: 25 },
          createdAt: 1,
          pinned: false,
        },
      ],
      clues: ["bell"],
      selectedId: null,
    },
    heard: { "arrival-normal": 26 },
    resume: { sceneId: "arrival", position: 22, rate: 1 },
  };
}

function previewOf(
  input = patchInput(),
  snap = snapshot(),
  clues = ["bell"],
): PatchPreview {
  const patch = parseVersionPatch(input, content);
  return previewPatch({
    content,
    snapshot: snap,
    patch,
    clues,
    resume: snap.resume,
  });
}

test("point mapping never guesses across deleted, changed or split seams", () => {
  const segments = [
    { from: { start: 0, end: 10 }, to: { start: 0, end: 10 } },
    { from: { start: 10, end: 20 } },
    { from: { start: 20, end: 30 }, to: { start: 10, end: 20 } },
  ];
  assert.deepEqual(mapPoint(segments, 4), { position: 4 });
  assert.deepEqual(mapPoint(segments, 14), { reason: "deleted" });
  assert.deepEqual(mapPoint(segments, 10), { position: 10 });
  assert.deepEqual(mapPoint(segments, 20), { position: 10 });
  assert.deepEqual(mapPoint(segments, 40), { reason: "outside" });

  const inserted = [
    { from: { start: 0, end: 10 }, to: { start: 0, end: 10 } },
    { from: { start: 10, end: 20 }, to: { start: 16, end: 26 } },
  ];
  // 接缝处新录音插入了内容，旧秒数不再唯一。
  assert.deepEqual(mapPoint(inserted, 10), { reason: "ambiguous" });
  assert.deepEqual(mapPoint(inserted, 15), { position: 21 });

  const rerecorded = [
    { from: { start: 0, end: 10 }, to: { start: 0, end: 10 } },
    {
      from: { start: 10, end: 20 },
      to: { start: 10, end: 21.5 },
      changed: true,
    },
  ];
  assert.deepEqual(mapPoint(rerecorded, 15), { reason: "changed" });
  assert.deepEqual(mapPoint(rerecorded, 10), { position: 10 });
});

test("range mapping keeps only one-to-one windows", () => {
  const segments = [
    { from: { start: 0, end: 10 }, to: { start: 0, end: 10 } },
    { from: { start: 10, end: 20 } },
    { from: { start: 20, end: 30 }, to: { start: 10, end: 20 } },
  ];
  assert.deepEqual(mapRange(segments, 3, 8, "arrival", "v2"), {
    anchor: { sceneId: "arrival", start: 3, end: 8, sourceEpisodeId: "v2" },
  });
  assert.deepEqual(mapRange(segments, 8, 25, "arrival", "v2"), {
    reason: "deleted",
  });
  const inserted = [
    { from: { start: 0, end: 10 }, to: { start: 0, end: 10 } },
    { from: { start: 10, end: 20 }, to: { start: 16, end: 26 } },
  ];
  assert.deepEqual(mapRange(inserted, 5, 15, "arrival", "v2"), {
    reason: "split",
  });
  const rerecorded = [
    { from: { start: 0, end: 10 }, to: { start: 0, end: 10 } },
    {
      from: { start: 10, end: 20 },
      to: { start: 10, end: 21.5 },
      changed: true,
    },
  ];
  assert.deepEqual(mapRange(rerecorded, 12, 18, "arrival", "v2"), {
    reason: "changed",
  });
  // 整个重录片段可以被搬到新位置。
  assert.deepEqual(mapRange(rerecorded, 10, 20, "arrival", "v2"), {
    anchor: { sceneId: "arrival", start: 10, end: 21.5, sourceEpisodeId: "v2" },
  });
  // 重录后长度变化，随后的内容不能沿用旧偏移。
  assert.deepEqual(
    mapRange(
      [
        { from: { start: 0, end: 10 }, to: { start: 0, end: 10 } },
        {
          from: { start: 10, end: 20 },
          to: { start: 10, end: 11.5 },
          changed: true,
        },
        { from: { start: 20, end: 30 }, to: { start: 11.5, end: 21.5 } },
      ],
      10,
      20,
      "arrival",
      "v2",
    ),
    { anchor: { sceneId: "arrival", start: 10, end: 11.5, sourceEpisodeId: "v2" } },
  );
});

test("heard-through only migrates when no unheard content is inserted", () => {
  const clean = [
    { from: { start: 0, end: 10 }, to: { start: 0, end: 10 } },
    { from: { start: 10, end: 20 }, to: { start: 10, end: 20 } },
  ];
  assert.deepEqual(mapHeardThrough(clean, 15), { position: 15 });
  const leading = [
    { from: { start: 0, end: 5 }, to: { start: 3, end: 8 } },
  ];
  assert.deepEqual(mapHeardThrough(leading, 3), { reason: "split" });
  const inserted = [
    { from: { start: 0, end: 10 }, to: { start: 0, end: 10 } },
    { from: { start: 10, end: 20 }, to: { start: 15, end: 25 } },
  ];
  // 新录音在已听范围之前插入了没听过的内容，不能声称已经听完整段。
  assert.deepEqual(mapHeardThrough(inserted, 15), { reason: "split" });
  // 插入发生在此后时，前面的已听范围不受影响。
  assert.deepEqual(mapHeardThrough(inserted, 5), { position: 5 });
});

test("back mapping returns to the same picture and refuses re-recorded audio", () => {
  const segments = [
    { from: { start: 0, end: 10 }, to: { start: 0, end: 10 } },
    {
      from: { start: 10, end: 20 },
      to: { start: 10, end: 21.5 },
      changed: true,
    },
    { from: { start: 20, end: 30 }, to: { start: 21.5, end: 31.5 } },
  ];
  assert.deepEqual(mapPointBack(segments, 25), { position: 23.5 });
  assert.deepEqual(mapPointBack(segments, 15), { reason: "changed" });
});

test("patch parser rejects ambiguous or incomplete mappings up front", () => {
  assert.throws(
    () =>
      parseVersionPatch(
        patchInput({
          recordings: [
            patchInput().recordings[0],
            { ...patchInput().recordings[0], id: "dup", replaces: "arrival-normal" },
          ],
        }),
        content,
      ),
    /替换|唯一/,
  );
  assert.throws(
    () =>
      parseVersionPatch(
        patchInput({
          recordings: [
            {
              ...patchInput().recordings[0],
              segments: [
                { from: { start: 0, end: 12 }, to: { start: 0, end: 12 } },
                { from: { start: 15, end: 30 }, to: { start: 15, end: 30 } },
              ],
            },
          ],
        }),
        content,
      ),
    /覆盖/,
  );
  assert.throws(
    () =>
      parseVersionPatch(
        patchInput({
          recordings: [
            {
              ...patchInput().recordings[0],
              segments: [
                { from: { start: 0, end: 30 }, to: { start: 0, end: 20 } },
              ],
            },
          ],
        }),
        content,
      ),
    /长度/,
  );
  assert.throws(
    () =>
      parseVersionPatch(
        patchInput({
          recordings: [{ ...patchInput().recordings[0], cues: [] }],
        }),
        content,
      ),
    /字幕/,
  );
});

test("preview separates migratable notes from those that keep their old source", () => {
  const preview = previewOf();
  const scene = preview.scenes[0];
  assert.equal(preview.counts.migratedNotes, 2);
  assert.equal(preview.counts.pendingNotes, 1);
  const pending = scene.notes.find((item) => item.note.id === "n-changed")!;
  assert.deepEqual(pending.outcome, { kind: "pending", reason: "changed" });
  const migrated = scene.notes.find((item) => item.note.id === "n-end")!;
  assert.deepEqual(migrated.outcome, {
    kind: "migrated",
    anchor: {
      sceneId: "arrival",
      start: 21,
      end: 25,
      sourceEpisodeId: "arrival-v2",
    },
  });
  // 已听范围跨过重录内容，不能声称已听新版。
  assert.deepEqual(scene.heard!.outcome, { kind: "pending", reason: "changed" });
  // 继续播放位置落在未改动片段，可以迁移。
  assert.equal(scene.resume!.kind, "migrated");
  // 正式线索的声窗落在重录片段内，需要重新核对。
  assert.deepEqual(scene.clues[0].outcome, {
    kind: "missing",
    reason: "window-gone",
  });
});

test("applying a patch migrates anchors, records provenance and keeps originals", () => {
  const preview = previewOf();
  const { snapshot: next, applied } = applyPatch(snapshot(), preview, 500);
  const byId = new Map(next.evidence.notes.map((note) => [note.id, note]));
  assert.deepEqual(byId.get("n-end")!.anchor, {
    sceneId: "arrival",
    start: 21,
    end: 25,
    sourceEpisodeId: "arrival-v2",
  });
  assert.equal(byId.get("n-end")!.migration!.status, "migrated");
  assert.deepEqual(byId.get("n-end")!.migration!.oldAnchor, {
    sceneId: "arrival",
    start: 21,
    end: 25,
  });
  // 无法唯一定位的笔记保留旧源和旧秒数，只标记待处理。
  assert.deepEqual(byId.get("n-changed")!.anchor, {
    sceneId: "arrival",
    start: 13,
    end: 14,
    sourceEpisodeId: "arrival-normal",
  });
  assert.equal(byId.get("n-changed")!.migration!.status, "pending");
  assert.equal(byId.get("n-changed")!.migration!.reason, "changed");
  // 原版已听进度保留，新版不伪造。
  assert.equal(next.heard["arrival-normal"], 26);
  assert.equal(next.heard["arrival-v2"], undefined);
  // 继续播放位置可以迁移时指向新音源。
  assert.deepEqual(next.resume, {
    sceneId: "arrival",
    position: 22,
    rate: 1,
    episodeId: "arrival-v2",
  });
  assert.equal(applied.recordings[0].targetId, "arrival-v2");
  assert.equal(applied.clueChecks![0].status, "missing");
});

test("patched catalog keeps the original playable and can switch back", () => {
  const preview = previewOf();
  const { applied } = applyPatch(snapshot(), preview, 1);
  const episodes = patchedEpisodes(content.episodes, [applied]);
  assert.equal(episodes.length, content.episodes.length + 1);
  const original = episodes.find((episode) => episode.id === "arrival-normal")!;
  assert.equal(original.version, "原始录音");
  const patched = episodes.find((episode) => episode.id === "arrival-v2")!;
  assert.equal(patched.baseEpisodeId, "arrival-normal");
  const withPatch: CaseContent = { ...content, episodes };
  const fresh = withPatch.episodes.find((e) => e.id === "arrival-normal")!;
  assert.ok(fresh);
  assert.equal(
    resolvePlayableEpisode(withPatch, "arrival", [], [applied]).id,
    "arrival-v2",
  );
  assert.equal(
    resolvePlayableEpisode(withPatch, "arrival", [], [applied], ["arrival"])
      .id,
    "arrival-normal",
  );
  assert.equal(
    versionChoice(withPatch, "arrival", [applied], [])!.base.id,
    "arrival-normal",
  );
});

test("version patch survives snapshot validation and export/import", () => {
  const preview = previewOf();
  const { snapshot: next, applied } = applyPatch(snapshot(), preview, 1);
  const stored = { ...next, appliedPatches: [applied] };
  const checked = validateSnapshot(stored, content, [applied]);
  assert.equal(checked.appliedPatches!.length, 1);
  assert.equal(checked.evidence.notes.length, 3);
  const slot = parseStoredSlot(
    {
      id: "slot-1",
      name: "钟声之后",
      updatedAt: 10,
      snapshot: stored,
    },
    content,
  );
  assert.equal(slot.snapshot.appliedPatches![0].patch.id, "patch-1");
  // 导出再导入后，迁移依据仍然保留。
  const text = JSON.stringify(slot);
  const again = parseStoredSlot(JSON.parse(text), content);
  const note = again.snapshot.evidence.notes.find(
    (item) => item.id === "n-changed",
  )!;
  assert.equal(note.migration!.patchId, "patch-1");
  assert.equal(note.migration!.status, "pending");
  // 移除补丁后，指向补丁音源的秒数不能蒙混过关。
  assert.throws(() => validateSnapshot(stored, content), /未知录音/);
});

test("createSnapshot carries applied patches through validation", () => {
  const preview = previewOf();
  const { snapshot: next, applied } = applyPatch(snapshot(), preview, 1);
  const built = createSnapshot(
    content,
    next.story,
    next.evidence,
    next.heard,
    next.resume,
    [applied],
  );
  assert.equal(built.appliedPatches!.length, 1);
});

test("exported slot keeps patch provenance and original-scene preference", () => {
  const preview = previewOf();
  const { snapshot: next, applied } = applyPatch(snapshot(), preview, 1);
  const built = createSnapshot(
    content,
    next.story,
    next.evidence,
    next.heard,
    next.resume,
    [applied],
    ["arrival"],
  );
  assert.deepEqual(built.originalScenes, ["arrival"]);
  const stored = parseStoredSlot(
    { id: "s", name: "原版回听", updatedAt: 5, snapshot: built },
    content,
  );
  assert.deepEqual(stored.snapshot.originalScenes, ["arrival"]);
  const roundTrip = parseStoredSlot(JSON.parse(JSON.stringify(stored)), content);
  assert.equal(roundTrip.snapshot.appliedPatches![0].patch.id, "patch-1");
  assert.deepEqual(roundTrip.snapshot.originalScenes, ["arrival"]);
});

test("load pipeline cancels the whole patch when audio fails to load", async () => {
  const { buildPatchPreview, PatchLoadError } = await import(
    "../src/features/versions/index"
  );
  const patchText = JSON.stringify(patchInput());
  const ok = await buildPatchPreview({
    text: patchText,
    files: [{ name: "arrival-v2.wav", file: new Blob(["a"]) }],
    content,
    snapshot: snapshot(),
    clues: ["bell"],
    resume: snapshot().resume,
    appliedIds: [],
    probe: async () => [],
  });
  assert.equal(ok.preview.counts.migratedNotes, 2);
  await assert.rejects(
    buildPatchPreview({
      text: patchText,
      files: [{ name: "arrival-v2.wav", file: new Blob(["a"]) }],
      content,
      snapshot: snapshot(),
      clues: ["bell"],
      resume: snapshot().resume,
      appliedIds: [],
      probe: async (sources) => sources.slice(0, 1),
    }),
    (error: unknown) =>
      error instanceof PatchLoadError && /无法加载/.test(error.message),
  );
  await assert.rejects(
    buildPatchPreview({
      text: patchText,
      files: [],
      content,
      snapshot: snapshot(),
      clues: ["bell"],
      resume: snapshot().resume,
      appliedIds: [],
    }),
    /缺少音频/,
  );
  await assert.rejects(
    buildPatchPreview({
      text: "not json",
      files: [],
      content,
      snapshot: snapshot(),
      clues: [],
      resume: snapshot().resume,
      appliedIds: [],
    }),
    /JSON/,
  );
});

test("a second patch can replace the first patch's new recording", () => {
  const first = previewOf();
  const { snapshot: afterFirst, applied } = applyPatch(snapshot(), first, 1);
  const contentAfter: CaseContent = {
    ...content,
    episodes: patchedEpisodes(content.episodes, [applied]),
  };
  const second = parseVersionPatch(
    patchInput({
      id: "patch-2",
      name: "再次修订",
      recordings: [
        {
          ...patchInput().recordings[0],
          id: "arrival-v3",
          replaces: "arrival-v2",
          segments: [
            { from: { start: 0, end: 30 }, to: { start: 0, end: 30 } },
          ],
        },
      ],
    }),
    contentAfter,
  );
  const preview = previewPatch({
    content: contentAfter,
    snapshot: afterFirst,
    patch: second,
    clues: ["bell"],
    resume: afterFirst.resume,
  });
  // 已迁移到新版（arrival-v2）的笔记应当按第二份补丁继续换算。
  const scene = preview.scenes[0];
  const migrated = scene.notes.find((item) => item.note.id === "n-end")!;
  assert.equal(migrated.outcome.kind, "migrated");
  assert.equal(
    (migrated.outcome as { anchor: { sourceEpisodeId: string } }).anchor
      .sourceEpisodeId,
    "arrival-v3",
  );
  const result = applyPatch(afterFirst, preview, 2);
  assert.equal(result.applied.recordings[0].baseId, "arrival-v2");
});

test("switching between original and patched audio maps through the patch chain", async () => {
  const { mapForwardThroughChain, mapBackThroughChain } = await import(
    "../src/features/versions/index"
  );
  const first = previewOf();
  const { applied } = applyPatch(snapshot(), first, 1);
  assert.equal(
    mapForwardThroughChain([applied], "arrival-normal", "arrival-v2", 5),
    5,
  );
  assert.equal(
    mapBackThroughChain([applied], "arrival-v2", "arrival-normal", 5),
    5,
  );
  // 重录片段内部无法精确对应，调用方必须停在相近位置而非猜秒数。
  assert.equal(
    mapForwardThroughChain([applied], "arrival-normal", "arrival-v2", 15),
    null,
  );
  assert.equal(
    mapBackThroughChain([applied], "arrival-v2", "arrival-normal", 15),
    null,
  );
});
