import { DEFAULT_WHISPER_MODEL_ID, type WhisperModelId } from '@meeting-stt/models/desktop'

/** 8GB 미만이면 large 계열 모델이 스왑을 유발한다 */
const LOW_MEMORY_BYTES = 8 * 1024 * 1024 * 1024
const LOW_CORE_COUNT = 4
const LOW_SPEC_MODEL_ID: WhisperModelId = 'small-q5_1'

interface RecommendWhisperModelParams {
  cpuCount: number
  totalMemoryBytes: number
}

/**
 * 장비 사양으로 온보딩의 기본 선택을 고른다. 강제하지 않고 기본값만 정한다.
 * `large-v3-q5`는 turbo보다 2.3배 느린데 품질 이득이 작아 자동으로 권장하지 않는다
 * (`docs/phase1-results.md`, `references/distribution.md`).
 */
export const recommendWhisperModelId = ({
  cpuCount,
  totalMemoryBytes
}: RecommendWhisperModelParams) =>
  totalMemoryBytes < LOW_MEMORY_BYTES || cpuCount <= LOW_CORE_COUNT
    ? LOW_SPEC_MODEL_ID
    : DEFAULT_WHISPER_MODEL_ID
