export type SceneId = "arrival" | "harbor" | "interview" | "tower" | "finale";
export interface Cue {
  id: string;
  start: number;
  end: number;
  speaker: string;
  text: string;
  sound?: { clueId: string; start: number; end: number; description: string };
}
export interface Episode {
  id: string;
  sceneId: SceneId;
  title: string;
  version: string;
  description: string;
  audio: string;
  duration: number;
  cues: Cue[];
  wave: number[];
  /** 该录音由版本补丁生成时，指向被替换的音源。 */
  baseEpisodeId?: string;
  /** 生成该录音的版本补丁编号。 */
  patchId?: string;
}
export interface ClueDefinition {
  id: string;
  title: string;
  kind: string;
  description: string;
}
export interface Choice {
  id: string;
  label: string;
  target: SceneId;
  requires: string[];
  description: string;
}
export interface Scene {
  id: SceneId;
  title: string;
  location: string;
  chapter: string;
  description: string;
  choices: Choice[];
}
export interface CaseContent {
  id: string;
  title: string;
  scenes: Scene[];
  episodes: Episode[];
  clues: ClueDefinition[];
}
export interface Investigation {
  sceneId: SceneId;
  visited: SceneId[];
  decisions: { sceneId: SceneId; choiceId: string }[];
  ending: string | null;
}
export type HeardHistory = Record<string, number>;
export interface AudioBookmark {
  sceneId: SceneId;
  start: number;
  end: number;
  /** 产生这段秒数的录音；缺省表示补丁出现之前的旧存档。 */
  sourceEpisodeId?: string;
}
export type MigrationStatus = "migrated" | "pending";
export type MigrationReason =
  | "deleted"
  | "split"
  | "changed"
  | "ambiguous"
  | "outside";
export interface NoteMigration {
  patchId: string;
  baseEpisodeId: string;
  targetEpisodeId: string;
  status: MigrationStatus;
  reason?: MigrationReason;
  oldAnchor: AudioBookmark;
  migratedAt: number;
}
export interface EvidenceNote {
  id: string;
  clueId: string | null;
  title: string;
  text: string;
  anchor: AudioBookmark;
  createdAt: number;
  pinned: boolean;
  /** 版本补丁留下的迁移依据；无法唯一换算时保留旧锚点并标记待处理。 */
  migration?: NoteMigration;
}
export interface EvidenceState {
  notes: EvidenceNote[];
  clues: string[];
  selectedId: string | null;
}
export interface ResumePoint {
  sceneId: SceneId;
  position: number;
  rate: number;
  /** 继续播放使用的音源；缺省表示剧情默认音源。 */
  episodeId?: string;
}
export interface CaseSnapshot {
  version: 1;
  caseId: string;
  story: Investigation;
  evidence: EvidenceState;
  heard: HeardHistory;
  resume: ResumePoint;
  /** 该存档已启用的版本补丁，导出导入时一并保留迁移依据。 */
  appliedPatches?: AppliedPatch[];
  /** 这些场景选择继续使用原版录音回听。 */
  originalScenes?: SceneId[];
}
export interface SaveSlot {
  id: string;
  name: string;
  updatedAt: number;
  snapshot: CaseSnapshot;
}
export interface AudioSegmentMap {
  /** 旧录音中的片段（含端点）。 */
  from: { start: number; end: number };
  /** 新录音中对应的片段；删除的片段不出现。 */
  to?: { start: number; end: number };
  /**
   * 该片段的音频被重新录制（例如纠正一句台词）。长度可能与旧版不同，
   * 内部的旧秒数不再指向同一句话，不能按偏移换算。
   */
  changed?: boolean;
  /** 可选备注，用于展示。 */
  label?: string;
}
export interface PatchRecording {
  /** 补丁内的稳定编号，用于笔记回指。 */
  id: string;
  sceneId: SceneId;
  title: string;
  version: string;
  description: string;
  audio: string;
  duration: number;
  /** 新录音替换的旧音源编号（如 arrival-normal）。 */
  replaces?: string;
  segments?: AudioSegmentMap[];
  cues?: Cue[];
  wave?: number[];
}
export interface VersionPatch {
  id: string;
  name: string;
  createdAt: number;
  /** 基线：生成这段秒数时使用的音源快照，按 episodeId 记录。 */
  base: Record<string, { duration: number }>;
  recordings: PatchRecording[];
}
export interface AppliedPatch {
  patch: VersionPatch;
  appliedAt: number;
  /** 补丁中每条新录音与被替换音源的对应关系。 */
  recordings: {
    baseId: string;
    targetId: string;
    sceneId: SceneId;
  }[];
  /** 启用后对已收集正式线索的声窗复核结果。 */
  clueChecks?: {
    clueId: string;
    targetEpisodeId: string;
    status: "ok" | "missing";
    start?: number;
    end?: number;
  }[];
}
export interface TransportState {
  requestedId: string;
  loadedId: string | null;
  position: number;
  duration: number;
  playing: boolean;
  loading: boolean;
  rate: number;
  volume: number;
  error: string | null;
}
export interface CapturePort {
  captureRange: (sceneId: SceneId, width?: number) => AudioBookmark | null;
}
