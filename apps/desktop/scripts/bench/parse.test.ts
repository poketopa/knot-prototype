import { describe, expect, it } from 'vitest'

import {
  detectWhisperBackend,
  extraWhOf,
  findLhmCpuPackageW,
  median,
  parseMacmonLine,
  parseMacTime,
  parseNvidiaSmiLine,
  statOf
} from './parse'

describe('parseMacTime', () => {
  it('바이트 단위 메모리를 MB로 바꾼다', () => {
    const stderr = [
      '       12.34 real         5.67 user         1.23 sys',
      '          1048576000  maximum resident set size',
      '          2097152000  peak memory footprint'
    ].join('\n')

    expect(parseMacTime(stderr)).toEqual({ maxRssMb: 1000, peakFootprintMb: 2000 })
  })

  it('값이 없으면 null', () => {
    expect(parseMacTime('nothing')).toEqual({ maxRssMb: null, peakFootprintMb: null })
  })
})

describe('detectWhisperBackend', () => {
  it('-ng면 Metal 로그가 있어도 cpu', () => {
    const stderr =
      'whisper_init_with_params_no_state: use gpu    = 0\nggml_metal_device_init: GPU name:   MTL0'
    expect(detectWhisperBackend(stderr)).toBe('cpu')
  })

  it('Metal 초기화가 있으면 metal', () => {
    const stderr =
      'whisper_init_with_params_no_state: use gpu    = 1\nggml_metal_device_init: GPU name:   MTL0'
    expect(detectWhisperBackend(stderr)).toBe('metal')
  })

  it('CUDA 장치를 찾았으면 cuda', () => {
    const stderr =
      'ggml_cuda_init: found 1 CUDA devices:\nwhisper_init_with_params_no_state: use gpu    = 1'
    expect(detectWhisperBackend(stderr)).toBe('cuda')
  })

  it('CUDA 장치가 0개면 cpu', () => {
    expect(detectWhisperBackend('ggml_cuda_init: found 0 CUDA devices')).toBe('cpu')
  })
})

describe('parseMacmonLine', () => {
  const line = JSON.stringify({
    all_power: 8.5,
    ane_power: 0,
    cpu_power: 6,
    gpu_power: 2.5,
    ram_power: 1.5,
    sys_power: 21.25,
    memory: { ram_usage: 2 * 1024 * 1024 * 1024, swap_usage: 512 * 1024 * 1024 },
    temp: { cpu_temp_avg: 60, gpu_temp_avg: 55 },
    timestamp: '2026-10-05T05:39:12.547330+00:00'
  })

  it('시스템·칩 전력과 메모리를 샘플로 만든다', () => {
    const samples = parseMacmonLine(line)
    const valueOf = (source: string, metric: string) =>
      samples.find((s) => s.source === source && s.metric === metric)?.value

    expect(valueOf('mac-system', 'power_w')).toBe(21.25)
    expect(valueOf('mac-soc', 'power_w')).toBe(8.5)
    expect(valueOf('mac-mem', 'ram_used_mb')).toBe(2048)
    expect(valueOf('mac-mem', 'swap_used_mb')).toBe(512)
    expect(samples[0].t).toBe(Date.UTC(2026, 9, 5, 5, 39, 12, 547))
  })

  it('sys_power가 0이면 시스템 전력을 만들지 않는다', () => {
    const samples = parseMacmonLine(JSON.stringify({ ...JSON.parse(line), sys_power: 0 }))
    expect(samples.some((s) => s.source === 'mac-system')).toBe(false)
  })

  it('JSON이 아니면 빈 배열', () => {
    expect(parseMacmonLine('Error: something')).toEqual([])
  })
})

describe('parseNvidiaSmiLine', () => {
  it('전력·VRAM·사용률·온도를 샘플로 만든다', () => {
    const samples = parseNvidiaSmiLine('2026/10/05 14:03:21.123, 45.67, 1234, 87, 61')
    expect(samples.map((s) => [s.metric, s.value])).toEqual([
      ['power_w', 45.67],
      ['vram_mb', 1234],
      ['gpu_util', 87],
      ['temp_c', 61]
    ])
    expect(samples[0].t).toBe(new Date(2026, 9, 5, 14, 3, 21, 123).getTime())
  })

  it('[N/A] 값은 건너뛴다', () => {
    const samples = parseNvidiaSmiLine('2026/10/05 14:03:21.123, [N/A], 1234, 87, 61')
    expect(samples.map((s) => s.metric)).toEqual(['vram_mb', 'gpu_util', 'temp_c'])
  })
})

describe('findLhmCpuPackageW', () => {
  it('CPU 노드 아래 Package 전력을 찾는다', () => {
    const root = {
      Text: 'Sensor',
      Children: [
        {
          Text: 'DESKTOP',
          Children: [
            {
              Text: 'NVIDIA GeForce GTX 1660 SUPER',
              ImageURL: 'images_icon/nvidia.png',
              Children: [{ Text: 'Powers', Children: [{ Text: 'GPU Package', Value: '99.0 W' }] }]
            },
            {
              Text: 'AMD Ryzen 5 3600',
              ImageURL: 'images_icon/cpu.png',
              Children: [{ Text: 'Powers', Children: [{ Text: 'Package', Value: '45,2 W' }] }]
            }
          ]
        }
      ]
    }

    expect(findLhmCpuPackageW(root)).toBe(45.2)
  })
})

describe('구간 통계', () => {
  const samples = [0, 1000, 2000, 3000].map((t, i) => ({
    t,
    source: 'mac-soc',
    metric: 'power_w',
    value: [2, 10, 20, 4][i]
  }))

  it('구간 안의 샘플만 평균낸다', () => {
    expect(statOf({ samples, source: 'mac-soc', metric: 'power_w', from: 1000, to: 2000 })).toEqual(
      {
        samples: 2,
        avg: 15,
        max: 20
      }
    )
  })

  it('추가 전력량은 (평균 − 유휴) × 시간', () => {
    expect(extraWhOf({ avgW: 15, idleW: 5, durationMs: 360_000 })).toBe(1)
  })

  it('중앙값', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 2, 3])).toBe(2.5)
    expect(median([])).toBeNull()
  })
})
