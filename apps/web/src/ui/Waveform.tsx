import { useEffect, useRef } from 'react'

interface WaveformProps {
  peaks: Float32Array
}

const CANVAS_HEIGHT = 72

/** 파형은 DOM이 아니라 캔버스라 외부 시스템 동기화로 useEffect를 쓴다 */
export default function Waveform({ peaks }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const context = canvas.getContext('2d')
    if (!context) return

    const { width, height } = canvas
    context.clearRect(0, 0, width, height)
    // 캔버스는 CSS 변수를 모르므로 토큰 값을 계산된 스타일에서 읽는다
    context.fillStyle = getComputedStyle(canvas).getPropertyValue('--color-text').trim()

    const middle = height / 2
    for (let x = 0; x < peaks.length; x += 1) {
      const barHeight = Math.max(1, peaks[x] * middle)
      context.fillRect(x, middle - barHeight, 1, barHeight * 2)
    }
  }, [peaks])

  return <canvas ref={canvasRef} width={peaks.length} height={CANVAS_HEIGHT} className="waveform" />
}
