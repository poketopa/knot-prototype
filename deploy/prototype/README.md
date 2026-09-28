# Knot 프로토타입 EC2 배포 자산

이 디렉터리는 EC2 배포 준비용 로컬 자산이다. AWS 리소스 생성, 파일 업로드, 기존 로컬 Docker 스택 변경을 수행하지 않는다.

## 파일

- `compose.ec2.example.yml`: Caddy 2, PostgreSQL 17, migration 서비스, ARM64 API 이미지용 Compose 예시
- `.env.prototype.production.example`: 운영 환경 변수 예시
- `deploy/prototype/Caddyfile`: Caddy reverse proxy 설정
- `deploy/prototype/backup-postgres.sh`: 로컬 PostgreSQL dump와 SHA-256 sidecar 생성
- `deploy/prototype/restore-guidance.md`: 백업 검증과 비파괴 복구 리허설 절차

## 네트워크

호스트에는 `80:80`, `443:443`만 공개한다. API는 Docker 내부 포트 `4310`, PostgreSQL은 내부 포트 `5432`로만 접근한다.

기존 프록시가 이미 80/443을 사용한다면 `caddy` 서비스를 시작하지 않는다. 기존 프록시를 Compose 네트워크에 붙이거나 `api:4310`으로 라우팅한다. PostgreSQL은 계속 내부망에 둔다.

## S3 계약

공개 예시는 `S3_BUCKET=your-private-bucket`, `S3_PREFIX=knot/prototype-private/recordings`, `S3_PRIVATE_PREFIX_CONFIRMED=false`를 사용한다. 백업은 sibling prefix인 `knot/prototype-private/backups`를 사용한다. 정적 AWS access key는 env 파일에 넣지 않는다.

## 검증

```bash
docker compose --env-file .env.prototype.production.example -f compose.ec2.example.yml config >/tmp/knot-compose.yml
corepack pnpm exec vitest run scripts/deploymentAssets.test.ts
bash -n deploy/prototype/backup-postgres.sh
```
