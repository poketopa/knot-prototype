# Third-party notices for Knot Meeting Prototype

This document covers third-party components that are redistributed with the macOS desktop app or downloaded by the app at runtime. Full license texts bundled with the app are under `apps/desktop/resources/licenses/`.

## Application source attribution

This prototype is based on [geongyu09/meeting-stt](https://github.com/geongyu09/meeting-stt) at commit `617a525a9a7d36628261683062e484c9e08f7f14`. No repository-wide license was present in the source snapshot. The third-party licenses below do not grant a license to the application source as a whole.

## Redistributed in the macOS app bundle

### whisper.cpp `whisper-cli` v1.8.4

- Use: local speech-to-text executable built for macOS arm64.
- Source: https://github.com/ggml-org/whisper.cpp/tree/v1.8.4
- License: MIT License.
- Bundled license text: `apps/desktop/resources/licenses/whisper.cpp/LICENSE`

### llama.cpp `llama-cli` b10622

- Use: local LLM executable and required ggml/llama dynamic libraries for macOS arm64.
- Source: https://github.com/ggml-org/llama.cpp/releases/tag/b10622
- License: MIT License.
- Bundled license text: `apps/desktop/resources/licenses/llama.cpp/LICENSE`

### sherpa-onnx v1.13.6

- Use: local speaker diarization executable and sherpa-onnx dynamic libraries for macOS arm64.
- Source: https://github.com/k2-fsa/sherpa-onnx/releases/tag/v1.13.6
- License: Apache License 2.0.
- Bundled license text: `apps/desktop/resources/licenses/sherpa-onnx/LICENSE`

### ONNX Runtime dynamic library from the sherpa-onnx v1.13.6 macOS arm64 archive

- Use: native inference runtime loaded by the bundled sherpa-onnx executable.
- Source: https://github.com/microsoft/onnxruntime
- License: MIT License, with third-party notices.
- Bundled license text: `apps/desktop/resources/licenses/onnxruntime/LICENSE`
- Bundled third-party notices: `apps/desktop/resources/licenses/onnxruntime/ThirdPartyNotices.txt`

### Google Sans

- Use: bundled UI font.
- License: SIL Open Font License 1.1.
- Bundled license text: `apps/desktop/resources/licenses/fonts/googleSans/OFL.txt`

### Google Sans Code

- Use: bundled UI monospace font.
- License: SIL Open Font License 1.1.
- Bundled license text: `apps/desktop/resources/licenses/fonts/googleSansCode/OFL.txt`

### Pretendard

- Use: bundled UI Korean font.
- License: SIL Open Font License 1.1.
- Bundled license text: `apps/desktop/resources/licenses/fonts/pretendard/OFL.txt`

### Bundled renderer dependencies

React 19.2.8, React DOM 19.2.8, Scheduler 0.27.0, and React Router 8.3.0 are bundled into the renderer. Their MIT license texts are included under `apps/desktop/resources/licenses/npm/`. Other packaged npm dependencies retain their license files in the app archive.

## Runtime downloads, not redistributed in the app bundle

The following assets are downloaded by the app or setup scripts and are not committed or bundled in the public app source by default. Their source URLs and checksums are defined in `packages/models/src/desktop.ts` and `apps/desktop/scripts/assets.ts`.

### Whisper GGML models

- Use: selectable local speech-to-text models.
- Files:
  - `ggml-large-v3-turbo-q5_0.bin`
  - `ggml-large-v3-q5_0.bin`
  - `ggml-small-q5_1.bin`
- Source: https://huggingface.co/ggerganov/whisper.cpp
- License reference: the Hugging Face source repository reports MIT. Upstream project references: https://github.com/openai/whisper and https://github.com/ggml-org/whisper.cpp

### Silero VAD GGML model

- Use: local voice activity detection model for whisper.cpp.
- File: `ggml-silero-v5.1.2.bin`
- Source: https://huggingface.co/ggml-org/whisper-vad
- License reference: the Hugging Face source repository reports MIT. Upstream project reference: https://github.com/snakers4/silero-vad

### sherpa-onnx pyannote segmentation model

- Use: local speaker segmentation model.
- File extracted by the app as `sherpa-onnx-pyannote-segmentation-3-0.onnx`.
- Source archive: https://github.com/k2-fsa/sherpa-onnx/releases/tag/speaker-segmentation-models
- License reference: the Hugging Face upstream model page reports MIT and gated access. Upstream model reference: https://huggingface.co/pyannote/segmentation-3.0

### 3D-Speaker ERes2Net embedding model

- Use: local speaker embedding model.
- File: `3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx`.
- Source: https://github.com/k2-fsa/sherpa-onnx/releases/tag/speaker-recongition-models
- License reference: Apache License 2.0 in the upstream 3D-Speaker repository. Upstream project reference: https://github.com/modelscope/3D-Speaker

### Qwen3-4B-Instruct-2507 GGUF model

- Use: optional local summary/analysis model.
- File: `Qwen3-4B-Instruct-2507-Q4_K_M.gguf`.
- Source: https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF
- License reference: the Hugging Face source repository reports Apache-2.0. Verify the Hugging Face model card again before redistributing the model file itself.

## Notes for release builders

- `apps/desktop/resources/bin/` is ignored in Git because native binaries are build artifacts. If a release build copies those files into the app bundle, include `apps/desktop/resources/licenses/` in the same bundle.
- Downloaded model files are large runtime assets and should not be committed unless their license terms are rechecked for redistribution.
- This notice does not replace dependency license review for npm packages included by Electron/electron-builder in the final packaged app.
