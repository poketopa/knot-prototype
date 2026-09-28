import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { fail, info } from './log'
import { AUDIO_DIR, FIXTURES_DIR } from './paths'
import { run } from './shell'
import { durationSecOf, pitchShiftPcm, readPcm, silencePcm, writeWav } from './wav'

// macOS 기본 설치 한국어 음성은 Yuna 하나뿐이라, 피치를 바꿔 화자를 나눈다.
// 합성 음성이므로 품질·화자 분리 정확도 판단에는 쓰지 않는다 (배관 검증 전용).
const BASE_VOICE = 'Yuna'
const PITCH_RATIOS = [1, 0.84, 1.18] as const
const SPEAKER_NAMES = ['진행자', '개발', '디자인'] as const
const GAP_SEC = 0.45
const LEAD_SILENCE_SEC = 0.8
const SPEECH_RATE_WPM = 190

interface Turn {
  speakerIndex: number
  text: string
}

const SCRIPT: Turn[] = [
  { speakerIndex: 0, text: '자, 그럼 주간 회의 시작하겠습니다. 오늘 안건은 세 가지입니다.' },
  { speakerIndex: 0, text: '첫째 배포 일정, 둘째 검색 성능 이슈, 셋째 디자인 시스템 정리입니다.' },
  { speakerIndex: 1, text: '배포 일정부터 말씀드리면, 목요일 오후 여섯 시로 잡고 있습니다.' },
  { speakerIndex: 1, text: '다만 큐에이에서 결제 모듈 이슈가 하나 남아 있어서 확답은 어렵습니다.' },
  { speakerIndex: 0, text: '그 이슈는 언제쯤 정리될 것 같으신가요?' },
  { speakerIndex: 1, text: '재현이 간헐적이라 원인 파악에 하루 정도 더 필요할 것 같습니다.' },
  { speakerIndex: 2, text: '그럼 디자인 쪽 리소스 전달도 목요일 기준으로 맞추면 될까요?' },
  { speakerIndex: 0, text: '네, 일단 목요일 기준으로 두고 수요일에 다시 확인하시죠.' },
  { speakerIndex: 0, text: '두 번째 안건, 검색 성능 이슈로 넘어가겠습니다.' },
  { speakerIndex: 1, text: '검색 응답 시간이 평균 팔백 밀리초까지 올라갔습니다.' },
  { speakerIndex: 1, text: '인덱스가 커지면서 필터 조건이 많은 쿼리에서 특히 느립니다.' },
  { speakerIndex: 0, text: '사용자 체감으로는 어느 정도 수준인가요?' },
  { speakerIndex: 2, text: '사용성 테스트에서 세 분 중 두 분이 느리다고 말씀하셨습니다.' },
  { speakerIndex: 1, text: '캐시 레이어를 하나 두면 삼백 밀리초 밑으로 내릴 수 있을 것 같습니다.' },
  { speakerIndex: 0, text: '좋습니다. 그건 다음 스프린트 최우선으로 잡겠습니다.' },
  { speakerIndex: 2, text: '마지막으로 디자인 시스템 정리 건입니다.' },
  { speakerIndex: 2, text: '버튼과 입력 필드 컴포넌트가 화면마다 조금씩 다르게 쓰이고 있습니다.' },
  { speakerIndex: 2, text: '토큰을 먼저 정리하고 컴포넌트를 다시 맞추는 방향으로 제안드립니다.' },
  { speakerIndex: 1, text: '개발 쪽에서도 동의합니다. 다만 한 번에 다 바꾸면 위험합니다.' },
  { speakerIndex: 1, text: '신규 화면부터 적용하고 기존 화면은 점진적으로 옮기는 게 안전합니다.' },
  { speakerIndex: 0, text: '그렇게 진행하시죠. 그럼 오늘 정리하겠습니다.' },
  {
    speakerIndex: 0,
    text: '배포는 수요일 재확인, 검색 캐시는 다음 스프린트, 디자인 토큰은 신규 화면부터.'
  },
  { speakerIndex: 2, text: '네, 확인했습니다.' },
  { speakerIndex: 1, text: '알겠습니다. 수요일에 이슈 상태 공유드리겠습니다.' },
  { speakerIndex: 0, text: '수고하셨습니다. 회의 마치겠습니다.' }
]

const synthesizeTurn = async ({
  turn,
  index,
  tmpDir
}: {
  turn: Turn
  index: number
  tmpDir: string
}) => {
  const outPath = path.join(tmpDir, `turn-${String(index).padStart(3, '0')}.wav`)
  const result = await run({
    command: 'say',
    args: [
      '-v',
      BASE_VOICE,
      '-r',
      String(SPEECH_RATE_WPM),
      '--file-format=WAVE',
      '--data-format=LEI16@16000',
      '-o',
      outPath,
      turn.text
    ]
  })

  if (result.code !== 0) throw new Error(`say 실행 실패 (${result.code}): ${result.stderr}`)

  const pcm = await readPcm(outPath)
  return pitchShiftPcm({ pcm, ratio: PITCH_RATIOS[turn.speakerIndex] })
}

const main = async () => {
  if (process.platform !== 'darwin') {
    fail('합성 픽스처는 macOS의 say 명령이 필요합니다')
  }

  const tmpDir = path.join(FIXTURES_DIR, 'tmp-say')
  await rm(tmpDir, { recursive: true, force: true })
  await mkdir(tmpDir, { recursive: true })
  await mkdir(AUDIO_DIR, { recursive: true })

  const gap = silencePcm({ seconds: GAP_SEC })
  const chunks: Buffer[] = [silencePcm({ seconds: LEAD_SILENCE_SEC })]
  const expected: { speaker: string; startSec: number; endSec: number; text: string }[] = []
  let cursorSec = LEAD_SILENCE_SEC

  for (const [index, turn] of SCRIPT.entries()) {
    const pcm = await synthesizeTurn({ turn, index, tmpDir })
    const seconds = durationSecOf({ pcmBytes: pcm.length })

    expected.push({
      speaker: SPEAKER_NAMES[turn.speakerIndex],
      startSec: Number(cursorSec.toFixed(3)),
      endSec: Number((cursorSec + seconds).toFixed(3)),
      text: turn.text
    })

    chunks.push(pcm, gap)
    cursorSec += seconds + GAP_SEC
    info(
      `· ${index + 1}/${SCRIPT.length} ${SPEAKER_NAMES[turn.speakerIndex]} (${seconds.toFixed(1)}초)`
    )
  }

  const wavPath = path.join(AUDIO_DIR, 'synthetic-meeting.wav')
  await writeWav({ filePath: wavPath, pcm: Buffer.concat(chunks) })

  // 파이프라인 결과와 눈으로 비교할 정답지
  const answerPath = path.join(AUDIO_DIR, 'synthetic-meeting.expected.json')
  await writeFile(answerPath, `${JSON.stringify(expected, null, 2)}\n`, 'utf-8')

  await rm(tmpDir, { recursive: true, force: true })
  info(`합성 회의 WAV 생성: ${wavPath} (${cursorSec.toFixed(1)}초, 화자 ${PITCH_RATIOS.length}명)`)
  info(`정답지: ${answerPath}`)
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error))
})
