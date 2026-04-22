# 🗺 Focus Cat Roadmap

Last Updated: 2026-04-22

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

⬜ LemonSqueezy 스토어 활성화 (PayPal 계좌 인증 대기 중 🔴 블로커)
⬜ End-to-end 테스트 (실제 키 구매 → 활성화)

✅ GitHub 레포 생성 + 초기 커밋 (github.com/Jooyoung-Peter-Lee/focus-cat-for-youtube)
✅ 개인정보처리방침 작성 (docs/store/privacy-policy.html) — GitHub Pages 배포 완료
✅ 스토어 설명문 초안 (docs/store/store-listing.md)
✅ 스크린샷 촬영 가이드 (docs/store/screenshot-guide.md)
⬜ 스크린샷 5장 실제 촬영
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