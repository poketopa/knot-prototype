import { useEffect, useRef, useState } from 'react'

import { isValidSpeakerCount } from '@meeting-stt/core/speakerCount'

import { probeEnvironment, type EnvironmentInfo } from '../../lib/environment'
import { mergeMemoryReports, startMemorySampler, type MemoryReport } from '../../lib/memory'
import { probeModelCache, type ModelCacheInfo } from '../../lib/modelCache'
import { loadAudio, type LoadedAudio } from '../../pipeline/loadAudio'
import { runPipeline, type PipelineProgress, type PipelineResult } from '../../pipeline/runPipeline'
import AudioPanel from '../../ui/AudioPanel'
import EnvironmentPanel from '../../ui/EnvironmentPanel'
import RecordPanel from '../../ui/RecordPanel'
import RunPanel, { type RunOptions } from '../../ui/RunPanel'
import TranscriptPanel from '../../ui/TranscriptPanel'

import './legacy.css'

const DEFAULT_OPTIONS: RunOptions = {
  speakerCountText: '3',
  sttDevice: 'webgpu',
  sttDtype: 'q4f16',
  whisperModel: 'large-v3-turbo',
  diarizeDevice: 'wasm'
}

const parseSpeakerCount = (text: string) => {
  const parsed = Number(text.trim())
  return text.trim() !== '' && isValidSpeakerCount(parsed) ? parsed : null
}

const toMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

export default function Test() {
  const [environment, setEnvironment] = useState<EnvironmentInfo | null>(null)
  const [modelCache, setModelCache] = useState<ModelCacheInfo | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [audio, setAudio] = useState<LoadedAudio | null>(null)
  const [isLoadingAudio, setIsLoadingAudio] = useState(false)
  const [options, setOptions] = useState<RunOptions>(DEFAULT_OPTIONS)
  const [progress, setProgress] = useState<PipelineProgress | null>(null)
  const [result, setResult] = useState<PipelineResult | null>(null)
  const [memory, setMemory] = useState<MemoryReport | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  // 실행이 끝나면 캐시가 채워져 있다. 이 값을 바꿔 캐시 조회를 다시 돌린다
  const [refreshToken, setRefreshToken] = useState(0)
  const abortRef = useRef<AbortController | null>(null)
  const speakerCount = parseSpeakerCount(options.speakerCountText)

  // 환경 확인은 브라우저 API에 묻는 외부 동기화라 마운트 때 한 번만 한다
  useEffect(() => {
    void probeEnvironment().then(setEnvironment)
  }, [])

  // 어떤 파일을 받아야 하는지는 고른 모델·dtype에 달렸다. Cache Storage에 다시 묻는다
  useEffect(() => {
    void probeModelCache({
      whisperModel: options.whisperModel,
      sttDtype: options.sttDtype
    }).then(setModelCache)
  }, [options.whisperModel, options.sttDtype, refreshToken])

  const handleSelect = async (selected: File) => {
    setFile(selected)
    setResult(null)
    setProgress(null)
    setErrorMessage(null)
    setMemory(null)
    setIsLoadingAudio(true)
    // 71분에서 가장 높은 피크는 추론이 아니라 디코딩에 있을 수 있다. 여기서부터 잰다 (계획 §6)
    const sampler = startMemorySampler('decode')

    try {
      setAudio(await loadAudio(selected))
    } catch (error) {
      setAudio(null)
      setErrorMessage(`오디오를 읽지 못했습니다: ${toMessage(error)}`)
    } finally {
      setMemory(sampler.stop())
      setIsLoadingAudio(false)
    }
  }

  const handleRun = async () => {
    if (!audio || !file || speakerCount === null) return

    setIsRunning(true)
    setResult(null)
    setErrorMessage(null)
    const controller = new AbortController()
    abortRef.current = controller
    // 첫 단계를 decode로 두면 소유권이 넘어간 뒤 다시 읽는 경우도 제 단계에 쌓인다
    const sampler = startMemorySampler('decode')

    try {
      // 앞선 실행에서 워커로 소유권이 넘어간 채 중단됐으면 배열이 비어 있다
      const ready = audio.samples.length === 0 ? await loadAudio(file) : audio
      setAudio(ready)

      const finished = await runPipeline({
        samples: ready.samples,
        sampleRate: ready.sampleRate,
        speakerCount,
        sttDevice: options.sttDevice,
        sttDtype: options.sttDtype,
        whisperModel: options.whisperModel,
        diarizeDevice: options.diarizeDevice,
        onProgress: (next) => {
          sampler.mark(next.stage)
          setProgress(next)
        },
        signal: controller.signal
      })

      setAudio({ ...ready, samples: finished.samples })
      setResult(finished)
    } catch (error) {
      setErrorMessage(toMessage(error))
    } finally {
      const runMemory = sampler.stop()
      setMemory((previous) => mergeMemoryReports({ previous, next: runMemory }))
      setIsRunning(false)
      setRefreshToken((token) => token + 1)
      abortRef.current = null
    }
  }

  return (
    <main className="app">
      <header>
        <h1>브라우저 STT 프로토타입</h1>
        <p>
          오디오를 서버로 보내지 않는다. 모델만 Hugging Face에서 받고 추론은 전부 이 탭 안에서 한다.
        </p>
      </header>

      <EnvironmentPanel environment={environment} modelCache={modelCache} />
      <RecordPanel
        isDisabled={isRunning || isLoadingAudio}
        onRecorded={(recording) => void handleSelect(recording.file)}
      />
      <AudioPanel audio={audio} isLoading={isLoadingAudio} onSelect={handleSelect} />
      <RunPanel
        options={options}
        progress={progress}
        isRunning={isRunning}
        isReady={audio !== null}
        isSpeakerCountValid={speakerCount !== null}
        errorMessage={errorMessage}
        onChange={setOptions}
        onRun={handleRun}
        onCancel={() => abortRef.current?.abort()}
      />
      {result && audio ? (
        <TranscriptPanel
          result={result}
          durationSec={audio.durationSec}
          decodeMs={audio.decodeMs}
          memory={memory}
        />
      ) : null}
    </main>
  )
}
