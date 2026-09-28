# Knot 프로토타입 로컬 DB 백업 timer

이 systemd 자산은 EC2 호스트의 `/opt/knot-prototype`에서 `deploy/prototype/backup-postgres.sh`를 하루 한 번 실행한다. 실행 시각은 한국 시간 03:00이며 `OnCalendar`에는 UTC 기준 `18:00`으로 적었다.

이 timer는 로컬 PostgreSQL dump만 만든다. S3 업로드, 원격 백업 완료, 오래된 백업 삭제, DB 복구를 수행하지 않는다. 원격 백업이 준비됐다고 해석하면 안 된다.

## 활성화 전 조건

1. `/opt/knot-prototype` 배포 디렉터리가 있다.
2. Docker Compose 스택과 PostgreSQL 컨테이너가 정상이다.
3. 사람이 수동으로 백업을 한 번 실행하고 checksum 검증까지 확인했다.

```bash
cd /opt/knot-prototype
./deploy/prototype/backup-postgres.sh
cd var/prototype-backups
sha256sum -c <생성된 dump.sha256 파일명>
```

위 검증 전에는 timer를 enable하지 않는 것을 권장한다.

## 설치와 확인

```bash
sudo install -m 0644 deploy/prototype/systemd/knot-prototype-backup.service /etc/systemd/system/knot-prototype-backup.service
sudo install -m 0644 deploy/prototype/systemd/knot-prototype-backup.timer /etc/systemd/system/knot-prototype-backup.timer
sudo systemctl daemon-reload
sudo systemctl enable --now knot-prototype-backup.timer
systemctl list-timers knot-prototype-backup.timer
```
