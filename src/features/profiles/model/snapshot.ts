import type {
  CaseContent,
  CaseSnapshot,
  EvidenceState,
  HeardHistory,
  Investigation,
  ResumePoint,
} from "../../../shared/types";
import { validateSnapshot } from "../lib/codec";
export function createSnapshot(
  content: CaseContent,
  story: Investigation,
  evidence: EvidenceState,
  heard: HeardHistory,
  resume: ResumePoint,
  appliedPatches?: CaseSnapshot["appliedPatches"],
  originalScenes?: CaseSnapshot["originalScenes"],
): CaseSnapshot {
  return validateSnapshot(
    {
      version: 1,
      caseId: content.id,
      story,
      evidence,
      heard,
      resume,
      ...(appliedPatches?.length ? { appliedPatches } : {}),
      ...(originalScenes?.length ? { originalScenes } : {}),
    },
    content,
    appliedPatches,
  );
}
