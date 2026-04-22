# 🐱 CLAUDE_GUIDE.md
Focus Cat for YouTube — AI Engineering Constitution

This document defines how Claude must behave when working on this project.

This is a commercial Chrome Extension.
All generated code must be production-quality.

---

# 1️⃣ PROJECT IDENTITY

Project Name:
Focus Cat for YouTube

Category:
Productivity Chrome Extension

Core Idea:
A gentle time-limiting assistant for YouTube that removes distractions
and enforces a daily usage limit with a cute cat overlay.

Primary Market:
United States

Target Users:
- Remote workers
- Students
- ADHD-friendly UX seekers
- Productivity-focused users

Tone:
Encouraging, calm, not aggressive.

---

# 2️⃣ NON-NEGOTIABLE ENGINEERING RULES

Claude must:

- Think like a senior Chrome Extension architect
- Design for scalability
- Avoid hacks
- Avoid mixing responsibilities
- Respect Manifest V3 lifecycle constraints
- Prioritize performance and maintainability

Claude must NOT:

- Use fragile DOM selectors
- Use setInterval as the primary time mechanism
- Mix background logic with content logic
- Create global mutable state
- Write prototype-level code
- Suggest YouTube API usage

---

# 3️⃣ TECH STACK

Platform:
Chrome Extension (Manifest V3)

Language:
TypeScript (preferred)

Storage:
chrome.storage.local

Architecture:
- Background service worker
- Content script (youtube.com only)
- Popup UI
- Options page
- Shared utilities

No backend for MVP.

Future:
- Stripe licensing
- License verification API
- Optional Supabase backend

---

# 4️⃣ ARCHITECTURE PRINCIPLES

Strict separation of concerns.

background/
  - Time tracking
  - Date reset
  - State calculation
  - Limit enforcement

content/
  - DOM manipulation
  - Recommendation removal
  - Shorts blocking
  - Overlay injection

popup/
  - Usage display
  - Remaining time

options/
  - User settings configuration

shared/
  - storage wrapper
  - types
  - time utilities
  - license abstraction

Time logic must NEVER live in content scripts.

DOM manipulation must NEVER live in background.

---

# 5️⃣ TIME TRACKING REQUIREMENTS

Track only active YouTube watch time.

Must correctly handle:

- Multiple YouTube tabs
- Tab switching
- Window focus changes
- Browser minimize
- System sleep / wake
- Service worker suspension
- Manual system clock changes

Implementation strategy:

- Store timestamps
- Calculate deltas
- Do not rely solely on intervals
- Update storage sparingly

Data structure:

DailyUsage {
  date: YYYY-MM-DD
  usedSeconds: number
  lastUpdated: number (timestamp)
}

Reset automatically when date changes.

---

# 6️⃣ YOUTUBE DOM STRATEGY

YouTube is a SPA.

Requirements:

- Use MutationObserver
- Detect route changes
- Re-apply cleaning when navigation occurs
- Prefer attribute-based selectors
- Avoid layout-dependent selectors
- Fail gracefully if selectors break

Avoid:

- Deep nth-child chains
- CSS dependent on exact structure
- Heavy polling loops

Performance is critical.

---

# 7️⃣ OVERLAY SYSTEM

When daily limit exceeded:

Inject a full-screen overlay with:

- position: fixed
- highest z-index
- pointer-events blocking
- minimal DOM footprint

Two modes:

Soft Mode:
- Dismiss allowed
- Optional +5 minute extension (Pro only)

Hard Mode:
- No dismiss
- Block playback
- Prevent interaction

Overlay must:

- Be encapsulated in single root element
- Be removable without side effects
- Not permanently mutate YouTube DOM
- Avoid reflow-heavy operations

---

# 8️⃣ FREE VS PRO STRUCTURE

Feature gating must be centralized.

Pro verification method: LemonSqueezy license key
User enters license key in the extension options page
Extension validates key against LemonSqueezy API at activation time
Validated Pro status is stored in chrome.storage.local

Do NOT use Chrome Web Store in-app payments
Do NOT use Stripe

shared/license.ts must abstract this verification so the rest of the codebase only calls isPro()

Never scatter "if (pro)" across random files.

---

# FREE VS PRO FEATURE SPEC

FREE (no payment required):

- Time tracking
- Hide homepage recommendations
- Hide right-side recommendations
- Block Shorts
- Daily limit setting (any duration)
- Cat overlay on limit exceeded (dismissible)

PRO ($4.99 one-time purchase):

- All free features
- Hard Mode: overlay cannot be dismissed
- +5min / +10min extension, once per day (user chooses at the moment of request)
- Settings password lock
- Weekly usage statistics

---

# PRICING & PAYMENT

Price: $4.99 one-time purchase
Payment processor: LemonSqueezy (Merchant of Record)
No subscription, no recurring charges
LemonSqueezy handles VAT and international tax automatically

License key flow:
purchase → LS issues key → user enters key in options → extension verifies via LS API → Pro unlocked

---

# 9️⃣ PERFORMANCE RULES

- Minimize chrome.storage writes
- Debounce MutationObserver callbacks
- Avoid memory leaks
- Avoid unnecessary re-renders
- Avoid blocking main thread
- Avoid large JSON writes per second

Target:
No noticeable performance impact.

---

# 🔐 SECURITY & PRIVACY

This extension is privacy-first.

Strictly forbidden:

- Remote script loading
- eval()
- Dynamic code execution
- User tracking
- Analytics transmission
- External data scraping

All data remains local.

---

# 🔟 CODE QUALITY REQUIREMENTS

All code must:

- Be modular
- Be strongly typed
- Avoid magic numbers
- Avoid implicit any
- Include clear file placement comments
- Handle edge cases
- Be production-ready

When generating code:

Claude must:

1) Specify file name
2) Provide complete file code
3) Briefly explain architecture decision
4) Mention edge cases handled

Never generate partial snippets unless explicitly requested.

---

# 11️⃣ MVP PRIORITY ORDER

1. Project structure
2. Time tracking
3. Daily reset logic
4. Recommendation removal
5. Overlay injection
6. Settings persistence
7. Popup usage UI

Do not polish UI before core logic is correct.

---

# 12️⃣ PRODUCT PHILOSOPHY

Focus Cat is not a blocker.

It is:

- A gentle behavioral nudge
- A productivity companion
- A respectful assistant

The cat should feel:
Cute.
Slightly disappointed.
Encouraging.

Never punitive.

---

# 13️⃣ LONG-TERM VISION

This project will become:

- Paid Chrome Extension
- Subscription-based tool
- Possibly multi-device synced
- Scalable SaaS

All architecture decisions must support long-term maintainability.

---

# FINAL INSTRUCTION TO CLAUDE

Always think like a CTO of a commercial software product.

This is not a tutorial project.
This is a product that will be sold.

Build accordingly.