import { useEffect, useState, type ReactNode } from 'react'
import type { PrototypeAuthState } from '@shared/prototype'
import { getAuthStateApi, loginApi, onPrototypeChanged } from '@renderer/shared/api/prototype'
import styles from './index.module.css'

const loginErrorMessage = (caught: unknown) =>
  (caught instanceof Error ? caught.message : String(caught)).replace(
    /^Error invoking remote method '[^']+': (?:Error: )?/,
    ''
  )

export default function AuthGate({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<PrototypeAuthState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, setIsPending] = useState(false)
  useEffect(() => {
    let isMounted = true
    const refresh = () =>
      getAuthStateApi()
        .then((next) => {
          if (isMounted) {
            setAuth(next)
            setIsPending(false)
          }
        })
        .catch((caught: unknown) => {
          if (isMounted) setError(loginErrorMessage(caught))
        })
    void refresh()
    const unsubscribe = onPrototypeChanged(({ reason }) => {
      if (reason === 'auth') void refresh()
    })
    return () => {
      isMounted = false
      unsubscribe()
    }
  }, [])
  const login = async () => {
    setIsPending(true)
    setError(null)
    try {
      await loginApi()
    } catch (caught) {
      setError(loginErrorMessage(caught))
      setIsPending(false)
    }
  }
  if (auth?.isAuthenticated && auth.user)
    return (
      <div key={auth.user.id} className={styles.authenticated}>
        {children}
      </div>
    )
  return (
    <main className={styles.page}>
      <div className={styles.titleBar} />
      <section className={styles.card}>
        <div className={styles.logo} aria-label="Knot">
          knot<span>●</span>
        </div>
        <p className={styles.eyebrow}>회의에서 결정까지</p>
        <h1>
          대화는 흘러가도,
          <br />
          결정은 남도록.
        </h1>
        <p className={styles.description}>
          녹음하면 주제별로 정리해요.
          <br />
          확정된 결정과 아직 남은 질문을 한곳에서 확인하세요.
        </p>
        <button className={styles.login} onClick={() => void login()} disabled={isPending || !auth}>
          {isPending
            ? '브라우저에서 로그인해 주세요'
            : auth
              ? 'GitHub로 시작하기'
              : '앱을 준비하고 있어요…'}
        </button>
        {isPending && (
          <button className={styles.retry} onClick={() => void login()}>
            로그인 다시 열기
          </button>
        )}
        {(error || auth?.error) && (
          <p role="alert" className={styles.error}>
            {error || auth?.error}
          </p>
        )}
        <p className={styles.caption}>개인용 프로토타입 · 녹음과 문서는 계속 보관됩니다.</p>
      </section>
    </main>
  )
}
