import { useState } from 'react'

import { formatTimestamp, formatTranscript, resolveSpeakerNames } from '@meeting-stt/core/format'
import { stagePeakEntries, type MemoryReport } from '../lib/memory'
import { STAGE_LABELS } from '../lib/stageLabels'
import { formatElapsed, formatMb, formatRtf, formatSeconds } from '../lib/units'
import type { PipelineResult } from '../pipeline/runPipeline'
import Button from '../components/Button'
import Icon from '../components/Icon'

interface TranscriptPanelProps {
  result: PipelineResult
  durationSec: number
  decodeMs: number
  memory: MemoryReport | null
}

/** 화자 색 토큰 개수. 9번째 화자부터 1번 색을 다시 쓴다 (architecture.md "디자인 토큰") */
const SPEAKER_COLOR_COUNT = 8

const speakerColorOf = (index: number) =>
  `var(--color-speaker-${(index % SPEAKER_COLOR_COUNT) + 1})`

/** 단계별 최고값을 한 줄로. 재지 못한 단계는 빠진다 */
const formatStagePeaks = (memory: MemoryReport) =>
  stagePeakEntries(memory)
    .map(({ stage, bytes }) => `${STAGE_LABELS[stage]} ${formatMb(bytes)}`)
    .join(' · ')

export default function TranscriptPanel({
  result,
  durationSec,
  decodeMs,
  memory
}: TranscriptPanelProps) {
  const [isCopied, setIsCopied] = useState(false)

  const names = resolveSpeakerNames({
    labels: result.utterances.map((utterance) => utterance.speakerLabel)
  })
  const speakerOrder = Object.keys(names)
  const totalMs =
    decodeMs + result.timings.diarizeMs + result.timings.sttMs + result.timings.mergeMs
  const characterCount = result.utterances.reduce(
    (total, utterance) => total + utterance.text.length,
    0
  )
  const isMeasured = memory !== null && memory.sampleCount > 0

  const handleCopy = async () => {
    await navigator.clipboard.writeText(formatTranscript({ utterances: result.utterances }))
    setIsCopied(true)
  }

  return (
    <section className="panel">
      <h2>결과</h2>

      <table className="measurements">
        <tbody>
          <tr>
            <th>오디오 길이</th>
            <td>{formatSeconds(durationSec)}</td>
            <th>발화 길이 (VAD)</th>
            <td>{formatSeconds(result.speechSec)}</td>
          </tr>
          <tr>
            <th>디코딩 + 정규화</th>
            <td>{formatElapsed(decodeMs)}</td>
            <th>VAD</th>
            <td>{formatElapsed(result.timings.vadMs)}</td>
          </tr>
          <tr>
            <th>화자 분리</th>
            <td>
              {formatElapsed(result.timings.diarizeMs)} (RTF{' '}
              {formatRtf({ elapsedMs: result.timings.diarizeMs, durationSec })})
            </td>
            <th>음성 인식 (VAD 포함)</th>
            <td>
              {formatElapsed(result.timings.sttMs)} (RTF{' '}
              {formatRtf({ elapsedMs: result.timings.sttMs, durationSec })})
            </td>
          </tr>
          <tr>
            <th>전체</th>
            <td>
              {formatElapsed(totalMs)} (RTF {formatRtf({ elapsedMs: totalMs, durationSec })})
            </td>
            <th>병합</th>
            <td>{formatElapsed(result.timings.mergeMs)}</td>
          </tr>
          <tr>
            <th>화자 수</th>
            <td>{Object.keys(names).length}</td>
            <th>임베딩 / 화자 구간</th>
            <td>
              {result.embeddingCount} / {result.speakerSegments.length}
            </td>
          </tr>
          <tr>
            <th>발화 수</th>
            <td>{result.utterances.length}</td>
            <th>글자 수</th>
            <td>{characterCount}</td>
          </tr>
          <tr>
            <th>피크 메모리</th>
            <td>
              {isMeasured
                ? `${formatMb(memory.peakBytes)} (워커 ${formatMb(memory.peakWorkerBytes)})`
                : '측정 불가'}
            </td>
            <th>단계별 피크</th>
            <td>{isMeasured ? formatStagePeaks(memory) : '—'}</td>
          </tr>
        </tbody>
      </table>

      <p className="hint">
        {isMeasured
          ? `메모리는 JS 쪽만 센 하한선이다 (샘플 ${memory.sampleCount}회). WASM 힙·WebGPU 버퍼는 빠질 수 있어 Chrome 작업 관리자와 같이 본다.`
          : '메모리를 재지 못했다. crossOriginIsolated가 아니거나 브라우저가 measureUserAgentSpecificMemory를 지원하지 않는다.'}
      </p>

      <div className="actions">
        <Button variant="secondary" onClick={handleCopy}>
          <Icon name="copy" />
          회의록 복사
        </Button>
        {isCopied ? <span className="hint">복사했다</span> : null}
      </div>

      <ol className="transcript">
        {result.utterances.map((utterance) => (
          <li key={utterance.ord}>
            <span className="time">{formatTimestamp({ sec: utterance.startSec })}</span>
            <div className="utteranceBody">
              <span
                className="speaker"
                style={{ color: speakerColorOf(speakerOrder.indexOf(utterance.speakerLabel)) }}
              >
                <span className="speakerDot" aria-hidden="true" />
                {names[utterance.speakerLabel]}
              </span>
              <p className="text">{utterance.text}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
