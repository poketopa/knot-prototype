# Knot 프로토타입 EC2 배포 자산

이 디렉터리는 EC2 배포 준비용 로컬 자산이다. AWS 리소스 생성, 파일 업로드, 기존 로컬 Docker 스택 변경을 수행하지 않는다.

## 파일

- `compose.ec2.example.yml`: Caddy 2, PostgreSQL 17, migration 서비스, ARM64 API 이미지용 Compose 예시
- `compose.ec2.host-proxy.yml`: 기존 호스트 Nginx가 80/443을 처리할 때 쓰는 Compose 예시
- `.env.prototype.production.example`: 운영 환경 변수 예시
- `deploy/prototype/Caddyfile`: Caddy reverse proxy 설정
- `deploy/prototype/backup-postgres.sh`: 로컬 PostgreSQL dump와 SHA-256 sidecar 생성
- `deploy/prototype/restore-guidance.md`: 백업 검증과 비파괴 복구 리허설 절차

## 네트워크

호스트에는 `80:80`, `443:443`만 공개한다. API는 Docker 내부 포트 `4310`, PostgreSQL은 내부 포트 `5432`로만 접근한다.

기존 호스트 Nginx가 이미 80/443을 사용한다면 `compose.ec2.host-proxy.yml`을 사용한다. 이 구성은 Caddy를 띄우지 않고 API만 `127.0.0.1:4310`에 공개한다. PostgreSQL은 계속 내부망에 둔다.

Nginx에는 업로드 크기와 긴 전사 요청을 고려해 `client_max_body_size 1024m`, `proxy_read_timeout 3600s`, `proxy_send_timeout 3600s`, `proxy_connect_timeout 60s`를 둔다. upstream은 `http://127.0.0.1:4310`으로 둔다.

host-proxy 구성에서 백업 스크립트를 실행할 때는 같은 Compose 파일을 지정한다.

```bash
COMPOSE_FILE=compose.ec2.host-proxy.yml ./deploy/prototype/backup-postgres.sh
```

## S3 계약

공개 예시는 `S3_BUCKET=your-private-bucket`, `S3_PREFIX=knot/prototype-private/recordings`, `S3_PRIVATE_PREFIX_CONFIRMED=false`, `S3_PUBLIC_READ_ACKNOWLEDGED=false`를 사용한다. 비공개 prefix가 확인되면 `S3_PRIVATE_PREFIX_CONFIRMED=true`를 사용하고, 프로토타입 검증을 위해 녹음 파일, 전사 원본, AI 정리본의 공개 읽기를 허용할 때만 `S3_PUBLIC_READ_ACKNOWLEDGED=true`를 사용한다. DB 백업, OAuth secret, DB 비밀번호는 공개 prefix에 두지 않는다. 정적 AWS access key는 env 파일에 넣지 않는다.

## 검증

```bash
docker compose --env-file .env.prototype.production.example -f compose.ec2.example.yml config >/tmp/knot-compose.yml
docker compose --env-file .env.prototype.production.example -f compose.ec2.host-proxy.yml config >/tmp/knot-compose-host-proxy.yml
node deploy/prototype/preflight.mjs --env-file .env.prototype.production.example --compose-file compose.ec2.host-proxy.yml
corepack pnpm exec vitest run scripts/deploymentAssets.test.ts
bash -n deploy/prototype/backup-postgres.sh
```
