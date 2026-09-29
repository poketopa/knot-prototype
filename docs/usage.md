# 로컬 사용 가이드

이 문서는 소스 개발과 `v0.3.0-preview.1`의 로컬 백엔드 실행 방법입니다. 공유 서버에 연결하는 `v0.3.0-preview.2` 앱 사용자는 [릴리스 안내](releases/0.3.0-preview.2.md)를 참고하세요.

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

릴리스의 `knot-prototype-0.3.0-preview.1-arm64.dmg`를 열고 앱을 Applications로 복사한 뒤 실행합니다. 개발자 서명과 공증이 없어 macOS 정책에 따라 실행이 차단될 수 있습니다.

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
