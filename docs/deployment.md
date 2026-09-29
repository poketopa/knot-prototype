# 배포 준비 가이드

이 문서는 EC2 배포 전에 로컬에서 확인할 자산을 설명합니다. AWS 리소스 생성, DNS 변경, 파일 업로드는 자동 수행하지 않습니다.

## 도메인

preview API 도메인 예시는 `api.example.com`입니다. GitHub OAuth callback URL은 다음 형식입니다.

```text
https://api.example.com/v1/auth/github/callback
```

## 서버 구성

[compose.ec2.example.yml](../compose.ec2.example.yml)은 Caddy 2, PostgreSQL 17, Fastify API, 1회성 migration 서비스를 정의합니다. 호스트에는 80/443만 공개하고 API와 DB 포트는 Docker 내부망에 둡니다.

기존 호스트 Nginx가 80/443을 이미 사용한다면 [compose.ec2.host-proxy.yml](../compose.ec2.host-proxy.yml)을 사용합니다. 이 파일은 Caddy를 띄우지 않고 API만 `127.0.0.1:4310`에 공개합니다. PostgreSQL은 호스트 포트를 열지 않습니다.

```nginx
server {
    listen 443 ssl;
    server_name <api-domain>;

    client_max_body_size 1024m;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    proxy_connect_timeout 60s;

    location / {
        proxy_pass http://127.0.0.1:4310;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }
}
```

## 환경 파일

```bash
cp .env.prototype.production.example .env.prototype.production
```

공개 문서의 S3 예시는 다음 값을 사용합니다.

```env
STORAGE_DRIVER=s3
AWS_REGION=ap-northeast-2
S3_BUCKET=your-private-bucket
S3_PREFIX=knot/prototype-private/recordings
S3_PRIVATE_PREFIX_CONFIRMED=false
S3_PUBLIC_READ_ACKNOWLEDGED=false
```

비공개 prefix가 확인되기 전까지 `S3_PRIVATE_PREFIX_CONFIRMED=false`를 유지합니다. 프로토타입 검증을 위해 녹음 파일, 전사 원본, AI 정리본이 공개 읽기 가능해도 되는 경우에만 `S3_PUBLIC_READ_ACKNOWLEDGED=true`로 바꿉니다. DB 백업, OAuth secret, DB 비밀번호는 공개 prefix에 두지 않습니다. 정적 AWS access key는 env 파일에 넣지 않습니다.

## 검증

```bash
docker compose --env-file .env.prototype.production.example -f compose.ec2.example.yml config >/tmp/knot-compose.yml
docker compose --env-file .env.prototype.production.example -f compose.ec2.host-proxy.yml config >/tmp/knot-compose-host-proxy.yml
node deploy/prototype/preflight.mjs --env-file .env.prototype.production.example --compose-file compose.ec2.host-proxy.yml
corepack pnpm exec vitest run scripts/deploymentAssets.test.ts scripts/backupSchedule.test.ts scripts/deploymentPreflight.test.ts
```

host-proxy 배포에서 로컬 DB 백업을 실행할 때는 같은 compose 파일을 지정합니다.

```bash
COMPOSE_FILE=compose.ec2.host-proxy.yml ./deploy/prototype/backup-postgres.sh
```

## macOS 배포 파일 검증

다운로드한 앱의 실행 가능 여부는 DMG 체크섬이나 로컬 Electron 실행만으로 확인할 수 없습니다. 배포용 빌드는 Developer ID 서명, Apple 공증 티켓, Gatekeeper 검사를 모두 통과해야 합니다.

Developer ID Application 인증서를 Mac 키체인에 설치하고, 공증 인증정보를 별도 키체인 프로필에 저장합니다. 앱 암호는 명령 인자에 적지 않고 `notarytool`의 비공개 입력창에 입력합니다.

```bash
xcrun notarytool store-credentials knot-prototype-notary --apple-id '<Apple Developer 계정>' --team-id '<Team ID>'
```

실제 API 주소와 공증 프로필을 지정해 빌드합니다.

```bash
APPLE_KEYCHAIN_PROFILE=knot-prototype-notary \
KNOT_BUILD_API_BASE_URL=https://api.example.com/v1 \
corepack pnpm build:mac:release
```

`build:mac:release`는 코드 서명을 필수로 요구하고, 빌드 후 `codesign`, `stapler`, `spctl`을 실행합니다. 하나라도 실패하면 릴리스 파일을 게시하지 않습니다. `release:mac`도 검증된 파일을 준비하는 명령이며, GitHub 업로드는 검증 완료 후 별도로 수행합니다. 앱 내 업데이트에는 DMG 외에 빌드가 만든 macOS ZIP과 업데이트 메타데이터(`latest-mac.yml` 또는 해당 preview 채널의 YAML)도 같은 GitHub 릴리스에 첨부해야 합니다. 릴리스 태그와 앱 버전이 일치해야 합니다.

기존 앱 파일만 검사하려면 저장소 루트에서 실행합니다.

```bash
node apps/desktop/scripts/verifyMacRelease.mjs '/absolute/path/Knot Meeting Prototype.app'
```

`v0.3.0-preview.2`에서 확인된 `code has no resources but signature indicates they must be present` 오류는 이 검사에서 실패합니다. 서명 검사에 실패한 앱은 인증서로 다시 빌드해야 합니다.
