/** 화자 색 토큰 개수. 9번째 화자부터 1번 색을 다시 쓴다 (architecture.md "디자인 토큰") */
const SPEAKER_COLOR_COUNT = 8

export const speakerColorOf = (index: number) =>
  `var(--color-speaker-${(index % SPEAKER_COLOR_COUNT) + 1})`
