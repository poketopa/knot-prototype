# 로컬 사용 가이드

이 문서는 소스 개발의 로컬 백엔드 실행 방법입니다. 공유 서버에 연결하는 앱 사용자는 [preview.11 릴리스 안내](releases/0.3.0-preview.11.md)를 참고하세요.

## 준비물

- macOS 14 이상, Apple Silicon Mac
- Node.js 22 이상, pnpm 10
- Docker Desktop
- GitHub OAuth 앱

로컬 callback URL은 `http://127.0.0.1:4310/v1/auth/github/callback`입니다.

## 실행

```bash
git clone https://github.com/poketopa/knot-prototype.git
cd knot-prototype
corepack enable
corepack pnpm install --frozen-lockfile
cp .env.prototype.example .env.prototype.local
```

`.env.prototype.local`에 `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`을 넣은 뒤 서버를 시작합니다.

```bash
corepack pnpm prototype:server
```

정상 실행되면 `http://127.0.0.1:4310/health`가 응답합니다.

```bash
corepack pnpm prototype:status
corepack pnpm prototype:stop
```

소스에서 실행하려면 Xcode Command Line Tools와 CMake가 필요합니다. 먼저 다음 명령으로 네이티브 실행 파일을 준비합니다.

```bash
corepack pnpm --filter meeting-stt exec tsx scripts/setupBin.ts --from-source
```

그 후 개발 모드 또는 unpacked 앱으로 실행합니다.

```bash
corepack pnpm prototype:dev
corepack pnpm prototype:start
```

첫 실행 시 STT 모델과 AI 공급자를 선택합니다. 외부 AI 공급자를 선택하면 회의 내용이 해당 공급자 API로 전송될 수 있습니다.

## 녹음과 문서 확인

1. **녹음** 탭에서 녹음을 시작하고 종료합니다.
2. 같은 탭에서 전사·AI 정리·서버 보관 상태를 확인합니다. 실패하면 **실패한 단계 다시 시도**를 누릅니다. 두 정리 중 하나만 실패하면 완료한 정리는 다시 만들지 않습니다.
3. **정리 1**, **정리 2**의 주제별 문서 묶음을 비교합니다. 회의마다 좌우 순서를 무작위로 정하며, 화면을 다시 열어도 순서는 유지됩니다.
4. 더 마음에 드는 정리 하나와 선택 이유, 회의 종류를 고른 뒤 **선택한 정리 발행**을 누릅니다. 기타 이유에는 설명을 덧붙일 수 있습니다. 선택한 쪽의 문서들만 문서 목록에 나타나고, 선택받지 못한 결과도 DB에 계속 보관됩니다. 선택은 변경할 수 없습니다.
5. **이번 회의에서 생성된 문서** 또는 **문서** 탭에서 발행한 문서를 엽니다. **원문 보기**에서 해당 문서를 만든 한 회의의 전사를 확인합니다.
6. 서버 보관이 끝나면 녹음 시작 화면으로 돌아갑니다. 저장이 지연되거나 실패하면 처리 화면에서 상태와 재시도를 확인합니다. 선택을 미뤘다면 녹음 탭에서 선택 대기 중인 정리를 다시 열 수 있습니다.

이전 녹음 목록은 제공하지 않습니다. 기존 녹음·전사·AI 산출물은 계속 보관됩니다. 같은 주제를 다른 회의에서 논의하면 같은 도메인 아래 새 문서가 생깁니다.

## 기존 문서 다시 정리

**설정 → 문서 관리 → 기존 문서 다시 정리**를 누르면 이 Mac의 현재 로그인 사용자에게 보관된 전사를 현재 선택한 AI로 다시 분석합니다. 기존 녹음·전사·AI 결과·서버 스냅샷은 보존합니다. 성공한 새 문서는 기존 문서 대신 목록에 나타나며, 서버 반영은 연결 상태에 따라 이어서 진행됩니다. 같은 재정리 버전에서 성공한 녹음은 반복 분석하지 않습니다. 다른 기기에만 보관된 전사는 이 기능의 대상에 포함되지 않습니다.
