# 브라우저 STT 프로토타입

`test/browser-stt` 브랜치 전용. 오디오 파일을 떨어뜨리거나 마이크로 녹음하면 **브라우저 안에서만** 돌아서
화자가 붙은 한국어 회의록을 만든다. 오디오는 서버로 나가지 않고, 네트워크는 모델 내려받기에만 쓴다.

계획과 판단 기준은 `../../docs/browser-prototype-plan.md`. 이 앱은 데스크탑 앱(`apps/desktop`)의
아키텍처·코드 규칙을 따르지 않는다 (계획 §0). 두 앱이 공유하는 순수 로직은 `packages/core`,
모델 카탈로그는 `packages/models`에 있다 (`.claude/skills/meeting-stt-dev/references/monorepo.md`).

## 돌리기

```bash
pnpm install          # 저장소 루트에서 (워크스페이스 전체를 한 번에)
pnpm dev:web          # 또는 pnpm --filter @meeting-stt/web run dev
```

`http://localhost:5180`에서 Chrome으로 연다. 시작 화면에서 참석자 수를 넣고 녹음하면 기록이 이 브라우저(IndexedDB)에 저장되고,
사이드바에서 다시 열 수 있다. 장치·모델·정밀도를 손으로 바꿔 재야 하면 리디자인 전 페이지인 `/test`를 연다 (계획 §10). 첫 실행 때 모델을 내려받는다 (q4f16 기준 약 600MB).
브라우저 캐시(Cache Storage)에 남으므로 두 번째부터는 네트워크를 쓰지 않는다.

**진행률에 "내려받는 중"이 떠도 실제로 받는 게 아닐 수 있다.** transformers.js는 캐시에서 읽을 때도
같은 이벤트를 쏘기 때문이다. 받아 둔 게 있는지는 화면 환경 패널의 **모델 캐시** 줄로 확인한다.
포트는 `strictPort`로 5180에 고정해 뒀다 — 포트가 밀리면 origin이 달라져 캐시가 통째로 미스 나기 때문이다.
저장소는 첫 로드 때 `navigator.storage.persist()`로 영구 모드로 올려 디스크 정리에 휩쓸리지 않게 한다.

WASM을 멀티스레드로 돌려 보려면 `VITE_COEP=1 pnpm --filter @meeting-stt/web run dev`로 띄운다.
COOP/COEP 헤더가 붙어 `crossOriginIsolated`가 켜지고, 화면의 환경 패널에서 확인할 수 있다.

## 확인용 명령

```bash
pnpm --filter @meeting-stt/web run test        # 순수 로직 단위 테스트
pnpm --filter @meeting-stt/web run typecheck
pnpm --filter @meeting-stt/web run build
```

브라우저를 띄우지 않고 **모델 배선만** 확인하려면 (onnxruntime-node로 돈다. 성능 측정용이 아니다):

```bash
pnpm --filter @meeting-stt/web exec tsx scripts/smokeModels.ts <16kHz mono wav> [참석자 수] [정답 json]
```

## 구조

| 경로            | 하는 일                                                                                              |
| --------------- | ---------------------------------------------------------------------------------------------------- |
| `src/audio/`    | 파일 → 16kHz mono `Float32Array`, 파형, 마이크 녹음(워크릿·Int16 블록·WAV)                           |
| `src/pipeline/` | 음량 정규화(공식은 core), VAD 후처리, 무음 제거 타임라인, powerset 디코딩, 군집, 워커 오케스트레이션 |
| `src/workers/`  | 화자 분리 워커, VAD+STT 워커                                                                         |
| `src/pages/`    | 화면 — 시작(`/`)·녹음 중(`/record`)·기록(`/meetings/:id`)·리디자인 전 프로토타입(`/test`)            |
| `src/shell/`    | 사이드바·상단 바 등 모든 화면이 함께 쓰는 틀                                                         |
| `src/state/`    | 화면을 옮겨도 이어지는 상태 — 저장된 기록 목록, 녹음, 파이프라인 잡 (React context)                  |
| `src/lib/`      | 환경 확인, 모델 캐시 조회, IndexedDB 기록 저장소, 자동 옵션, 날짜 포맷                               |
| `src/ui/`       | `/test` 페이지의 패널(환경·녹음·오디오·실행·결과)과 녹음 훅                                          |

## 녹음

`getUserMedia` + AudioWorklet으로 16kHz mono PCM을 직접 모은다(MediaRecorder를 쓰지 않는 이유는 계획 §5 S6).
정지하면 WAV `File`이 만들어져 **드롭한 파일과 같은 입구**로 들어가므로, 이후 단계는 파일 입력과 완전히 같다.
녹음본은 `WAV 저장`으로 내려받아 데스크탑 앱에 그대로 넣어 비교할 수 있다.

녹음 중에는 입력 세기가 dBFS로 나온다. 말할 때 −20 dBFS 근처면 적당하고, −40 dBFS 아래로 머물면
Whisper가 구간을 통째로 놓친다 (`docs/phase1-results.md`). 디스크에 쓰지 않으므로 녹음 중 새로고침하면 사라진다.

## 쓰는 모델

전부 Hugging Face에서 받고 `@huggingface/transformers` 하나로 돌린다.
저장소 id와 dtype별 파일 이름은 `@meeting-stt/models/web`에 한 번만 적혀 있다.

| 역할   | 모델                                                                            |
| ------ | ------------------------------------------------------------------------------- |
| VAD    | `onnx-community/silero-vad`                                                     |
| STT    | `onnx-community/whisper-large-v3-turbo_timestamped` (small·tiny도 고를 수 있다) |
| 분할   | `onnx-community/pyannote-segmentation-3.0`                                      |
| 임베딩 | `onnx-community/wespeaker-voxceleb-resnet34-LM`                                 |

STT 저장소 이름에 `_timestamped`가 붙는 이유는 기본 export에 cross-attention 출력이 없어
단어 타임스탬프가 동작하지 않기 때문이다. 가중치와 파일 크기는 같다.
