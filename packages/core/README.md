# @meeting-stt/core

데스크탑 앱(`apps/desktop`)과 브라우저 앱(`apps/web`)이 **함께 쓰는 순수 TS**. 빌드 단계가 없고 소스를 그대로 import한다.

| 모듈                             | 무엇                                                                                                 |
| -------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `@meeting-stt/core/types`        | 파이프라인 중간 산출물 타입 (`SttSegment`, `SpeakerSegment`, `SpeakerPiece`, `MergedUtterance`)      |
| `@meeting-stt/core/merge`        | 단어 타임스탬프 → 화자 배정(`assignSpeakers`), 같은 화자 연속 발화 병합(`mergeUtterances`)           |
| `@meeting-stt/core/format`       | 타임스탬프 `[hh:mm:ss]`, 복사용 텍스트·마크다운 조립, 화자 표시 이름                                 |
| `@meeting-stt/core/normalize`    | 음량 정규화의 상수와 계산 (프레임 길이, 90퍼센타일, 목표 −20 dBFS, 게인 상한 +30dB)                  |
| `@meeting-stt/core/speakerCount` | 참석자 수 허용 범위와 검증                                                                           |
| `@meeting-stt/core/audio`        | 오디오 형식 상수 (16kHz, mono, 16bit)                                                                |
| `@meeting-stt/core/termReadings` | 사람이 검수한 개발·제품 용어의 한글 읽기 사전(`TERM_READINGS`)과 대소문자 무시 찾기(`termReadingOf`) |

`electron`·`fs`·DOM·`react`를 import하지 않는다. 규약은 `.claude/skills/meeting-stt-dev/references/monorepo.md`.
