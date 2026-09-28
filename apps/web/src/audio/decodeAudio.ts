/**
 * 오디오 파일 → 16kHz mono `Float32Array`.
 *
 * `decodeAudioData`는 **컨텍스트의 샘플레이트로** 디코딩한다. 그래서 16kHz `OfflineAudioContext`에
 * 디코딩을 맡기면 원본을 48kHz로 통째로 푸는 일(48kHz 스테레오 1시간 = 1.3GB)을 피할 수 있다
 * (docs/browser-prototype-plan.md §7).
 */

import { SAMPLE_RATE_HZ } from '@meeting-stt/core/audio'

export interface DecodedAudio {
  samples: Float32Array
  sampleRate: number
  durationSec: number
  sourceChannelCount: number
}

const downmixToMono = (buffer: AudioBuffer) => {
  if (buffer.numberOfChannels === 1) return new Float32Array(buffer.getChannelData(0))

  const mono = new Float32Array(buffer.length)
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel)
    for (let i = 0; i < mono.length; i += 1) mono[i] += data[i]
  }
  for (let i = 0; i < mono.length; i += 1) mono[i] /= buffer.numberOfChannels

  return mono
}

export const decodeAudioFile = async (file: File): Promise<DecodedAudio> => {
  const arrayBuffer = await file.arrayBuffer()
  const context = new OfflineAudioContext({
    numberOfChannels: 1,
    length: 1,
    sampleRate: SAMPLE_RATE_HZ
  })
  const buffer = await context.decodeAudioData(arrayBuffer)

  return {
    samples: downmixToMono(buffer),
    sampleRate: buffer.sampleRate,
    durationSec: buffer.duration,
    sourceChannelCount: buffer.numberOfChannels
  }
}
