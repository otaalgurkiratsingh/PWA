# TrainLuma — Morning readiness note (DRAFT spec, for after the friends test)

Status: **draft, not built.** Written 2026-10-15 from the owner's note on what to borrow from Bevel. Review before building.

## Why

Bevel's strongest engagement engine is one number each morning: "train hard" or "take it easy today". Users open the app to see it. TrainLuma can do a gentle version **without wearables**, from data it already has, and keep its tone: *"Health is a continuous journey, not a phase. Small changes that compound."*

## What (v1)

- **Where it shows:** one line at the top of **Luma Insights** and on Today's "How you're doing" card, each morning. For example:
  - "Fresh today: a good day to push your Legs session."
  - "Yesterday was big. An easier day or a walk would help you recover."
- **No score number in v1.** A 0–100 score invites false precision without wearables. Use three plain states instead: *ready* / *steady* / *go easy*. A number can come later if testers ask for it.
- **Inputs (all already logged, all optional):**
  - **Yesterday's training strain:** completed working sets × relative effort (RIR when logged), plus session minutes, compared with the person's own 4-week average.
  - **Sleep:** a one-tap morning check-in (*slept well / okay / badly*). Only asked if the person opts in. The sleep pattern from the interview (regular / irregular / shift) sets expectations: shift workers are never told they "slept badly".
  - **Soreness:** a one-tap check-in (*none / a bit / very*), plus any pain areas from the interview (back, knees…). These only ever make the advice gentler.
  - **Consistency context:** days since the last session, so a long break reads as "ease back in", never "you're behind".
- **Rules in code, not AI:**
  - A small, unit-tested decision table.
  - The coach may *explain* the note in chat, but never changes it.
  - No medical claims.
  - Pain marked "very sore" always gives "go easy", plus the existing "see a professional if…" line.

## Hard rules (inherit D38/D39/D32-tone)

- Never guilt, never "missed".
- No notification for the note: it is a reason to open the app, not a push. The notification kinds stay at three (D38).
- Never compare people. Circles never show readiness.
- Works offline, locally first. Nothing extra leaves the phone.

## Measure

- `readiness_seen` and `readiness_followed` analytics events. "Followed" means a "go easy" day had a lighter session, or a "ready" day had a session.
- Opens per user per day, before and after (the friends-test baseline comes first).

## Out of scope

- Wearable integrations (HealthKit, Health Connect, Oura, Whoop): later and separate, with its own privacy review.
- HRV or resting-heart-rate based scores.
