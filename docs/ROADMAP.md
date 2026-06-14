# 🗺 Focus Cat Roadmap

Last Updated: 2026-04-24

---

# Phase 1 — MVP (Weeks 1–3)

✅ Project structure setup
✅ Manifest V3 config
✅ Recommendation removal
✅ Shorts blocking
✅ Basic time tracking
✅ Daily reset logic
✅ Warning banner
✅ Simple cat overlay

Goal:
Working local-only extension.

---

# Phase 2 — UX Polish (Weeks 4–5)

✅ Animated cat
✅ Soft vs Hard mode
✅ Settings page
✅ Popup usage stats
✅ Smooth overlay transitions

Goal:
App-store ready design.

---

# Phase 3 — Pro Infrastructure & Launch (Weeks 6–9)

Payment: LemonSqueezy ($4.99 one-time) — Stripe 사용 불가 (한국)
Backend: Vercel serverless + Supabase

✅ Pro feature gating UI
✅ +5min extension button — background enforcement
✅ Popup extensionMs display fix

✅ Options 페이지 — 라이선스 키 입력 UI (Activate / Deactivate)
✅ shared/license.ts — activateLicenseKey() / deactivateLicenseKey() 구현
✅ Vercel API 코드 — POST /api/verify-license, POST /api/deactivate-license
✅ manifest.json — 백엔드 host_permissions + CSP 업데이트
✅ Vercel 배포 + 환경변수 설정 (LEMON_SQUEEZY_API_KEY, STORE_ID) — 2026-04-18
✅ LemonSqueezy 상품 생성 ($4.99 one-time, license key 발급 설정 완료)
✅ Options 페이지에 구매 링크 추가

⬜ LemonSqueezy 스토어 활성화 🔴 블로커
   → 원인: 세금 정보 미제출 (PayPal 아님)
   → W-9 양식 + SSN 필요 (미국 그린카드 보유 + 한국 거주)
⬜ End-to-end 테스트 (실제 키 구매 → 활성화)

✅ GitHub 레포 생성 + 초기 커밋 (github.com/Jooyoung-Peter-Lee/focus-cat-for-youtube)
✅ 개인정보처리방침 작성 (docs/store/privacy-policy.html) — GitHub Pages 배포 완료
✅ 스토어 설명문 초안 (docs/store/store-listing.md)
✅ 스크린샷 촬영 가이드 (docs/store/screenshot-guide.md)
✅ 스크린샷 5장 실제 촬영 완료 (2026-04-24)
   - shot1-clean-youtube.png
   - shot2-warning-banner.png
   - shot3-overlay-soft.png
   - shot4-overlay-hard.png
   - shot5-options-page.png
✅ 랜딩 페이지 제작 (docs/landing/index.html) — 2026-04-24
   - 단일 파일 HTML, 외부 의존성 없음
   - Hero / 기능 설명 / Soft vs Hard / Pricing / License 활성화 / FAQ / Privacy Policy / ToS 포함
✅ Lemon Squeezy 제출 텍스트 작성 (docs/store/lemonsqueezy-submission.md) — 2026-04-24
   - Business description, Product description, Fulfillment, Refund policy, Privacy summary, ToS summary

⬜ 랜딩 페이지 호스팅 (GitHub Pages 또는 별도 도메인)
⬜ Chrome Developer 계정 등록 ($5 one-time)
⬜ Store submission & review

Goal:
Commercial release with paid Pro tier.

---

# Phase 4 — Optimization

⬜ Refactor for scale
⬜ Add analytics (local only)
✅ Improve DOM resilience
⬜ Reduce storage writes
⬜ Add test coverage

---

# Phase 5 — Growth Features

⬜ Daily streak tracking
⬜ Focus score
⬜ Weekly reports
⬜ Gamification
⬜ Multi-device sync

---

# Long-Term Vision

Focus Cat becomes:

A lightweight behavioral layer on top of YouTube
that encourages intentional consumption.

Not a blocker.
Not a punishment.
A productivity companion.

---

# Exit Strategy

Potential:
- SaaS subscription
- Chrome Store monetization
- Bundle with ADHD productivity tools
- Enterprise productivity tool