/**
 * 워커 전역에 타입을 붙이는 얇은 래퍼.
 * tsconfig가 DOM lib을 쓰고 있어 `DedicatedWorkerGlobalScope`가 없다. 캐스팅을 여기 한 곳에 모은다.
 */

interface WorkerScope {
  postMessage: (message: unknown, transfer?: Transferable[]) => void
  addEventListener: (type: 'message', listener: (event: MessageEvent) => void) => void
}

const scope = globalThis as unknown as WorkerScope

export const postToHost = <TMessage>(message: TMessage, transfer: Transferable[] = []) => {
  scope.postMessage(message, transfer)
}

export const onHostMessage = <TRequest>(handler: (request: TRequest) => void | Promise<void>) => {
  scope.addEventListener('message', (event) => {
    void handler(event.data as TRequest)
  })
}

/** 워커에서 던진 예외를 메인 스레드가 보여줄 수 있는 문자열로 */
export const toErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error)
