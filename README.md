# Knot Meeting Prototype

Knot Meeting Prototype은 macOS 개인 회의 기록 검증 도구입니다. GitHub OAuth로 로그인하고, 녹음 파일·전사 원본·주제별 AI 문서를 저장합니다. 각 문서는 하나의 회의만 참조하며, 같은 도메인의 문서들을 사이드바에서 찾아볼 수 있습니다.

이 저장소는 [`geongyu09/meeting-stt`](https://github.com/geongyu09/meeting-stt) `617a525a9a7d36628261683062e484c9e08f7f14`를 기반으로 만든 프로토타입입니다. 원본 저장소의 라이선스는 이 문서에서 새로 해석하거나 단정하지 않습니다.

## 상태

`v0.3.0-preview.8`은 **문서 → 녹음 → 설정** 세 탭으로 구성됩니다. 녹음 후 주제별 문서를 만들고, AI가 내용에 맞게 고른 핵심 섹션과 자세한 논의 목록을 보여줍니다. 문서는 읽기 전용입니다. macOS 14 이상 Apple Silicon Mac에서 사용하며, 공유 서버 연결 앱 사용자는 로컬 Docker나 OAuth 앱을 설정할 필요가 없습니다.

이 검증 환경에 업로드한 녹음·전사·AI 정리 파일은 공개 읽기가 가능합니다. 공개해도 되는 테스트 회의만 사용하세요.

릴리스 노트: [docs/releases/0.3.0-preview.8.md](docs/releases/0.3.0-preview.8.md)

## 기능

- GitHub OAuth 로그인
- 회의 녹음, 전사 원본 저장, AI 정리본 저장
- 녹음 탭에서 현재 녹음의 처리 상태·실패 재시도·생성 문서 확인
- 도메인별 트리에서 회의별 주제 문서와 단일 전사 원문 읽기
- 핵심 섹션과 개괄식 논의 상세, 기존 문서·스냅샷 보존
- 로컬 Fastify API와 PostgreSQL 저장
- EC2 배포 예시, 로컬 DB 백업 스크립트, systemd timer 템플릿

## 앱 설치

[공유 서버 연결 버전](https://github.com/poketopa/knot-prototype/releases/latest)에서 DMG를 내려받아 Applications에 복사합니다. 첫 실행에서 GitHub에 로그인하고 모델을 설정합니다. preview.5 이상 사용자는 앱 안에서 새 버전을 확인하고 내려받아 설치할 수 있습니다. preview.4 이하에서는 먼저 preview.5 이상을 한 번 수동 설치해야 합니다.

## 로컬 개발 시작

필요한 도구는 Node.js 22 이상, pnpm 10, Docker Desktop입니다.

```bash
git clone https://github.com/poketopa/knot-prototype.git
cd knot-prototype
corepack enable
corepack pnpm install --frozen-lockfile
cp .env.prototype.example .env.prototype.local
```

`.env.prototype.local`에 `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`을 넣습니다.

```bash
corepack pnpm prototype:server # 로컬 백엔드
corepack pnpm prototype:dev    # 앱 개발 모드
corepack pnpm prototype:start  # unpacked 앱 빌드 후 실행
```

사용법은 [docs/usage.md](docs/usage.md), 배포 준비는 [docs/deployment.md](docs/deployment.md)를 확인하세요.

## 검증

```bash
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm exec vitest run scripts/deploymentAssets.test.ts scripts/deploymentPreflight.test.ts scripts/backupSchedule.test.ts
```

PostgreSQL 통합 테스트는 별도 폐기 가능한 DB의 `TEST_DATABASE_URL`을 지정하고 `corepack pnpm --filter @meeting-stt/api test:integration`으로 실행합니다. 이 테스트는 대상 DB의 public 스키마를 초기화하므로 운영 DB를 지정하면 안 됩니다.

외부 구성 요소의 고지는 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)를 참고하세요.
