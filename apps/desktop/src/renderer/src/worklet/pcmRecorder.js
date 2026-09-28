/**
 * 마이크 입력을 Float32 PCM 청크로 모아 renderer로 넘기는 AudioWorkletProcessor.
 * 워크릿은 번들과 분리된 스코프에서 돌아 import를 쓸 수 없으므로,
 * 청크 크기는 processorOptions로 받아 상수가 두 곳에 생기지 않게 한다.
 * 청크는 ArrayBuffer 그대로 넘겨(전송 소유권 이전) renderer가 IPC로 그대로 흘려보낼 수 있게 한다.
 */
class PcmRecorderProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    this.chunkSamples = options.processorOptions.chunkSamples
    this.buffer = new Float32Array(this.chunkSamples)
    this.offset = 0
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (!channel) return true

    for (let i = 0; i < channel.length; i += 1) {
      this.buffer[this.offset] = channel[i]
      this.offset += 1

      if (this.offset === this.chunkSamples) {
        const chunk = this.buffer.slice(0)
        this.port.postMessage(chunk.buffer, [chunk.buffer])
        this.offset = 0
      }
    }

    return true
  }
}

registerProcessor('pcmRecorder', PcmRecorderProcessor)
