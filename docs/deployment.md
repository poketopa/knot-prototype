# 배포 준비 가이드

이 문서는 EC2 배포 전에 로컬에서 확인할 자산을 설명합니다. AWS 리소스 생성, DNS 변경, 파일 업로드는 자동 수행하지 않습니다.

## 도메인

preview API 도메인 예시는 `api.example.com`입니다. GitHub OAuth callback URL은 다음 형식입니다.

```text
https://api.example.com/v1/auth/github/callback
```

## 서버 구성

[compose.ec2.example.yml](../compose.ec2.example.yml)은 Caddy 2, PostgreSQL 17, Fastify API, 1회성 migration 서비스를 정의합니다. 호스트에는 80/443만 공개하고 API와 DB 포트는 Docker 내부망에 둡니다.

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
```

비공개 prefix가 확인되기 전까지 `S3_PRIVATE_PREFIX_CONFIRMED=false`를 유지합니다. 정적 AWS access key는 env 파일에 넣지 않습니다.

## 검증

```bash
docker compose --env-file .env.prototype.production.example -f compose.ec2.example.yml config >/tmp/knot-compose.yml
corepack pnpm exec vitest run scripts/deploymentAssets.test.ts scripts/backupSchedule.test.ts scripts/deploymentPreflight.test.ts
```
