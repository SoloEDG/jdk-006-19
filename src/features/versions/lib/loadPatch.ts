import type {
  CaseContent,
  CaseSnapshot,
  PatchRecording,
  SceneId,
  VersionPatch,
} from "../../../shared/types";
import { parseVersionPatch } from "../model/patch";
import { previewPatch, type PatchPreview } from "../model/migrate";

export interface PatchFile {
  name: string;
  file: Blob;
}

export interface BuildPreviewInput {
  text: string;
  files: PatchFile[];
  content: CaseContent;
  snapshot: CaseSnapshot;
  clues: string[];
  resume: { sceneId: SceneId; position: number; rate: number };
  appliedIds: string[];
  /** 音频可加载性检查；返回失败地址列表。 */
  probe?: (sources: string[]) => Promise<string[]>;
}

export interface BuildPreviewResult {
  patch: VersionPatch;
  preview: PatchPreview;
  /** 每条新录音对应的可播放地址，键为 recording.audio。 */
  sources: Map<string, string>;
}

export class PatchLoadError extends Error {}

/**
 * 完整的「导入 → 校验 → 预览 → 音频探测」管线。任何一步失败都会抛错，
 * 调用方据此整次取消，不启用半套补丁。
 */
export async function buildPatchPreview({
  text,
  files,
  content,
  snapshot,
  clues,
  resume,
  appliedIds,
  probe,
}: BuildPreviewInput): Promise<BuildPreviewResult> {
  if (!text.trim()) throw new PatchLoadError("请先选择补丁 JSON 文件");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new PatchLoadError("补丁文件不是有效 JSON");
  }
  const patch = parseVersionPatch(parsed, content, appliedIds);

  const byName = new Map(files.map((item) => [item.name, item.file]));
  const sources = new Map<string, string>();
  const missing: string[] = [];
  for (const recording of patch.recordings) {
    const source = resolveSource(recording, byName);
    if (!source) missing.push(recording.audio);
    else sources.set(recording.audio, source);
  }
  if (missing.length)
    throw new PatchLoadError(`缺少音频文件：${missing.join("、")}`);

  const preview = previewPatch({
    content,
    snapshot,
    patch,
    clues,
    resume,
  });
  if (preview.blocking.length)
    throw new PatchLoadError(preview.blocking.join("；"));

  if (probe) {
    const failed = await probe([...new Set(sources.values())]);
    if (failed.length)
      throw new PatchLoadError(
        `有 ${failed.length} 条新录音无法加载，补丁已取消。`,
      );
  }
  return { patch, preview, sources };
}

function resolveSource(
  recording: PatchRecording,
  byName: Map<string, Blob>,
): string | null {
  if (/^(data:|blob:|https?:|\/)/.test(recording.audio)) return recording.audio;
  const file =
    byName.get(recording.audio) ??
    byName.get(recording.audio.split("/").pop() ?? "");
  return file ? URL.createObjectURL(file) : null;
}

/** 补丁录音是否来自本机选择的文件（需要转存），而非服务器地址。 */
export function localFileFor(
  recording: PatchRecording,
  files: PatchFile[],
): PatchFile | null {
  return (
    files.find(
      (item) =>
        item.name === recording.audio ||
        item.name === recording.audio.split("/").pop(),
    ) ?? null
  );
}
