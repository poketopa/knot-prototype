import type { Database } from 'better-sqlite3'

/**
 * user_version 기준 순차 마이그레이션. 배열에 추가만 하고 기존 항목은 수정하지 않는다
 * (references/data-model.md).
 */
const MIGRATIONS = [
  `
  CREATE TABLE IF NOT EXISTS meetings (
    id            TEXT PRIMARY KEY,
    title         TEXT NOT NULL,
    created_at    INTEGER NOT NULL,
    duration_sec  REAL NOT NULL DEFAULT 0,
    status        TEXT NOT NULL,
    error_message TEXT,
    audio_path    TEXT,
    summary       TEXT
  );

  CREATE TABLE IF NOT EXISTS utterances (
    id            TEXT PRIMARY KEY,
    meeting_id    TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    ord           INTEGER NOT NULL,
    speaker_label TEXT NOT NULL,
    start_sec     REAL NOT NULL,
    end_sec       REAL NOT NULL,
    text          TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_utterances_meeting ON utterances(meeting_id, ord);

  CREATE TABLE IF NOT EXISTS speakers (
    meeting_id    TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    label         TEXT NOT NULL,
    display_name  TEXT,
    PRIMARY KEY (meeting_id, label)
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  // 2: 녹음 정지 시 입력한 참석자 수. 화자 분리의 num-clusters가 된다 (references/data-model.md)
  'ALTER TABLE meetings ADD COLUMN speaker_count INTEGER;',
  // 3: Knot prototype 로그인 사용자 경계, 산출물 보존, durable outbox.
  `
  ALTER TABLE meetings ADD COLUMN owner_id TEXT;
  CREATE INDEX IF NOT EXISTS idx_meetings_owner_created ON meetings(owner_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS prototype_artifacts (
    id             TEXT PRIMARY KEY,
    owner_id       TEXT NOT NULL,
    recording_id   TEXT NOT NULL,
    kind           TEXT NOT NULL,
    local_path     TEXT,
    content_json   TEXT,
    sha256         TEXT NOT NULL,
    byte_length    INTEGER NOT NULL,
    provider       TEXT,
    model          TEXT,
    prompt_version TEXT,
    sync_status    TEXT NOT NULL,
    created_at     INTEGER NOT NULL,
    UNIQUE(owner_id, id),
    UNIQUE(owner_id, recording_id, kind, sha256)
  );
  CREATE INDEX IF NOT EXISTS idx_prototype_artifacts_owner_recording
    ON prototype_artifacts(owner_id, recording_id, kind);

  CREATE TABLE IF NOT EXISTS prototype_outbox (
    id            TEXT PRIMARY KEY,
    owner_id      TEXT NOT NULL,
    kind          TEXT NOT NULL,
    payload_json  TEXT NOT NULL,
    status        TEXT NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error    TEXT,
    next_retry_at INTEGER NOT NULL DEFAULT 0,
    created_at    INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_prototype_outbox_owner_status
    ON prototype_outbox(owner_id, status, next_retry_at, created_at);

  CREATE TABLE IF NOT EXISTS prototype_documents (
    id             TEXT NOT NULL,
    owner_id       TEXT NOT NULL,
    title          TEXT NOT NULL,
    latest_version INTEGER NOT NULL,
    body           TEXT NOT NULL,
    contributions  TEXT NOT NULL,
    overview       TEXT,
    updated_at     TEXT NOT NULL,
    PRIMARY KEY(owner_id, id)
  );

  CREATE TABLE IF NOT EXISTS prototype_events (
    id           TEXT PRIMARY KEY,
    owner_id     TEXT NOT NULL,
    event_type   TEXT NOT NULL,
    occurred_at  TEXT NOT NULL,
    recording_id TEXT,
    document_id  TEXT,
    version      INTEGER,
    stage        TEXT,
    attempt_id   TEXT,
    duration_ms  INTEGER,
    error_code   TEXT,
    payload_json TEXT NOT NULL,
    sync_status  TEXT NOT NULL,
    created_at   INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_prototype_events_owner_type
    ON prototype_events(owner_id, event_type, occurred_at);

  CREATE TABLE IF NOT EXISTS prototype_jobs (
    id                 TEXT PRIMARY KEY,
    owner_id           TEXT NOT NULL,
    recording_id       TEXT NOT NULL,
    kind               TEXT NOT NULL,
    status             TEXT NOT NULL,
    stage              TEXT NOT NULL,
    attempt_count      INTEGER NOT NULL DEFAULT 0,
    last_error         TEXT,
    next_retry_at      INTEGER NOT NULL DEFAULT 0,
    input_artifact_id  TEXT,
    output_artifact_id TEXT,
    created_at         INTEGER NOT NULL,
    updated_at         INTEGER NOT NULL,
    UNIQUE(owner_id, recording_id, kind)
  );
  CREATE INDEX IF NOT EXISTS idx_prototype_jobs_owner_status
    ON prototype_jobs(owner_id, status, next_retry_at, created_at);
  `,
  // 4: 회의별 문서 캐시. 누적 문서의 기존 캐시는 전환 근거로 그대로 보존한다.
  `
  CREATE TABLE IF NOT EXISTS prototype_document_tree (
    id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    title TEXT NOT NULL,
    domain TEXT NOT NULL,
    recording_id TEXT NOT NULL,
    recording_started_at TEXT NOT NULL,
    latest_version INTEGER NOT NULL,
    overview TEXT,
    detail_json TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(owner_id, id)
  );
  CREATE INDEX IF NOT EXISTS idx_document_tree_recording
    ON prototype_document_tree(owner_id, recording_id);
  `,
  // 5: 목록만 내려받은 문서도 오프라인에서 회의 길이를 표시한다.
  `ALTER TABLE prototype_document_tree ADD COLUMN duration_sec REAL;`,
  // 6: A/B 입력과 배치·선택을 재시작 후에도 유지한다.
  `CREATE TABLE prototype_summary_comparisons (
    owner_id TEXT NOT NULL,
    recording_id TEXT NOT NULL,
    transcript_artifact_id TEXT NOT NULL,
    input_json TEXT NOT NULL,
    first_variant TEXT NOT NULL CHECK(first_variant IN ('A','B')),
    analysis_a_id TEXT,
    analysis_b_id TEXT,
    comparison_artifact_id TEXT,
    selection_json TEXT,
    created_at INTEGER NOT NULL,
    PRIMARY KEY(owner_id, recording_id)
  );`
]

export const migrate = (db: Database) => {
  const current = db.pragma('user_version', { simple: true }) as number

  MIGRATIONS.slice(current).forEach((sql, index) => {
    db.exec(sql)
    db.pragma(`user_version = ${current + index + 1}`)
  })
}
