import { useState } from "react";
import {
  Bookmark,
  Check,
  Headphones,
  Pin,
  Plus,
  Trash2,
  X,
  Pencil,
  AlertTriangle,
  GitBranch,
} from "lucide-react";
import type {
  CaseContent,
  EvidenceNote,
  EvidenceState,
} from "../../../shared/types";
interface Props {
  state: EvidenceState;
  content: CaseContent;
  onJump: (note: EvidenceNote) => void;
  onEdit: (id: string, text: string) => void;
  onDelete: (id: string) => void;
  onPin: (id: string) => void;
  onNew: () => void;
  onResolve: (id: string, anchor?: { start: number; end: number }) => void;
  captureWindow: () => { start: number; end: number } | null;
}
const time = (n: number) =>
  `${Math.floor(n / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(n % 60)
    .toString()
    .padStart(2, "0")}`;
export function EvidencePanel({
  state,
  content,
  onJump,
  onEdit,
  onDelete,
  onPin,
  onNew,
  onResolve,
  captureWindow,
}: Props) {
  const [editing, setEditing] = useState<string | null>(null),
    [draft, setDraft] = useState(""),
    [rechecking, setRechecking] = useState<string | null>(null),
    [windowDraft, setWindowDraft] = useState({ start: 0, end: 0 });
  const notes = [...state.notes].sort(
    (a, b) => Number(b.pinned) - Number(a.pinned),
  );
  return (
    <aside className="evidence-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">CASE NOTES</span>
          <h2>
            <Bookmark size={18} /> 证据手记
          </h2>
        </div>
        <span className="count-badge">{state.clues.length} 条线索</span>
      </div>
      <p className="panel-description">记录那些不该被忽略的声音。</p>
      <button className="new-note" onClick={onNew}>
        <Plus size={16} /> 添加收听笔记
      </button>
      <div className="evidence-list">
        {notes.length === 0 ? (
          <div className="empty-notes">
            <Headphones size={26} />
            <p>还没有收听笔记</p>
            <small>播放录音，捕捉值得留意的片刻。</small>
          </div>
        ) : (
          notes.map((note) => (
            <article
              className={`evidence-card ${note.pinned ? "is-pinned" : ""}`}
              key={note.id}
            >
              <div className="note-heading">
                <span className="note-kind">
                  {note.clueId ? "声音线索" : "收听笔记"}
                  {note.migration?.status === "pending" && (
                    <span className="pending-badge">
                      <AlertTriangle size={10} /> 待处理
                    </span>
                  )}
                  {note.migration?.status === "migrated" && (
                    <span className="migrated-badge">
                      <GitBranch size={10} /> 已迁移
                    </span>
                  )}
                </span>
                <button
                  className={`icon-button ${note.pinned ? "active" : ""}`}
                  aria-label={note.pinned ? "取消置顶" : "置顶笔记"}
                  onClick={() => onPin(note.id)}
                >
                  <Pin size={14} />
                </button>
              </div>
              <h3>
                {note.clueId
                  ? content.clues.find((clue) => clue.id === note.clueId)
                      ?.title || note.title
                  : note.title}
              </h3>
              {editing === note.id ? (
                <>
                  <textarea
                    aria-label="编辑笔记"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                  />
                  <div className="note-actions">
                    <button
                      disabled={!draft.trim()}
                      onClick={() => {
                        onEdit(note.id, draft);
                        setEditing(null);
                      }}
                    >
                      <Check size={13} /> 保存
                    </button>
                    <button onClick={() => setEditing(null)}>
                      <X size={13} /> 取消
                    </button>
                  </div>
                </>
              ) : (
                <p className="note-text">{note.text}</p>
              )}
              {note.migration?.status === "pending" && (
                <div className="pending-panel">
                  <small>
                    这段声窗在版本补丁后无法唯一定位，已保留旧源与旧秒数。
                    {note.migration.oldAnchor &&
                      ` 旧位置 ${time(note.migration.oldAnchor.start)} — ${time(note.migration.oldAnchor.end)}。`}
                  </small>
                  {rechecking === note.id ? (
                    <div className="window-editor">
                      <label>
                        起点
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          value={windowDraft.start}
                          onChange={(event) =>
                            setWindowDraft((d) => ({
                              ...d,
                              start: Number(event.target.value),
                            }))
                          }
                        />
                      </label>
                      <label>
                        终点
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          value={windowDraft.end}
                          onChange={(event) =>
                            setWindowDraft((d) => ({
                              ...d,
                              end: Number(event.target.value),
                            }))
                          }
                        />
                      </label>
                      <button
                        disabled={
                          !Number.isFinite(windowDraft.end) ||
                          windowDraft.end <= windowDraft.start
                        }
                        onClick={() => {
                          onResolve(note.id, windowDraft);
                          setRechecking(null);
                        }}
                      >
                        <Check size={12} /> 使用当前录音
                      </button>
                      <button onClick={() => setRechecking(null)}>
                        <X size={12} /> 取消
                      </button>
                    </div>
                  ) : (
                    <div className="pending-actions">
                      <button
                        onClick={() => {
                          setRechecking(note.id);
                          const captured = captureWindow();
                          setWindowDraft(
                            captured ?? {
                              start: Number(
                                note.migration!.oldAnchor.start.toFixed(1),
                              ),
                              end: Number(
                                note.migration!.oldAnchor.end.toFixed(1),
                              ),
                            },
                          );
                        }}
                      >
                        <Headphones size={12} /> 重新核对声窗
                      </button>
                      <button onClick={() => onResolve(note.id)}>
                        <Pin size={12} /> 继续保留旧源
                      </button>
                    </div>
                  )}
                </div>
              )}
              <button className="note-play" onClick={() => onJump(note)}>
                <Headphones size={13} />
                {
                  content.scenes.find(
                    (scene) => scene.id === note.anchor.sceneId,
                  )?.title
                }{" "}
                · {time(note.anchor.start)} — {time(note.anchor.end)}
                {note.anchor.sourceEpisodeId &&
                  note.migration?.status === "pending" &&
                  " · 原版"}
              </button>
              <div className="note-actions">
                <button
                  aria-label="编辑笔记"
                  onClick={() => {
                    setEditing(note.id);
                    setDraft(note.text);
                  }}
                >
                  <Pencil size={13} /> 编辑
                </button>
                <button aria-label="删除笔记" onClick={() => onDelete(note.id)}>
                  <Trash2 size={13} /> 删除
                </button>
              </div>
            </article>
          ))
        )}
      </div>
      <footer className="evidence-footer">所有笔记仅保存在此设备</footer>
    </aside>
  );
}
