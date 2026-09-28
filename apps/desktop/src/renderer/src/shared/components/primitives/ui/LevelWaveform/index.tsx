import styles from './index.module.css'

interface LevelWaveformProps {
  /** 0~1 입력 세기. 오래된 것부터 */
  levels: number[]
  barCount: number
  size?: 'md' | 'sm'
}

const PERCENT = 100
/** 무음에서도 막대가 점으로 보이도록 남기는 최소 높이(%) */
const MIN_BAR_PERCENT = 8
/** RMS는 말소리에서도 0.1~0.3에 머문다. 그대로 그리면 파형이 바닥에 붙는다 */
const LEVEL_GAIN = 3

const heightOf = (level: number) =>
  Math.max(MIN_BAR_PERCENT, Math.min(PERCENT, level * LEVEL_GAIN * PERCENT))

/** 파형형 레벨 미터. 모자란 칸은 오른쪽을 빈 막대로 채운다 (references/architecture.md "공통 컴포넌트") */
export default function LevelWaveform({ levels, barCount, size = 'md' }: LevelWaveformProps) {
  const recent = levels.slice(-barCount)
  const latest = recent.at(-1) ?? 0
  const bars = Array.from({ length: barCount }, (_, index) => recent[index])

  return (
    <div
      className={[styles.waveform, styles[size]].join(' ')}
      role="meter"
      aria-label="마이크 입력 세기"
      aria-valuemin={0}
      aria-valuemax={PERCENT}
      aria-valuenow={Math.round(Math.min(1, latest) * PERCENT)}
    >
      {bars.map((level, index) => (
        <span
          // 칸의 위치 자체가 정체성이다. 값이 밀려 들어와도 칸은 그대로다
          key={index}
          className={level === undefined ? styles.emptyBar : styles.bar}
          style={{ height: `${level === undefined ? MIN_BAR_PERCENT : heightOf(level)}%` }}
        />
      ))}
    </div>
  )
}
