import { useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  AudioLines,
  Check,
  FileAudio,
  GitBranch,
  Headphones,
  LoaderCircle,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";
import type {
  AppliedPatch,
  CaseContent,
  CaseSnapshot,
  SceneId,
  VersionPatch,
} from "../../../shared/types";
import { formatTime } from "../../../shared/time";
import { deriveWave } from "../model/patch";
import { buildPatchPreview, localFileFor, PatchLoadError } from "../lib/loadPatch";
import {
  applyPatch,
  type PatchPreview,
  type PreviewOutcome,
  type ScenePreview,
} from "../model/migrate";
import { audioRef, storeAudio } from "../lib/audioStore";
import { probeAll } from "../lib/probe";

/** 导入时一并选择的音频文件，按文件名匹配补丁中的 `audio` 字段。 */
interface AudioFile {
  name: string;
  file: File;
}

const pendingReason: Record<string, string> = {
  deleted: "对应片段已被删除",
  split: "片段被拆分或之间插入了新内容",
  changed: "对应片段已重新录制",
  ambiguous: "映射边界不唯一",
  outside: "超出新旧录音的对应范围",
};

function reasonText(reason?: string) {
  return (reason && pendingReason[reason]) || "无法唯一定位";
}

function outcomeText(outcome: PreviewOutcome) {
  if (outcome.kind === "migrated")
    return `${formatTime(outcome.anchor.start)} — ${formatTime(outcome.anchor.end)}`;
  return reasonText(outcome.reason);
}

export function VersionPatchDialog({
  content,
  snapshot,
  clues,
  resume,
  appliedIds,
  onConfirm,
  onClose,
}: {
  content: CaseContent;
  snapshot: CaseSnapshot;
  clues: string[];
  resume: { sceneId: SceneId; position: number; rate: number };
  appliedIds: string[];
  onConfirm: (result: {
    applied: AppliedPatch;
    snapshot: CaseSnapshot;
    preview: PatchPreview;
  }) => void;
  onClose: () => void;
}) {
  const [rawText, setRawText] = useState("");
  const [files, setFiles] = useState<AudioFile[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<PatchPreview | null>(null);
  const patchRef = useRef<VersionPatch | null>(null);
  const jsonInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);

  // 补丁音频可以随文件一起提供，也可以指向已在服务器上的录音。
  const prepare = async () => {
    setError("");
    setPreview(null);
    setLoading(true);
    try {
      const result = await buildPatchPreview({
        text: rawText,
        files,
        content,
        snapshot,
        clues,
        resume,
        appliedIds,
        probe: probeAll,
      });
      patchRef.current = result.patch;
      setPreview(result.preview);
    } catch (e) {
      setError(
        e instanceof PatchLoadError
          ? e.message
          : e instanceof Error
            ? e.message
            : "无法读取补丁",
      );
    } finally {
      setLoading(false);
    }
  };

  const confirm = async () => {
    const patch = patchRef.current;
    if (!patch || !preview) return;
    setLoading(true);
    setError("");
    try {
      for (const recording of patch.recordings) {
        const local = localFileFor(recording, files);
        if (local)
          await storeAudio(
            audioRef(patch.id, recording.id),
            local.file,
          );
      }
      const stored: VersionPatch = {
        ...patch,
        recordings: patch.recordings.map((recording) => ({
          ...recording,
          // 本地文件转存到 IndexedDB；服务器已有地址则直接引用。
          audio: localFileFor(recording, files)
            ? audioRef(patch.id, recording.id)
            : recording.audio,
          wave:
            recording.wave ??
            deriveWave(
              content.episodes.find(
                (episode) => episode.id === recording.replaces,
              )!,
              recording.duration,
            ),
        })),
      };
      const result = applyPatch(snapshot, { ...preview, patch: stored }, Date.now());
      onConfirm({
        applied: result.applied,
        snapshot: result.snapshot,
        preview: { ...preview, patch: stored },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "补丁未能启用");
    } finally {
      setLoading(false);
    }
  };

  const patch = patchRef.current;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="version-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="version-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="dialog-header">
          <div>
            <span className="eyebrow">VERSION PATCH</span>
            <h2 id="version-title">
              <GitBranch size={20} /> 录音版本补丁
            </h2>
          </div>
          <button className="icon-button" aria-label="关闭补丁" onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        <p className="panel-description">
          导入新的录音、字幕与新旧片段对应表，先核对哪些笔记、已听范围与继续播放位置能准确迁移。
          原版录音会保留，可随时切回历史回听。
        </p>
        <div className="patch-inputs">
          <div>
            <label>补丁说明（JSON）</label>
            <button
              className="secondary-button"
              onClick={() => jsonInput.current?.click()}
            >
              <Upload size={14} /> 选择补丁文件
            </button>
            <input
              ref={jsonInput}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={async (event) => {
                const selected = event.target.files?.[0];
                if (!selected) return;
                setRawText(await selected.text());
                setPreview(null);
                setError("");
                event.target.value = "";
              }}
            />
            <small>
              {rawText ? "已读取补丁 JSON" : "尚未选择补丁文件"}
            </small>
            <button
              className="sample-link"
              onClick={async () => {
                setError("");
                try {
                  const response = await fetch("/patches/arrival-recut.json");
                  if (!response.ok) throw new Error("示例补丁无法读取");
                  setRawText(await response.text());
                } catch (e) {
                  setError(e instanceof Error ? e.message : "示例补丁无法读取");
                }
              }}
            >
              使用示例补丁
            </button>
          </div>
          <div>
            <label>新录音音频</label>
            <button
              className="secondary-button"
              onClick={() => audioInput.current?.click()}
            >
              <FileAudio size={14} /> 选择音频文件
            </button>
            <input
              ref={audioInput}
              type="file"
              multiple
              accept="audio/*"
              hidden
              onChange={(event) => {
                const selected = Array.from(event.target.files ?? []);
                setFiles((current) => [
                  ...current.filter(
                    (item) => !selected.some((file) => file.name === item.name),
                  ),
                  ...selected.map((file) => ({ name: file.name, file })),
                ]);
                setPreview(null);
                setError("");
                event.target.value = "";
              }}
            />
            <small>
              {files.length
                ? files.map((item) => item.name).join("、")
                : "按补丁中的文件名匹配"}
            </small>
          </div>
        </div>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        {!preview && (
          <div className="patch-actions">
            <button
              className="primary-button"
              disabled={loading || !rawText.trim()}
              onClick={() => void prepare()}
            >
              {loading ? <LoaderCircle size={15} /> : <ShieldCheck size={15} />}
              预览迁移结果
            </button>
          </div>
        )}
        {preview && patch && (
          <div className="patch-preview">
            <div className="patch-summary">
              <span>
                <b>{preview.counts.migratedNotes}</b> 篇笔记可迁移
              </span>
              <span className={preview.counts.pendingNotes ? "warn" : ""}>
                <b>{preview.counts.pendingNotes}</b> 篇保留旧源待处理
              </span>
              <span>
                <b>{preview.counts.migratedHeard}</b> 段已听范围可换算
              </span>
              <span className={preview.counts.pendingHeard ? "warn" : ""}>
                <b>{preview.counts.pendingHeard}</b> 段已听范围保留原版
              </span>
              <span>
                <b>{preview.counts.migratedResume}</b> 处继续播放位置可迁移
              </span>
              <span className={preview.counts.clueWindowMissing ? "warn" : ""}>
                <b>{preview.counts.clueWindowMissing}</b> 条正式线索需重新核对
              </span>
            </div>
            {preview.scenes.map((scene) => (
              <ScenePreviewCard key={scene.targetId} scene={scene} />
            ))}
            <p className="patch-footnote">
              原版录音不会被覆盖：启用后可随时在场景标题处切回原版回听。
              无法唯一定位的笔记会保留旧源与旧秒数，并在笔记中标记「待处理」。
            </p>
            <div className="patch-actions">
              <button
                className="secondary-button"
                onClick={() => {
                  setPreview(null);
                  patchRef.current = null;
                }}
              >
                返回修改
              </button>
              <button
                className="primary-button"
                disabled={loading}
                onClick={() => void confirm()}
              >
                {loading ? <LoaderCircle size={15} /> : <Check size={15} />}
                确认启用补丁
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function ScenePreviewCard({ scene }: { scene: ScenePreview }) {
  const [open, setOpen] = useState(true);
  const pending = scene.notes.filter(
    (item) => item.outcome.kind === "pending",
  ).length;
  return (
    <article className="patch-scene">
      <header onClick={() => setOpen(!open)}>
        <div>
          <strong>{scene.title}</strong>
          <small>
            {scene.baseTitle} <ArrowRight size={10} /> {scene.recording.version}
          </small>
        </div>
        <span className={pending ? "warn" : "ok"}>
          {pending
            ? `${pending} 篇待处理`
            : scene.notes.length
              ? "全部可迁移"
              : "无需迁移笔记"}
        </span>
      </header>
      {open && (
        <div className="patch-scene-body">
          <div className="patch-row">
            <span>
              <AudioLines size={12} /> 已听范围
            </span>
            <span>
              {scene.heard
                ? outcomeText(scene.heard.outcome)
                : "此段尚未收听"}
            </span>
          </div>
          <div className="patch-row">
            <span>
              <Headphones size={12} /> 继续播放
            </span>
            <span>
              {scene.resume ? outcomeText(scene.resume) : "不在此场景"}
            </span>
          </div>
          {scene.clues.length > 0 && (
            <div className="patch-clues">
              {scene.clues.map((clue) => (
                <div key={clue.clueId} className="patch-row">
                  <span>
                    {clue.outcome.kind === "ok" ? (
                      <Check size={12} />
                    ) : (
                      <AlertTriangle size={12} />
                    )}{" "}
                    正式线索「{clue.title}」
                  </span>
                  <span className={clue.outcome.kind === "ok" ? "" : "warn"}>
                    {clue.outcome.kind === "ok"
                      ? `声窗仍在 ${formatTime(clue.outcome.start)} — ${formatTime(clue.outcome.end)}`
                      : "新录音中已找不到这段声窗，需要重新核对"}
                  </span>
                </div>
              ))}
            </div>
          )}
          {scene.notes.length > 0 ? (
            <div className="patch-notes">
              {scene.notes.map(({ note, outcome }) => (
                <div
                  key={note.id}
                  className={`patch-note ${outcome.kind === "pending" ? "pending" : ""}`}
                >
                  <div>
                    <strong>{note.title}</strong>
                    <small>
                      {formatTime(note.anchor.start)} — {formatTime(note.anchor.end)}
                    </small>
                  </div>
                  <span>{outcomeText(outcome)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="empty-small">这个场景没有需要迁移的笔记。</p>
          )}
        </div>
      )}
    </article>
  );
}

