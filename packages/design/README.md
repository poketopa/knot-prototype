# @meeting-stt/design

데스크탑 앱과 브라우저 프로토타입이 함께 쓰는 **디자인 토큰**(`src/base.css`)과 **동봉 글꼴**(`src/fonts.css`, `src/fonts/`).
값의 근거와 컴포넌트 계약은 `.claude/skills/meeting-stt-dev/references/architecture.md` "화면 디자인" 절,
패키지 규약은 `references/monorepo.md` "디자인 패키지" 절.

```css
@import '@meeting-stt/design/fonts.css';
@import '@meeting-stt/design/base.css';
```

- CSS와 글꼴만 있다. React 컴포넌트는 앱마다 같은 계약으로 구현한다.
- 글꼴은 전부 SIL OFL이다. 배포처 원본을 수정하지 않고 파일 이름만 바꿨으며, 각 폴더에 `OFL.txt`가 있다.
