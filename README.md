# 🐱 Focus Cat for YouTube

A privacy-first productivity Chrome Extension that helps users control their YouTube usage.

Focus Cat removes distractions, tracks daily watch time, and gently enforces intentional viewing habits with a calm, friendly overlay experience.

Built for:
- Remote workers
- Students
- ADHD-friendly productivity users
- Anyone who wants intentional YouTube usage

Primary Market: United States

---

# ✨ Core Features

## 🎯 Distraction Removal
- Hide YouTube home recommendations
- Hide right sidebar suggested videos
- Optional Shorts blocking
- Designed to support YouTube SPA navigation

## ⏱ Daily Watch Time Tracking
- Tracks active YouTube tab usage
- Accurate delta-based time calculation
- Automatic daily reset
- Multiple tab & window aware

## 🐱 Time Limit Enforcement
- Custom daily limit
- Gentle warning state
- Full-screen overlay (Pro mode)
- Soft Mode & Hard Mode support (Pro)

---

# 🧠 Product Philosophy

Focus Cat is not a blocker.

It is a behavioral layer on top of YouTube designed to:

- Reduce impulsive consumption
- Encourage intentional viewing
- Provide calm, non-aggressive feedback
- Support sustainable productivity habits

The cat is slightly disappointed — but supportive.

---

# 🔒 Privacy-First Design

Focus Cat:

- Collects **no personal data**
- Sends **no usage analytics**
- Uses **no remote scripts**
- Stores all data locally (chrome.storage.local)
- Does not depend on YouTube APIs

All processing is done entirely inside the browser.

---

# 🏗 Architecture Overview

Built with:

- Chrome Extension Manifest V3
- Background Service Worker
- Content Script (youtube.com only)
- TypeScript
- MutationObserver-based DOM management

High-level structure:
