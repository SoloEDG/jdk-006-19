import type { AudioBookmark, AudioSegmentMap, SceneId } from "../../../shared/types";
import { SEGMENT_TOLERANCE } from "./patch";

export type UnmappableReason =
  | "deleted"
  | "split"
  | "changed"
  | "ambiguous"
  | "outside";

export interface PointResult {
  position?: number;
  reason?: UnmappableReason;
}

const close = (a: number, b: number) => Math.abs(a - b) <= SEGMENT_TOLERANCE;

function findAt(
  segments: AudioSegmentMap[],
  time: number,
  edge: "start" | "end",
): number {
  // 分界点同时属于两个片段：起点归右侧，终点归左侧。
  if (edge === "start")
    for (let i = 0; i < segments.length; i++) {
      if (close(time, segments[i].from.start)) return i;
      if (time > segments[i].from.start && time < segments[i].from.end)
        return i;
    }
  else
    for (let i = segments.length - 1; i >= 0; i--) {
      if (close(time, segments[i].from.end)) return i;
      if (time > segments[i].from.start && time < segments[i].from.end)
        return i;
    }
  return -1;
}

/** 相邻片段在新录音中是否仍然首尾相接（中间没有插入新内容）。 */
function contiguousInNew(a: AudioSegmentMap, b: AudioSegmentMap) {
  return !!a.to && !!b.to && close(a.to.end, b.to.start);
}

/**
 * 把一个旧秒数换算为新秒数。只有落在保留片段内，或落在两个新录音里
 * 仍然首尾相接的片段分界上时才返回位置；置入删除/重录内容或插入内容的
 * 边界一律视为无法唯一定位，绝不猜测一个新秒数。
 */
export function mapPoint(
  segments: AudioSegmentMap[] | undefined,
  time: number,
): PointResult {
  if (!segments?.length) return { reason: "outside" };
  const index = findAt(segments, time, "start");
  if (index < 0) return { reason: "outside" };
  const segment = segments[index],
    atStart = close(time, segment.from.start),
    atEnd = close(time, segment.from.end);
  if (!atStart && !atEnd) {
    if (!segment.to) return { reason: "deleted" };
    if (segment.changed) return { reason: "changed" };
    return { position: segment.to.start + (time - segment.from.start) };
  }
  // 边界：收集相邻片段能给出的候选位置。
  const candidates: {
    position: number;
    deleted: boolean;
  }[] = [];
  if (atStart && index > 0) {
    const previous = segments[index - 1];
    candidates.push(
      previous.to
        ? { position: previous.to.end, deleted: false }
        : { position: -1, deleted: true },
    );
  }
  candidates.push(
    segment.to
      ? { position: (atEnd ? segment.to.end : segment.to.start), deleted: false }
      : { position: -1, deleted: true },
  );
  const valid = candidates.filter((candidate) => !candidate.deleted);
  if (!valid.length) return { reason: "deleted" };
  const position = valid[0].position;
  if (valid.some((candidate) => !close(candidate.position, position)))
    // 插入的新内容让边界两侧指向不同位置。
    return { reason: "ambiguous" };
  const hasGap =
    atStart &&
    index > 0 &&
    segments[index - 1].to &&
    segment.to &&
    !contiguousInNew(segments[index - 1], segment);
  if (hasGap) return { reason: "ambiguous" };
  return { position };
}

export interface RangeResult {
  anchor?: AudioBookmark;
  reason?: UnmappableReason;
}

/**
 * 把旧录音中的一段播放范围换算到新录音。范围两端都要唯一命中，中间不
 * 经过被删掉、重录的内容，新旧时间轴也保持连续，才算一一对应；否则保留
 * 旧源、标记待处理。
 */
export function mapRange(
  segments: AudioSegmentMap[] | undefined,
  start: number,
  end: number,
  sceneId: SceneId,
  targetEpisodeId: string,
): RangeResult {
  if (!segments?.length) return { reason: "outside" };
  if (end < start - SEGMENT_TOLERANCE) return { reason: "ambiguous" };
  if (close(end, start)) {
    const point = mapPoint(segments, start);
    if ("reason" in point) return { reason: point.reason };
    return {
      anchor: {
        sceneId,
        start: point.position!,
        end: point.position!,
        sourceEpisodeId: targetEpisodeId,
      },
    };
  }
  const first = findAt(segments, start, "start"),
    last = findAt(segments, end, "end");
  if (first < 0 || last < 0) return { reason: "outside" };
  if (first > last) return { reason: "ambiguous" };

  // 范围恰好覆盖一个重录片段时，可整体搬到新片段的位置。
  if (first === last && segments[first].changed) {
    const segment = segments[first];
    if (!segment.to) return { reason: "deleted" };
    if (close(start, segment.from.start) && close(end, segment.from.end))
      return {
        anchor: {
          sceneId,
          start: segment.to.start,
          end: segment.to.end,
          sourceEpisodeId: targetEpisodeId,
        },
      };
  }

  for (let i = first; i <= last; i++) {
    const segment = segments[i];
    if (!segment.to) return { reason: "deleted" };
    if (segment.changed) {
      // 只有范围整体恰好覆盖这段重录内容时，才可搬到新片段的位置；
      // 起点或终点落在重录内容内部都会指向别的句子。
      const covers =
        (i > first || close(start, segment.from.start)) &&
        (i < last || close(end, segment.from.end));
      if (!covers) return { reason: "changed" };
    }
    if (i > first) {
      const previous = segments[i - 1];
      if (!previous.to) return { reason: "deleted" };
      if (!contiguousInNew(previous, segment)) {
        // 旧录音里连续的内容，在新录音中被插入的新内容隔开。
        if (previous.to.end < segment.to.start - SEGMENT_TOLERANCE)
          return { reason: "split" };
        return { reason: "ambiguous" };
      }
    }
  }
  const startSegment = segments[first],
    endSegment = segments[last];
  const mappedStart = startSegment.changed
    ? startSegment.to!.start
    : startSegment.to!.start + (start - startSegment.from.start);
  let mappedEnd = endSegment.changed
    ? endSegment.to!.end
    : endSegment.to!.start + (end - endSegment.from.start);
  if (mappedEnd < mappedStart - SEGMENT_TOLERANCE)
    return { reason: "ambiguous" };
  mappedEnd = Math.max(mappedStart, mappedEnd);
  return {
    anchor: {
      sceneId,
      start: mappedStart,
      end: mappedEnd,
      sourceEpisodeId: targetEpisodeId,
    },
  };
}

/**
 * 已听进度的换算。已听进度含义是「从开头听到这里」，因此只有新录音从 0
 * 到映射位置之间没有插入用户没听过的内容时，才能原样声明听到这里。
 * 经过重录片段也不能算已听；删掉旧内容则不影响。
 */
export function mapHeardThrough(
  segments: AudioSegmentMap[] | undefined,
  position: number,
): PointResult {
  if (!segments?.length) return { reason: "outside" };
  const point = mapPoint(segments, position);
  if ("reason" in point) return point;
  let previousNewEnd = 0,
    started = false;
  for (const segment of segments) {
    if (segment.from.start >= position - SEGMENT_TOLERANCE) break;
    if (!segment.to) continue;
    if (segment.changed) return { reason: "changed" };
    if (!started && segment.to.start > SEGMENT_TOLERANCE)
      // 新录音开头先插入了未听过的内容。
      return { reason: "split" };
    if (started && segment.to.start > previousNewEnd + SEGMENT_TOLERANCE)
      return { reason: "split" };
    started = true;
    previousNewEnd = segment.to.end;
  }
  return point;
}

/** 反向换算：从新录音切回原版时停在同一声画。重录片段无法反推。 */
export function mapPointBack(
  segments: AudioSegmentMap[] | undefined,
  position: number,
): PointResult {
  if (!segments?.length) return { reason: "outside" };
  for (const segment of segments) {
    if (!segment.to) continue;
    if (position >= segment.to.start - SEGMENT_TOLERANCE &&
        position <= segment.to.end + SEGMENT_TOLERANCE) {
      if (segment.changed) return { reason: "changed" };
      return {
        position: segment.from.start + Math.max(0, position - segment.to.start),
      };
    }
  }
  return { reason: "outside" };
}
