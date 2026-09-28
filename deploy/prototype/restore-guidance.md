# 백업 업로드와 복구 검증 가이드

백업 스크립트는 로컬 파일만 만든다. AWS 업로드, DB 삭제, DB 복구를 수행하지 않는다.

## 산출물

`deploy/prototype/backup-postgres.sh`는 `<timestamp>.dump`와 `<timestamp>.dump.sha256`을 만든다. SHA-256 파일은 로컬 복사 무결성을 확인할 뿐, dump 복구 가능성을 증명하지 않는다.

## 업로드 조건

S3 prefix의 비공개 경계가 승인된 뒤에만 백업을 업로드한다.

```text
s3://your-private-bucket/knot/prototype-private/backups/
```

공개 읽기 가능성이 남아 있는 prefix에는 녹음, 전사, 요약, 백업을 업로드하지 않는다.

## 일일 로컬 백업 timer

`deploy/prototype/systemd/`에는 하루 한 번 로컬 dump를 만드는 systemd 예시가 있다. 이 timer는 S3 업로드를 하지 않고, 오래된 백업을 삭제하지 않고, 복구를 실행하지 않는다. 배포 후 첫 수동 백업과 checksum 검증이 끝난 뒤에 enable하는 것을 권장한다.

## 비파괴 복구 리허설

1. 운영 볼륨이 아닌 격리된 PostgreSQL 대상을 만든다.
2. `(cd <backup-dir> && sha256sum -c <dump>.sha256)`로 checksum을 확인한다.
3. 격리된 대상에 `pg_restore`로 dump를 복구한다.
4. 테이블 수, 주요 row 수, 대표 artifact metadata, 문서 snapshot version을 읽기 전용으로 확인한다.
5. 복구 증거를 검토하기 전까지 운영 DB는 건드리지 않는다.
