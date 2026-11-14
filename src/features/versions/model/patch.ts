import type {
  AudioSegmentMap,
  CaseContent,
  Cue,
  Episode,
  PatchRecording,
  SceneId,
  VersionPatch,
} from "../../../shared/types";

const SCENES: SceneId[] = [
  "arrival",
  "harbor",
  "interview",
  "tower",
  "finale",
];
/** 片段映射的边界容差（秒），避免浮点误差拒绝合法补丁。 */
export const SEGMENT_TOLERANCE = 0.05;

function fail(message: string): never {
  throw new Error(message);
}
function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
function seconds(value: unknown, label: string): number {
  if (!finite(value) || value < 0) fail(`${label}不是有效的秒数`);
  return value;
}
function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) fail(`缺少${label}`);
  return value.trim();
}
/**
 * 解析并校验一份版本补丁。任何无法唯一解释的映射、越界秒数、未知场景、
 * 重复目标或缺失字幕都会让整次导入失败，绝不会留下半套补丁。
 * `audio` 字段既可以是可直接播放的地址，也可以是导入时选中的文件名。
 */
export function parseVersionPatch(
  input: unknown,
  content: CaseContent,
  existingPatchIds: string[] = [],
): VersionPatch {
  const root = isObject(input) && isObject(input.patch) ? input.patch : input;
  if (!isObject(root)) fail("补丁文件格式无效");
  const id = text(root.id, "补丁编号");
  if (existingPatchIds.includes(id)) fail("这个版本补丁已经启用过");
  const name = text(root.name, "补丁名称");
  const createdAt = finite(root.createdAt) ? root.createdAt : Date.now();
  if (!Array.isArray(root.recordings) || !root.recordings.length)
    fail("补丁没有包含任何新录音");

  const episodes = new Map(content.episodes.map((episode) => [episode.id, episode]));
  const targets = new Set<string>();
  const replaced = new Set<string>();

  const recordings = root.recordings.map((value, index): PatchRecording => {
    const at = `第 ${index + 1} 条录音`;
    if (!isObject(value)) fail(`${at}格式无效`);
    const rid = text(value.id, `${at}的编号`);
    if (episodes.has(rid)) fail(`新录音编号「${rid}」与现有音源重复`);
    if (targets.has(rid)) fail(`录音编号「${rid}」在补丁中重复`);
    targets.add(rid);
    const sceneId = text(value.sceneId, `${at}的场景`) as SceneId;
    if (!SCENES.includes(sceneId)) fail(`录音「${rid}」的场景无效`);
    const replaces = text(value.replaces, `${at}替换的音源`);
    const source = episodes.get(replaces);
    if (!source) fail(`录音「${rid}」找不到要替换的音源「${replaces}」`);
    if (source.sceneId !== sceneId)
      fail(`录音「${rid}」与旧音源不属于同一个场景`);
    if (replaced.has(replaces))
      fail(`旧音源「${replaces}」被多个新录音替换，无法唯一定位`);
    replaced.add(replaces);

    const audio = text(value.audio, `${at}的音频地址`);
    const duration = seconds(value.duration, `录音「${rid}」的时长`);
    if (duration <= 0) fail(`录音「${rid}」的时长必须大于零`);

    const cues = parseCues(value.cues, rid, duration, content);
    const segments = parseSegments(value.segments, rid, source, duration);

    return {
      id: rid,
      sceneId,
      title: text(value.title, `${at}的标题`),
      version: text(value.version, `${at}的版本名`),
      description:
        typeof value.description === "string" ? value.description : "",
      audio,
      duration,
      replaces,
      ...(segments.length ? { segments } : {}),
      cues,
      ...(Array.isArray(value.wave) && value.wave.length
        ? {
            wave: value.wave.map((v) =>
              finite(v) ? Math.max(0, Math.min(1, v)) : 0.1,
            ),
          }
        : {}),
    };
  });

  const base: VersionPatch["base"] = {};
  for (const recording of recordings) {
    const source = episodes.get(recording.replaces!)!;
    base[source.id] = { duration: source.duration };
  }
  return { id, name, createdAt, base, recordings };
}

function parseCues(
  value: unknown,
  recordingId: string,
  duration: number,
  content: CaseContent,
): Cue[] {
  if (!Array.isArray(value) || !value.length)
    fail(`录音「${recordingId}」缺少新字幕`);
  const ids = new Set<string>();
  const cues = value.map((item, index): Cue => {
    const at = `录音「${recordingId}」第 ${index + 1} 条字幕`;
    if (!isObject(item)) fail(`${at}格式无效`);
    const id = text(item.id, `${at}的编号`);
    if (ids.has(id)) fail(`录音「${recordingId}」的字幕编号重复`);
    ids.add(id);
    const start = seconds(item.start, `${at}起点`),
      end = seconds(item.end, `${at}终点`);
    if (end <= start) fail(`${at}的范围无效`);
    if (end > duration + SEGMENT_TOLERANCE) fail(`${at}超出音频长度`);
    let sound: Cue["sound"];
    if (item.sound !== undefined) {
      if (!isObject(item.sound)) fail(`${at}的声音线索格式无效`);
      const clueId = text(item.sound.clueId, `${at}的线索编号`);
      if (!content.clues.some((clue) => clue.id === clueId))
        fail(`${at}引用了未知线索「${clueId}」`);
      const soundStart = seconds(item.sound.start, `${at}的线索起点`),
        soundEnd = seconds(item.sound.end, `${at}的线索终点`);
      if (soundEnd <= soundStart || soundEnd > duration + SEGMENT_TOLERANCE)
        fail(`${at}的声音线索范围无效`);
      sound = {
        clueId,
        start: soundStart,
        end: soundEnd,
        description: text(item.sound.description, `${at}的线索描述`),
      };
    }
    return {
      id,
      start,
      end,
      speaker: text(item.speaker, `${at}的说话人`),
      text: text(item.text, `${at}的内容`),
      ...(sound ? { sound } : {}),
    };
  });
  cues.sort((a, b) => a.start - b.start);
  return cues;
}

/**
 * 片段映射必须首尾相接、完整覆盖旧时间轴：每个旧秒数最多命中一个片段；
 * 保留片段的旧长度与新长度必须一致；被删除的片段不提供 `to`。
 * 新时间轴上的映射区间必须随着旧时间轴单调、互不重叠，允许中间插入新内容。
 */
function parseSegments(
  value: unknown,
  recordingId: string,
  source: Episode,
  duration: number,
): AudioSegmentMap[] {
  if (!Array.isArray(value) || !value.length)
    fail(`录音「${recordingId}」缺少新旧片段对应表`);
  const segments = value.map((item, index): AudioSegmentMap => {
    const at = `录音「${recordingId}」第 ${index + 1} 个片段`;
    if (!isObject(item)) fail(`${at}格式无效`);
    if (!isObject(item.from)) fail(`${at}缺少旧片段`);
    const from = {
      start: seconds(item.from.start, `${at}旧起点`),
      end: seconds(item.from.end, `${at}旧终点`),
    };
    if (from.end <= from.start) fail(`${at}的旧片段范围无效`);
    if (from.end > source.duration + SEGMENT_TOLERANCE)
      fail(`${at}超出旧录音长度`);
    let to: AudioSegmentMap["to"];
    if (item.to !== undefined && item.to !== null) {
      if (!isObject(item.to)) fail(`${at}的新片段格式无效`);
      to = {
        start: seconds(item.to.start, `${at}新起点`),
        end: seconds(item.to.end, `${at}新终点`),
      };
      if (to.end <= to.start) fail(`${at}的新片段范围无效`);
      if (to.end > duration + SEGMENT_TOLERANCE) fail(`${at}超出新录音长度`);
    }
    const changed = item.changed === true;
    if (changed && !to) fail(`${at}标记了重录却没有给出新片段`);
    if (!changed && to && Math.abs(to.end - to.start - (from.end - from.start)) > SEGMENT_TOLERANCE)
      fail(`${at}保留了片段却改变了长度，无法按映射换算秒数`);
    if (changed && to && to.end > duration + SEGMENT_TOLERANCE)
      fail(`${at}超出新录音长度`);
    return {
      from,
      ...(to ? { to } : {}),
      ...(changed ? { changed: true } : {}),
      ...(typeof item.label === "string" && item.label.trim()
        ? { label: item.label.trim() }
        : {}),
    };
  });
  segments.sort((a, b) => a.from.start - b.from.start);
  let cursor = 0,
    newCursor = -1;
  for (const segment of segments) {
    if (Math.abs(segment.from.start - cursor) > SEGMENT_TOLERANCE)
      fail(`录音「${recordingId}」的新旧片段对应表没有连续覆盖旧录音`);
    cursor = segment.from.end;
    if (segment.to) {
      if (segment.to.start < newCursor - SEGMENT_TOLERANCE)
        fail(`录音「${recordingId}」的新片段顺序与旧录音冲突`);
      newCursor = segment.to.end;
    }
  }
  if (Math.abs(cursor - source.duration) > SEGMENT_TOLERANCE)
    fail(`录音「${recordingId}」的新旧片段对应表没有覆盖整段旧录音`);
  return segments;
}

/** 新录音缺少波形时，按旧波形重采样，仅用于绘制。 */
export function deriveWave(source: Episode, duration: number): number[] {
  if (!source.wave.length) return [];
  const count = Math.max(40, Math.min(160, source.wave.length));
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const t = (i / (count - 1)) * source.duration;
    const index = Math.min(
      source.wave.length - 1,
      Math.floor((t / source.duration) * source.wave.length),
    );
    out.push(source.wave[index]);
  }
  // 新时长可能不同，仅保留密度；重采样不改变声音含义。
  return duration > 0 ? out : [];
}
