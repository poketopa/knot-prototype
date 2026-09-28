import { useRef, useState } from 'react'

import type { LoadedAudio } from '../pipeline/loadAudio'
import { formatDb, formatSeconds } from '../lib/units'
import Waveform from './Waveform'

interface AudioPanelProps {
  audio: LoadedAudio | null
  isLoading: boolean
  onSelect: (file: File) => void
}

export default function AudioPanel({ audio, isLoading, onSelect }: AudioPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault()
    setIsDragging(false)
    const file = event.dataTransfer.files[0]
    if (file) onSelect(file)
  }

  return (
    <section className="panel">
      <h2>오디오</h2>
      <div
        className={isDragging ? 'dropZone dragging' : 'dropZone'}
        onDragOver={(event) => {
          event.preventDefault()
          setIsDragging(true)
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click()
        }}
      >
        {isLoading ? '디코딩 중…' : '오디오 파일을 여기에 놓거나 눌러서 고르기'}
        <input
          ref={inputRef}
          type="file"
          accept="audio/*"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) onSelect(file)
          }}
        />
      </div>

      {audio ? (
        <>
          <Waveform peaks={audio.peaks} />
          <dl className="facts">
            <dt>파일</dt>
            <dd>{audio.fileName}</dd>
            <dt>길이</dt>
            <dd>{formatSeconds(audio.durationSec)}</dd>
            <dt>원본 채널</dt>
            <dd>{audio.sourceChannelCount}</dd>
            <dt>정규화 전</dt>
            <dd>{formatDb(audio.normalize.speechRmsDb)}</dd>
            <dt>적용 게인</dt>
            <dd>{audio.normalize.gainDb.toFixed(1)} dB</dd>
            <dt>정규화 후</dt>
            <dd>{formatDb(audio.normalize.normalizedSpeechRmsDb)}</dd>
            <dt>클리핑</dt>
            <dd>{(audio.normalize.clippedRatio * 100).toFixed(3)}%</dd>
          </dl>
        </>
      ) : null}
    </section>
  )
}
