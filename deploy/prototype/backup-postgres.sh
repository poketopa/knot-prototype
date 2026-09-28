#!/usr/bin/env sh
set -eu
umask 077

COMPOSE_FILE=${COMPOSE_FILE:-compose.ec2.example.yml}
COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME:-knot-prototype-ec2}
ENV_FILE=${ENV_FILE:-.env.prototype.production}
BACKUP_DIR=${BACKUP_DIR:-./var/prototype-backups}
POSTGRES_SERVICE_NAME=${POSTGRES_SERVICE_NAME:-postgres}
BACKUP_DB_NAME=${BACKUP_DB_NAME:-knot_prototype}
BACKUP_DB_USER=${BACKUP_DB_USER:-knot_migrator}
BACKUP_TIMESTAMP=${BACKUP_TIMESTAMP:-$(date -u +%Y%m%dT%H%M%SZ)}

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing env file: $ENV_FILE" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

reserve_backup_slot() {
  suffix=0
  while :; do
    if [ "$suffix" -eq 0 ]; then
      base_name="knot-prototype-postgres-$BACKUP_TIMESTAMP"
    else
      base_name="knot-prototype-postgres-$BACKUP_TIMESTAMP-$suffix"
    fi
    backup_path="$BACKUP_DIR/$base_name.dump"
    hash_path="$backup_path.sha256"
    reserve_dir="$BACKUP_DIR/.$base_name.reserve"

    if mkdir "$reserve_dir" 2>/dev/null; then
      if [ ! -e "$backup_path" ] && [ ! -e "$hash_path" ]; then
        return 0
      fi
      rmdir "$reserve_dir"
    fi

    suffix=$((suffix + 1))
    if [ "$suffix" -ge 1000 ]; then
      echo 'Could not reserve a unique backup path; check directory permissions.' >&2
      exit 1
    fi
  done
}

reserve_backup_slot
partial_path="$reserve_dir/$base_name.dump.partial"
partial_hash_path="$reserve_dir/$base_name.dump.sha256.partial"

cleanup() {
  rm -rf "$reserve_dir"
}
trap cleanup EXIT INT TERM

# pg_dump writes the dump to stdout; redirect it directly to a reserved partial file so secrets are never printed.
docker compose \
  --env-file "$ENV_FILE" \
  -p "$COMPOSE_PROJECT_NAME" \
  -f "$COMPOSE_FILE" \
  exec -T "$POSTGRES_SERVICE_NAME" \
  pg_dump --format=custom --no-owner --no-privileges --username="$BACKUP_DB_USER" "$BACKUP_DB_NAME" \
  >"$partial_path"

(
  cd "$reserve_dir"
  sha256sum "$(basename "$partial_path")" >"$(basename "$partial_hash_path")"
)

mv "$partial_path" "$backup_path"
(
  cd "$BACKUP_DIR"
  sed "s|$(basename "$partial_path")|$(basename "$backup_path")|" "$reserve_dir/$(basename "$partial_hash_path")" >"$(basename "$hash_path")"
)
rm -rf "$reserve_dir"
trap - EXIT INT TERM

printf 'Created backup: %s\n' "$backup_path"
printf 'Created hash: %s\n' "$hash_path"
printf 'Verify locally with: (cd %s && sha256sum -c %s)\n' "$BACKUP_DIR" "$(basename "$hash_path")"
printf 'No upload or restore was performed. Review deploy/prototype/restore-guidance.md before copying this backup elsewhere.\n'
