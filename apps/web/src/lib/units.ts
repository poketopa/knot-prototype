/** 화면에 숫자를 찍을 때 쓰는 단위 포맷 */

const BYTES_PER_MB = 1024 * 1024
const BYTES_PER_GB = BYTES_PER_MB * 1024
const MS_PER_SEC = 1000
const SEC_PER_MIN = 60

export const formatMb = (bytes: number) => `${(bytes / BYTES_PER_MB).toFixed(0)}MB`

export const formatGb = (bytes: number) => `${(bytes / BYTES_PER_GB).toFixed(1)}GB`

export const formatSeconds = (sec: number) => {
  const minutes = Math.floor(sec / SEC_PER_MIN)
  return minutes > 0 ? `${minutes}분 ${Math.round(sec % SEC_PER_MIN)}초` : `${sec.toFixed(1)}초`
}

export const formatElapsed = (ms: number) => formatSeconds(ms / MS_PER_SEC)

/** 실시간 대비 처리 시간 비율. 1보다 작아야 녹음 길이보다 빨리 끝난다 */
export const formatRtf = ({
  elapsedMs,
  durationSec
}: {
  elapsedMs: number
  durationSec: number
}) => (durationSec === 0 ? '—' : (elapsedMs / MS_PER_SEC / durationSec).toFixed(3))

export const formatDb = (db: number) => (Number.isFinite(db) ? `${db.toFixed(1)} dBFS` : '무음')

/** 레벨 미터가 바닥으로 보는 음량. 이보다 조용하면 막대가 비어 있다 */
const METER_FLOOR_DBFS = -60

export const rmsToDb = (rms: number) => (rms > 0 ? 20 * Math.log10(rms) : -Infinity)

/** dBFS를 0~1 막대 길이로. 선형 RMS를 그대로 쓰면 말소리 구간이 거의 붙어 보인다 */
export const dbToMeterRatio = (db: number) => {
  if (!Number.isFinite(db)) return 0

  return Math.min(1, Math.max(0, 1 - db / METER_FLOOR_DBFS))
}
