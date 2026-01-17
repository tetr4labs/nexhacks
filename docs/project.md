# Tetra (Hackathon Voice Assistant) — Build Blueprint + Demo Plan

## One-liner
**Tetra** is a cyberpunk-futuristic voice assistant that turns spoken intentions into a structured day plan (tasks + events) and keeps you accountable to what you said you would do.

## Theme / Vibe
- Cyberpunk / futuristic “OS console”
- Neon-on-black UI, scanline/noise, terminal-like feed, pulsing tetrahedron centerpiece
- Short, confident confirmations: “Confirmed.” “Injected into your timeline.” “Commitment logged.”

---

## Tech Stack
### Frontend
- **Next.js** (App Router)
- UI: timeline/day view + “Talk to Tetra” console UI + ICS import UI
- Auth UI via Supabase helpers (or custom)

### Backend / API
- **FastAPI** (REST endpoints for events/tasks/commitments, plus any agent orchestration helpers)
- Optional: background jobs for reminders / follow-ups (can be stubbed for hackathon)

### Database + Auth
- **Supabase**
  - Auth (email magic link or OAuth)
  - Postgres for data storage (events, tasks, commitments, conversation logs)
  - (Optional) Supabase Storage for `.ics` file uploads

### Voice Agent
- **LiveKit** for realtime voice (WebRTC)
  - Client joins a LiveKit room from the Talk page
  - Voice agent runs server-side and streams audio in/out
- (Optional) **ElevenLabs** for TTS (cyberpunk voice), depending on time
  - If not using ElevenLabs, use whatever TTS is fastest/available with the agent setup

---

## Core Concept
### The loop that must work (demo-critical)
1. User clicks **Talk to Tetra**
2. User speaks: “What’s my day?” / “Schedule gym today”
3. Tetra (voice agent):
   - reads today’s timeline
   - proposes a time slot (if needed)
   - on “yes”, creates an event/task in DB
   - optionally sets a reminder / commitment
4. UI updates immediately (timeline + “intent ledger” + system feed)

This is the minimum “wow” demo: **voice → state change → UI updates**.

---

## Product Features (Hackathon Scope)
### 1) Conversational assistant for day planning
Example commands:
- “Hey Tetra, what are my tasks today?”
- “I want to go to the gym today — when’s a good time?”
- “Schedule gym for an hour.”
- “Remind me 30 minutes before.”
- “Mark gym as done.”

### 2) Calendar import (no Google Calendar integration)
- Users upload `.ics` files
- Import into Tetra’s own database
- Render inside Tetra’s calendar/timeline UI

### 3) Website with authentication (Supabase)
- Minimal auth flow for speed
- Protected app pages after login

### 4) Accountability layer (“Intent Ledger”)
Cyberpunk framing: once you say it, Tetra logs it as a commitment object.
- User: “I’ll go to the gym today.”
- Tetra: “Logging commitment: Gym (60m). Want me to schedule it?”
- Later: “You committed to gym today. Confirm completion?”
- If missed: “Reschedule or mark as skipped (with reason).”

---

## Pages / Routes (Minimum + Pitchable)
### 1) Landing (cyberpunk marketing)
- Hero: “Your day, compiled.”
- Bullets:
  - “Speak intentions. Tetra schedules.”
  - “Imports your calendar. No integrations required.”
  - “Accountability mode: it remembers what you committed to.”
- CTA: **Sign in** / **Launch Console**

### 2) Auth (Supabase)
- Minimal auth UI (fast)
- Redirect to Console after login

### 3) Console (Home / Dashboard)
3-panel layout:
- **Today Timeline** (events + tasks, chronological)
- **Commitments / Intent Ledger** (what user said they’ll do, status)
- **System Feed** (terminal log of actions)
Buttons:
- **Talk to Tetra** (primary)
- **Import .ics** (secondary)

### 4) Import Calendar (.ics upload)
- Dropzone + “Preview events”
- Options:
  - “Import next 30 days” toggle
- Button: **Import**

### 5) Talk to Tetra (the demo room)
Centerpiece:
- Pulsing tetrahedron logo (voice activity)
- Live transcript
- Tetra response area
- Right-side mini timeline that updates live as actions occur

Implementation note:
- Next.js Talk page joins a **LiveKit** room
- The **LiveKit voice agent** handles realtime speech in/out and calls FastAPI to read/write scheduling state

Optional mode toggle:
- **Planner** (schedule + propose slots)
- **Accountability** (reminders + follow-up)

### 6) Settings (optional, can be modal)
- Timezone
- Working hours
- Default “gym duration” (45/60/90)
- Reminder style (gentle / strict)

---

## Data Model (Simple + Demo-friendly)
Entities:
- **User**
- **Event**
  - `id, user_id, title, start, end, source: 'ics'|'tetra', notes`
- **Task**
  - `id, user_id, title, due_date?, duration?, status`
- **Commitment (Intent Ledger)**
  - `id, user_id, text, created_at, linked_task_id?, linked_event_id?, status`
- **ConversationLog** (highly recommended for UI)
  - `id, user_id, timestamp, role, text`

Key behavior:
- Every assistant action writes to `ConversationLog`
- The UI panels (timeline, ledger, feed) update based on DB state

---

## Scheduling Logic (Good enough for hackathon)
Goal: propose an open time slot quickly, no heavy optimization.
Approach:
1. Load today’s events (and optionally tasks w/ durations)
2. Compute free gaps inside working hours
3. Pick a gap that fits requested duration (e.g., gym 60m)
4. Offer 1–2 options

Example response:
- “You have a 5:30–7:30 PM gap. Want me to schedule Gym 6:00–7:00?”

Rules of thumb:
- Respect working hours
- Avoid back-to-back where possible
- If no slot fits: propose tomorrow or shorten duration

---

## Voice UX / Cyberpunk Feel (Fast Wins)
Visual:
- Waveform bars + glowing/pulsing tetrahedron
- “SYSTEM STATUS: LISTENING / PROCESSING / COMMITTING”
- Micro-animation on event creation: “Event injected into timeline”

Text style:
- short confirmations: “Confirmed.” “Logging commitment.” “Scheduled.”

---

## Demo Script (60–90 seconds, judge-friendly)
1) “Tetra, what’s my day?”
- reads 2–3 items from timeline

2) “I want to go to the gym today.”
- logs commitment + proposes a time slot

3) “Yes, schedule it.”
- creates event, timeline updates live

4) “Remind me 30 minutes before.”
- logs reminder action in system feed

5) “What tasks do I have left?”
- shows tasks + commitments panel

6) “Mark gym as done.”
- status flips to Done (optional glitch/confetti effect)

---

## Optional “Wow” Feature (Easy + High Impact)
### Daily Compile
Button: **Compile my day**
Tetra produces:
- Top 3 priorities
- Best deep-work block suggestion
- Risk warnings (e.g., back-to-back meetings)
User: “Lock it in.”
- Inserts time blocks/tasks/events accordingly

This feels advanced but is mostly formatted summarization + inserts.

---

## Cyberpunk Aesthetic Checklist
- Near-black background + neon cyan/magenta accents
- Glassy panels + subtle noise
- Terminal-style feed with timestamps
- Header: “TETRA OS” + user handle
- Optional custom cursor: glowing dot/trail

---

## Build Priorities (If time is tight)
1. Auth + Console + Talk page
2. Timeline UI (today) reading from DB
3. LiveKit voice → create event/task → UI update
4. ICS upload → import → show in timeline
5. Intent Ledger (commitments) + system feed
