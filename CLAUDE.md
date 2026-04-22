# Focus Cat for YouTube — CLAUDE.md

Claude Code가 세션 시작 시 자동으로 읽는 컨텍스트 문서.
엔지니어링 헌법은 `docs/CLAUDE_GUIDE.md` 참조.

---

## 프로젝트 개요

YouTube 시청 시간을 제한하는 Chrome Extension (Manifest V3).
$4.99 one-time 유료 Pro 티어 포함.
결제: Lemon Squeezy (한국 Stripe 대체, MoR).

---

## 절대 규칙 (CLAUDE_GUIDE.md 요약)

- 인라인 스타일만 사용 — 외부 CSS, `<style>` 태그 주입 금지
- 시간 로직은 절대 content script에 두지 않음
- DOM 조작은 절대 background에 두지 않음
- `setInterval`을 주 타이머로 사용 금지 — timestamp delta 방식만
- Pro 게이팅은 `shared/license.ts`의 `isProActive()` 하나로만
- 코드 전체에 `if (pro)` 산재 금지

---

## 아키텍처

```
background/     시간 추적, 날짜 리셋, LimitState 계산, broadcast
content/        DOM 조작, 오버레이 주입, 플레이어/네비 감시
popup/          사용량 표시
options/        설정 UI, 라이선스 키 입력
shared/         storage wrapper, types, timeUtils, license
```

**메시지 흐름:**
content → background: `YT_PLAY / YT_PAUSE / YT_HEARTBEAT / ADD_EXTENSION_MINUTES`
background → content: `LIMIT_STATE_UPDATE`

**LimitState:** `'under' | 'warning'(90%) | 'exceeded'`
**extensionMs:** TrackingState에 저장, limitMs에 더해져 유효 한도 연장

---

## 백엔드 (focus-cat-api)

위치: `C:\ChormeExtensionDev\focus-cat-api\`
런타임: Vercel serverless (TypeScript)

| 엔드포인트 | 역할 |
|-----------|------|
| `POST /api/verify-license` | LS API로 키 검증 + activate |
| `POST /api/deactivate-license` | LS instance 해제 |

필요 환경변수 (Vercel dashboard에 설정):
- `LEMON_SQUEEZY_API_KEY`
- `LEMON_SQUEEZY_STORE_ID`

배포 URL: `https://focus-cat-api.vercel.app` ✅ 배포 완료 (2026-04-18)

---

## 주요 파일

| 파일 | 역할 |
|------|------|
| `src/background/timeTracker.ts` | YT_PLAY/PAUSE/HEARTBEAT 핸들러, 타임스탬프 state machine |
| `src/background/limitEnforcer.ts` | LimitState 계산 (extensionMs 포함), broadcast |
| `src/background/index.ts` | SW 진입점, 메시지 라우팅 |
| `src/content/overlay/overlayController.ts` | 오버레이 state machine, LIMIT_STATE_UPDATE 수신 |
| `src/content/overlay/overlayView.ts` | 오버레이 DOM 빌드/마운트/언마운트 |
| `src/content/overlay/warningBanner.ts` | 90% 경고 배너 |
| `src/shared/license.ts` | Pro 게이팅 단일 진입점, LS API 호출 |
| `src/shared/types.ts` | 모든 도메인 타입, 메시지 계약, 상수 |
| `src/options/index.ts` | 설정 + 라이선스 키 활성화 UI 로직 |

---

## Phase 진행 상황 (2026-04-20 기준)

### Phase 1 — MVP ✅ 완료
### Phase 2 — UX Polish ✅ 완료

### Phase 3 — Pro Infrastructure & Launch (진행 중)

✅ Pro feature gating UI (options 페이지 Hard mode 잠금, overlay 업그레이드 버튼)
✅ +5min extension — background enforcement (extensionMs → limitMs 반영)
✅ 옵션 페이지 라이선스 키 입력 UI (Activate / Deactivate 버튼)
✅ `shared/license.ts` — `activateLicenseKey()` / `deactivateLicenseKey()` 구현
✅ Vercel 백엔드 코드 작성 (`verify-license`, `deactivate-license`)
✅ manifest.json — 백엔드 host_permissions + CSP 업데이트
✅ Vercel 배포 + 환경변수 설정 (LEMON_SQUEEZY_API_KEY, LEMON_SQUEEZY_STORE_ID)
✅ Lemon Squeezy 상품 생성 ($4.99 one-time, license key 발급 설정 완료)
✅ 구매 링크 options 페이지에 추가 (src/options/index.html)

⬜ Lemon Squeezy 스토어 활성화 (PayPal 계좌 인증 대기 중)
⬜ End-to-end 테스트 (실제 키 구매 → 입력 → Pro 활성화 확인)
⬜ Chrome Web Store 출품 준비 (스크린샷, 설명, 개인정보처리방침)
⬜ Store 제출 & 심사

### Phase 4, 5 — 미착수

---

## 다음 세션 시작점

1. **Lemon Squeezy 스토어 활성화** — PayPal 계좌 인증 완료 후 스토어 활성화
2. **End-to-end 테스트** — 실제 키 구매 → options 페이지 입력 → Pro 활성화 확인
3. **Chrome Web Store 출품 준비** — 스크린샷, 설명, 개인정보처리방침
