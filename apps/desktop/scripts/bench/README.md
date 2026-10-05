# AI 서버 측정 실행 문서 (E3: STT 처리 시간·자원·전력)

맥미니, 맥북, 윈도우 데스크탑에서 같은 음성과 같은 whisper.cpp 버전(v1.8.4), 같은 인자로 STT를 돌린다. 처리 시간·메모리·전력을 `runs.csv` 한 줄씩 남긴다. 앱 화면 없이 앱과 같은 인자(`buildWhisperArgs`, VAD 켬)를 쓴다.

판정 기준과 실험 목록은 사용자 맥북의 `~/Desktop/knot/ai-server-evaluation/plan.md`에 있다. 이 문서는 실행 방법만 다룬다.

## 에이전트 실행 규칙

이 문서를 읽고 실행하는 에이전트(Codex 등)는 다음을 지킨다.

1. **이 문서의 명령만 실행한다.** 스크립트·인자·모델·바이너리 버전을 바꾸지 않는다. 막히면 고치려 하지 말고 멈춘 뒤 명령과 오류 원문을 보고한다.
2. **측정 명령이 도는 동안 다른 명령을 실행하지 않는다.** 설치·다운로드·빌드는 측정 전에 끝낸다. 진행 상황을 확인하려고 무거운 명령을 반복하지 않는다.
3. **음성·전사 파일을 외부로 보내지 않는다.** 업로드, git 커밋, 원격 저장소 push를 하지 않는다.
4. 측정 전에 사용자에게 알린다: 전원 연결, 다른 앱 종료, 측정 중 장비 사용 금지.
5. 끝나면 결과 폴더 경로, 마지막 `완료:` 줄, 실패 수, `report.ts` 표를 그대로 보고한다.

## 1. 음성 준비 (맥북에서 한 번)

모든 장비가 같은 파일을 써야 비교할 수 있다. 맥북에서 만들고 다른 장비로 복사한다.

길이별로 10분, 30분, 60분, 120분 근처의 녹음을 2개씩 고른다. 속도 측정에는 정답 전사가 필요 없다.

```bash
cd apps/desktop
corepack pnpm exec tsx scripts/bench/prepare.ts <녹음 파일 또는 폴더...>
```

- 결과: `scripts/fixtures/bench/audio/`에 `a01.wav`… 파일과 `manifest.json`, `probe.wav`가 생긴다. 앱 녹음과 같은 16kHz mono로 바꾸고 앱과 같은 음량 정규화를 적용한 파일이다.
- 이 폴더를 통째로 다른 장비의 같은 경로(`apps/desktop/scripts/fixtures/bench/audio/`)로 복사한다. AirDrop, USB, 공유 폴더 중 편한 방법을 쓴다. 측정 스크립트가 sha256으로 같은 파일인지 확인한다.

## 2. 장비 준비

### 맥 (맥미니·맥북)

필요: Xcode Command Line Tools, Homebrew, Node.js 22 이상, git.

```bash
xcode-select --install            # 이미 있으면 건너뜀
brew install cmake macmon         # macmon: sudo 없이 전력을 읽는 도구
git clone https://github.com/poketopa/knot-prototype.git
cd knot-prototype
git checkout bench/ai-server-eval
corepack enable
corepack pnpm install --frozen-lockfile --ignore-scripts
cd apps/desktop
corepack pnpm exec tsx scripts/setupBin.ts --from-source   # whisper.cpp v1.8.4 Metal 빌드
corepack pnpm exec tsx scripts/setupModels.ts --all        # Whisper 3종 + VAD 등, 약 2GB
```

- `--ignore-scripts`는 측정에 필요 없는 Electron 설치를 건너뛴다. 이후 `tsx` 실행이 실패하면 `--ignore-scripts` 없이 다시 설치한다.
- `macmon pipe -s 1`을 실행해 JSON 한 줄이 나오는지 확인한다. `sys_power`가 0보다 크면 시스템 전체 전력을, 0이면 칩 전력만 기록한다.

### 윈도우 (GTX 1660 Super 데스크탑)

필요: Git, Node.js 22 LTS, NVIDIA 드라이버.

```powershell
nvidia-smi                        # GPU 이름과 "CUDA Version" 확인
git clone https://github.com/poketopa/knot-prototype.git
cd knot-prototype
git checkout bench/ai-server-eval
corepack enable
corepack pnpm install --frozen-lockfile --ignore-scripts
cd apps\desktop
corepack pnpm exec tsx scripts/setupModels.ts --all
```

CUDA용 whisper-cli 준비:

1. https://github.com/ggml-org/whisper.cpp/releases/tag/v1.8.4 에서 `whisper-cublas-12.4.0-bin-x64.zip`을 받는다. `nvidia-smi`의 CUDA Version이 12.4보다 낮으면 `whisper-cublas-11.8.0-bin-x64.zip`을 받는다.
2. 압축 안의 `whisper-cli.exe`와 모든 `.dll`을 `apps\desktop\resources\bin\win32-x64-cuda\`에 한 폴더로 풀어 넣는다(하위 폴더 없이).
3. 다른 버전이나 다른 빌드로 바꾸지 않는다. 위 파일이 없거나 실행되지 않으면 멈추고 보고한다.

CPU 전력(선택): LibreHardwareMonitor를 관리자 권한으로 실행하고 Options → Remote Web Server → Run을 켠다. 측정 명령에 `--lhm-url=http://localhost:8085/data.json`을 붙인다. 없으면 GPU 전력만 기록된다.

### 절전 끄기

- 맥: 측정 명령 앞에 `caffeinate -dims`를 붙인다(아래 명령에 포함됨).
- 윈도우: 설정 → 전원에서 "절전 모드 전환"을 측정 동안 "안 함"으로 바꾼다. 끝나면 원래대로 되돌린다.

## 3. 설치 확인 (1분)

```bash
# 맥
corepack pnpm exec tsx scripts/bench/stt.ts --machine=macmini --quick
```

```powershell
# 윈도우
corepack pnpm exec tsx scripts/bench/stt.ts --machine=desktop --quick --bin=resources\bin\win32-x64-cuda\whisper-cli.exe
```

통과 조건:

- `· metal 사용 확인`(맥) 또는 `· cuda 사용 확인`(윈도우)
- `전력 출처 ...` 줄에 맥은 `mac-soc`, 윈도우는 `nvidia-gpu`가 있다
- `완료: 1회 중 실패 0회`

`백엔드가 cpu입니다`가 나오면 GPU를 쓰지 못한 것이다. 측정하지 말고 `probe-stderr.log`를 보고한다.

## 4. 측정

`--machine`은 `macmini`, `macbook`, `desktop` 중 하나로 쓴다. 기본값은 모델 2개(turbo-q5, large-v3-q5) × 입력 전부 × 3회다. 실행마다 쉬는 시간 20초를 두고, 시작할 때 유휴 전력을 60초 잰다.

```bash
# 맥미니 (맥북은 --machine=macbook)
caffeinate -dims corepack pnpm exec tsx scripts/bench/stt.ts --machine=macmini
```

```powershell
# 윈도우
corepack pnpm exec tsx scripts/bench/stt.ts --machine=desktop --bin=resources\bin\win32-x64-cuda\whisper-cli.exe
```

E1(CPU만으로 처리)은 맥미니에서만 따로 한 번 돌린다. CPU는 느리므로 10~30분 입력 하나만 쓴다.

```bash
caffeinate -dims corepack pnpm exec tsx scripts/bench/stt.ts --machine=macmini --no-gpu --models=turbo-q5 --inputs=a01 --repeats=1
```

**긴 측정은 에이전트 명령 시간 제한에 걸릴 수 있다.** 수십 분 이상 걸리면 사용자가 터미널에서 위 명령을 직접 실행하거나, 에이전트가 백그라운드로 띄우고 바로 돌아온다. 백그라운드로 띄웠다면 끝날 때까지 다른 명령을 실행하지 않는다.

```bash
# 맥: 백그라운드 실행, 로그는 bench.log
nohup caffeinate -dims corepack pnpm exec tsx scripts/bench/stt.ts --machine=macmini > bench.log 2>&1 &
```

```powershell
# 윈도우: 새 창에서 실행
Start-Process powershell -ArgumentList '-NoExit','-Command','corepack pnpm exec tsx scripts/bench/stt.ts --machine=desktop --bin=resources\bin\win32-x64-cuda\whisper-cli.exe *> bench.log'
```

**소요 시간 어림**: 측정 시작 시 `음성 합계 N분`이 출력된다. GPU에서는 대략 음성 합계의 1/10~1/4, 여기에 실행마다 쉬는 20초가 더해진다. 너무 길면 `--inputs=a01,a03,a05`처럼 일부만 고른다. 장비끼리 같은 입력을 써야 한다.

## 5. 결과 회수

- 결과 폴더: `apps/desktop/scripts/fixtures/bench/results/<machine>-stt-<시각>/`

| 파일 | 내용 |
| --- | --- |
| `runs.csv` | 실행 한 번당 한 줄. 처리 시간, RTF, 메모리, 전력 |
| `samples.csv` | 1초 단위 전력·메모리 원본. 검산용 |
| `session.json` | 장비 사양, 바이너리·모델 sha256, 유휴 전력(시작·끝) |
| `transcripts/` | 전사 결과. 회의 내용이 들어 있으니 본인 장비 밖으로 내보내지 않는다 |
| `probe-stderr.log`, `errors.log` | 백엔드 확인 로그, 실패 로그 |

- 이 폴더를 맥북의 `~/Desktop/knot/ai-server-evaluation/results/`로 복사한다.
- 비교표 만들기(맥북):

```bash
corepack pnpm exec tsx scripts/bench/report.ts ~/Desktop/knot/ai-server-evaluation/results/* --out=report.md
```

## 측정값 읽는 법

- **RTF** = 처리 시간 ÷ 음성 길이. 0.1이면 1시간 회의를 6분에 처리한다. 실행마다 새 프로세스를 띄우므로 앱처럼 모델 로딩 시간이 포함된다.
- **첫 실행**: 맥은 부팅 후 첫 실행에 Metal 셰이더 준비 시간이 붙는다(M1 Pro에서 약 10초 확인). `run` 열로 첫 회와 이후를 구분한다.
- **전력 범위(`power_scope`)**: 장비마다 읽을 수 있는 범위가 다르다. 범위가 다르면 평균 W를 직접 비교하지 않는다.

| scope | 장비 | 측정 범위 |
| --- | --- | --- |
| `system` | 맥 (`macmon` sys_power) | 시스템 전체 |
| `soc` | 맥 (sys_power를 못 읽을 때) | CPU+GPU+ANE |
| `gpu` / `gpu+cpu` | 윈도우 | GPU 보드(+CPU 패키지). 메인보드·RAM·파워 손실 제외 |

- **회의 1시간당 추가 Wh**(`extra_wh_per_audio_h`) = (처리 중 평균 − 유휴 평균) × 처리 시간 ÷ 음성 길이(시간). 장비끼리 비교할 때는 이 값을 쓴다.
- **`swap_growth_mb`**(맥): 측정 중 스왑이 유휴 때보다 늘어난 양. 크면 메모리가 모자랐다는 신호다.
- **`vram_peak_mb`**(윈도우): 유휴 대비 GPU 메모리 증가량.
