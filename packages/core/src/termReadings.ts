/**
 * 사람이 검수한 개발·제품 용어의 한글 읽기 사전 (Phase 5-4).
 *
 * 용어 초안을 만드는 4B 모델은 약어·`.js` 밖의 단어 읽기를 자주 틀린다(Jira=재자, Git=기트, Redux=레덕스,
 * Tailwind=타일윈드, ESLint=엔엘식). 프롬프트로는 못 고쳐서 여기 있는 용어는 모델 읽기 대신 이 읽기를 쓴다
 * (`references/architecture.md` "용어 사전", `docs/phase5-refine-results.md` "초안 품질 보강").
 *
 * 규칙:
 * - 한국 회의에서 영어 이름 그대로 부르는 도구·제품·언어·프레임워크·서비스 이름과 개발·제품 관용어만 둔다.
 *   번역어로 부르는 말(배포, 검색)은 넣지 않는다.
 * - 읽기는 실제로 부르는 소리 하나. 흔한 변형이 있으면 쉼표로 2개까지 (`용어 = 읽기1, 읽기2` 저장 형식과 같다).
 * - 키는 정식 표기다. 찾기는 대소문자를 무시하고, 맞으면 표기도 이 키로 맞춘다.
 * - 이 사전은 읽기만 바꾸고 용어를 더하지 않는다. 고정 용어 목록이 아니다.
 */
export const TERM_READINGS: Readonly<Record<string, string>> = {
  // 형상 관리·협업 도구
  Git: '깃',
  GitHub: '깃허브',
  GitLab: '깃랩',
  Bitbucket: '비트버킷',
  Jira: '지라',
  Confluence: '컨플루언스',
  Slack: '슬랙',
  Notion: '노션',
  Figma: '피그마',
  Zeplin: '제플린',
  Trello: '트렐로',
  Asana: '아사나',
  Linear: '리니어',
  Miro: '미로',

  // 언어
  JavaScript: '자바스크립트',
  TypeScript: '타입스크립트',
  Python: '파이썬',
  Java: '자바',
  Kotlin: '코틀린',
  Swift: '스위프트',
  Rust: '러스트',
  Golang: '고랭',
  Dart: '다트',
  Ruby: '루비',
  SQL: '에스큐엘, 시퀄',

  // 프론트엔드
  React: '리액트',
  Vue: '뷰',
  Angular: '앵귤러',
  Svelte: '스벨트',
  'Next.js': '넥스트 제이에스',
  Nuxt: '넉스트',
  Remix: '리믹스',
  Redux: '리덕스',
  Zustand: '주스탠드',
  Recoil: '리코일',
  Jotai: '조타이',
  MobX: '몹엑스',
  Tailwind: '테일윈드',
  Sass: '사스',
  Emotion: '이모션',
  Storybook: '스토리북',
  Vite: '비트',
  Webpack: '웹팩',
  Babel: '바벨',
  ESLint: '이에스린트',
  Prettier: '프리티어',
  Jest: '제스트',
  Vitest: '비테스트',
  Cypress: '사이프러스',
  Playwright: '플레이라이트',
  Electron: '일렉트론',
  Tauri: '타우리',
  Flutter: '플러터',
  Expo: '엑스포',

  // 런타임·패키지 관리
  'Node.js': '노드 제이에스',
  Deno: '디노',
  Bun: '번',
  npm: '엔피엠',
  pnpm: '피엔피엠',
  Yarn: '얀',
  Turborepo: '터보레포',
  Lerna: '러나',
  Nx: '엔엑스',

  // 백엔드·데이터
  Spring: '스프링',
  Django: '장고',
  Flask: '플라스크',
  FastAPI: '패스트에이피아이',
  Express: '익스프레스',
  NestJS: '네스트 제이에스',
  Prisma: '프리즈마',
  GraphQL: '그래프큐엘',
  Kafka: '카프카',
  RabbitMQ: '래빗엠큐',
  Redis: '레디스',
  MongoDB: '몽고디비',
  PostgreSQL: '포스트그레스, 포스트그레스큐엘',
  MySQL: '마이에스큐엘, 마이시퀄',
  SQLite: '에스큐엘라이트, 시퀄라이트',
  Elasticsearch: '엘라스틱서치',
  Supabase: '수파베이스',
  Firebase: '파이어베이스',

  // 인프라·클라우드·운영
  Docker: '도커',
  Kubernetes: '쿠버네티스',
  Nginx: '엔진엑스',
  Terraform: '테라폼',
  Ansible: '앤서블',
  Jenkins: '젠킨스',
  Vercel: '버셀',
  Netlify: '네틀리파이',
  Cloudflare: '클라우드플레어',
  Lambda: '람다',
  Azure: '애저',
  Heroku: '헤로쿠',
  Datadog: '데이터독',
  Sentry: '센트리',
  Grafana: '그라파나',
  Prometheus: '프로메테우스',
  Amplitude: '앰플리튜드',
  Mixpanel: '믹스패널',
  Postman: '포스트맨',
  Swagger: '스웨거',
  OAuth: '오어스',

  // AI
  Whisper: '위스퍼',
  Ollama: '올라마',
  LangChain: '랭체인',
  'Hugging Face': '허깅페이스',
  OpenAI: '오픈에이아이',
  ChatGPT: '챗지피티',
  Claude: '클로드',
  Gemini: '제미나이',
  Copilot: '코파일럿',
  Cursor: '커서',

  // 개발 관용어
  Monorepo: '모노레포',
  Commit: '커밋',
  Merge: '머지',
  Rebase: '리베이스',
  Branch: '브랜치',
  'Pull Request': '풀 리퀘스트',
  Issue: '이슈',
  Review: '리뷰',
  Build: '빌드',
  Bundle: '번들',
  Config: '컨피그',
  Runtime: '런타임',
  Linter: '린터',
  Refactoring: '리팩터링, 리팩토링',
  Migration: '마이그레이션',
  Schema: '스키마',
  Endpoint: '엔드포인트',
  Middleware: '미들웨어',
  Webhook: '웹훅',
  WebSocket: '웹소켓',
  Serverless: '서버리스',
  Microservice: '마이크로서비스',
  Pipeline: '파이프라인',
  Workflow: '워크플로, 워크플로우',
  Staging: '스테이징',
  Release: '릴리스, 릴리즈',
  Rollback: '롤백',
  Hotfix: '핫픽스',
  Sandbox: '샌드박스',
  Fallback: '폴백',
  Legacy: '레거시',
  Cache: '캐시, 캐쉬',
  Proxy: '프록시',
  Payload: '페이로드',
  Token: '토큰',
  Session: '세션',
  Cookie: '쿠키',
  Query: '쿼리',
  Index: '인덱스',
  Transaction: '트랜잭션',
  Thread: '스레드',
  Worker: '워커',
  Queue: '큐',
  Batch: '배치',
  Cron: '크론',
  Polling: '폴링',
  Throttle: '스로틀',
  Debounce: '디바운스',
  Snapshot: '스냅샷',
  Fixture: '픽스처',
  Props: '프롭스',
  Metric: '메트릭',
  Latency: '레이턴시',
  Throughput: '스루풋',
  Benchmark: '벤치마크',
  Profiling: '프로파일링',

  // 제품·기획·UI 관용어
  Sprint: '스프린트',
  Backlog: '백로그',
  Kanban: '칸반',
  Scrum: '스크럼',
  Epic: '에픽',
  Roadmap: '로드맵',
  Milestone: '마일스톤',
  Onboarding: '온보딩',
  Dashboard: '대시보드',
  Retention: '리텐션',
  Funnel: '퍼널',
  Cohort: '코호트',
  Persona: '페르소나',
  Wireframe: '와이어프레임',
  Prototype: '프로토타입',
  Feature: '피처',
  Layout: '레이아웃',
  Modal: '모달',
  Toast: '토스트',
  Tooltip: '툴팁',
  Dropdown: '드롭다운',
  Sidebar: '사이드바',
  Navigation: '내비게이션, 네비게이션',
  Breadcrumb: '브레드크럼',
  Skeleton: '스켈레톤',
  Pagination: '페이지네이션'
}

export interface TermReading {
  /** 사전의 정식 표기 */
  term: string
  /** `읽기1, 읽기2` 형식의 한글 읽기 */
  reading: string
}

const READINGS_BY_KEY = new Map<string, TermReading>(
  Object.entries(TERM_READINGS).map(([term, reading]) => [term.toLowerCase(), { term, reading }])
)

/**
 * @description 용어의 검수된 읽기를 찾습니다. 대소문자를 무시하고, 맞으면 정식 표기와 함께 돌려줍니다.
 * @param term - 용어 표기
 * @returns 정식 표기와 읽기. 사전에 없으면 undefined
 * @example
 * termReadingOf('github') // { term: 'GitHub', reading: '깃허브' }
 * termReadingOf('Whisper.cpp') // undefined
 */
export const termReadingOf = (term: string) => READINGS_BY_KEY.get(term.trim().toLowerCase())
