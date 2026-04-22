# Focus Cat for YouTube

## Architecture (Manifest V3 – Event Driven Time Tracking)

---

# 1. Architectural Philosophy

Focus Cat is built on **Manifest V3**, which means:

* Background runs as a **Service Worker**
* It is **event-driven**, not persistent
* Timers (setInterval / setTimeout) are NOT reliable
* State in memory can disappear at any time

Therefore:

> We do NOT increment time every second.
> We compute time using state + timestamps.

This document reflects the new stable MV3 architecture.

---

# 2. High-Level System Overview

Extension Components:

1. Background Service Worker
2. Content Script (YouTube only)
3. Popup UI
4. Options Page
5. Shared Utilities

Core Design Principle:

* Content Script detects playback state
* Background computes accumulated time
* No continuous polling
* No persistent intervals

---

# 3. Why setInterval Was Removed

In Manifest V3:

* Service workers suspend automatically
* setInterval may stop unexpectedly
* Worker restarts can cause duplicate timers
* Time "jumps" can occur after resume

This caused:

* 2–3 second jumps on interaction
* Time not increasing during playback
* Duplicate accumulation bugs

Solution:

We replaced incremental timers with timestamp-based computation.

---

# 4. New Time Tracking Model (State-Based Calculation)

Instead of adding 1 second repeatedly:

❌ Old approach:
usedSeconds++

✅ New approach:
used = accumulated + (now - startedAt)

---

# 5. Tracking State Model

Background maintains:

```ts
interface TrackingState {
  date: string;                // YYYY-MM-DD
  accumulatedMs: number;       // confirmed usage
  playingTabId?: number;       // active playing tab
  startedAtMs?: number;        // playback start timestamp
  lastHeartbeatMs?: number;    // optional safety mechanism
}
```

Important:

* accumulatedMs only increases when playback stops
* startedAtMs exists only while playing
* Current usage is always calculated, never blindly incremented

---

# 6. Event Flow

## 6.1 Playback Started

Content Script detects:

* video.play event

It sends:

{ type: "YT_PLAY", tabId }

Background:

* Sets startedAtMs = Date.now()
* Stores playingTabId

---

## 6.2 Playback Paused / Ended

Content Script sends:

{ type: "YT_PAUSE" }
or
{ type: "YT_ENDED" }

Background:

* Calculates diff = now - startedAtMs
* accumulatedMs += diff
* Clears startedAtMs
* Persists state to chrome.storage.local

---

## 6.3 Current Usage Calculation

Whenever usage is requested:

```ts
function getUsedMs(state: TrackingState) {
  if (state.startedAtMs) {
    return state.accumulatedMs + (Date.now() - state.startedAtMs);
  }
  return state.accumulatedMs;
}
```

This works even if:

* Service worker suspended
* Worker restarted
* Tab switched

---

# 7. Optional Heartbeat Safety Mechanism

Because YouTube is a SPA and DOM can change:

Content Script sends a heartbeat every 10–15 seconds while playing:

{ type: "YT_HEARTBEAT", isPlaying: true }

Background updates:

lastHeartbeatMs = Date.now()

If heartbeat stops unexpectedly:

* Background may treat playback as paused
* Prevents ghost accumulation

Heartbeat is NOT used for incrementing time.
Only for state validation.

---

# 8. Daily Reset Logic

On every message or usage check:

1. Compare stored date with today
2. If different:

   * Reset accumulatedMs
   * Clear startedAtMs
   * Update date

No background cron required.
Reset is event-triggered.

---

# 9. Time Limit Enforcement

When getUsedMs() exceeds dailyLimitMs:

Background:

* Sends message to active YouTube tab
* Triggers overlay injection

Content Script:

* Renders full-screen cat overlay (Pro)
* Blocks interaction (Hard mode)
* Allows limited extension (Soft mode)

---

# 10. Data Storage Strategy

Stored in chrome.storage.local:

Settings:

* dailyLimitMinutes
* focusMode
* hideHomeRecommendations
* hideRightRecommendations
* blockShorts
* proEnabled

Daily Usage:

* date
* accumulatedMs

Important:

* Storage writes occur only on pause/end
* Not every second
* Minimizes performance overhead

---

# 11. YouTube SPA Handling

Because YouTube does not reload pages:

Content Script uses:

* MutationObserver
* Video element re-detection
* Listener deduplication

Ensures:

* No duplicate event binding
* No double play detection

---

# 12. Performance Principles

* No continuous polling
* No persistent timers
* Minimal storage writes
* Event-driven only
* Safe under worker suspension

---

# 13. Scalability for Pro Features

This architecture supports:

* Soft / Hard mode
* Daily extension (+5 min once per day)
* Temporary unlock tokens
* Remote license validation (future)
* Analytics (future, optional)

All without changing the core tracking model.

---

# 14. Summary

Old Model:

* setInterval
* Increment per second
* Unstable in MV3

New Model:

* Event-driven
* Timestamp-based
* Suspend-safe
* Commercial-grade reliability

Focus Cat now uses a deterministic, state-based time tracking engine compatible with Manifest V3 constraints.

---

End of Architecture Document
