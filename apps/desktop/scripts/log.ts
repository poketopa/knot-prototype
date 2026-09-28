// 스크립트 전용 로거. main 프로세스의 운영 로거와는 별개다.
export const info = (message: string) => console.log(message)

export const warn = (message: string) => console.warn(`⚠︎  ${message}`)

// never 반환을 호출부에서 좁히려면 변수 자체에 타입이 붙어 있어야 한다 (TS 제어 흐름 분석 제약)
export const fail: (message: string) => never = (message) => {
  console.error(`✗  ${message}`)
  process.exit(1)
}

export const formatMb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)}MB`
