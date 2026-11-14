export {
  parseVersionPatch,
  deriveWave,
  SEGMENT_TOLERANCE,
} from "./model/patch";
export { mapPoint, mapRange, mapHeardThrough, mapPointBack } from "./model/mapping";
export {
  previewPatch,
  applyPatch,
  type PatchPreview,
  type PreviewInput,
  type PreviewOutcome,
  type ScenePreview,
  type ApplyResult,
} from "./model/migrate";
export { patchedEpisodes, baseFor, targetFor, recordingFor } from "./model/catalog";
export {
  resolvePlayableEpisode,
  versionChoice,
  mapForwardThroughChain,
  mapBackThroughChain,
} from "./model/select";
export {
  audioRef,
  isAudioRef,
  storeAudio,
  hydrateAudio,
  audioUrl,
  audioBlob,
} from "./lib/audioStore";
export { embedPatchAudio, absorbPatchAudio } from "./lib/portability";
export { validateAppliedPatches, withPatchedEpisodes } from "./lib/patchCodec";
export { VersionPatchDialog } from "./ui/VersionPatchDialog";
export { buildPatchPreview, localFileFor, PatchLoadError } from "./lib/loadPatch";
export { probeAll, probeAudioSource } from "./lib/probe";
