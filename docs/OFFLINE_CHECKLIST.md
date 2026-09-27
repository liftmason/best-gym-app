# Offline checklist (athlete app)

Run through this on a real phone before each release, and after changes to sync or the
training screens. The automated tests cover the same flow in CI:
- `app/src/training/session/flow.test.tsx` logs a session offline through the real screens;
- `backend/tests/unit/test_offline_parity.py` sends that session to the real server.

What they can't cover is a real phone, a real network, and the app being closed.

**Setup:**
- A development build of the app on the phone (`app/README.md`, "Development build").
- The backend running (`make run-lan`).
- Signed in as a demo athlete with a program, e.g. `maya@ironridge.example`, code `123456`.

## 1. First sync
1. Sign in with the connection on. The week appears, and the sync pill says **Synced**.

## 2. A whole session with no connection
1. Turn on airplane mode. The pill says **Offline**.
2. Start today's session. Answer the check-in and log every set. Change one set's reps, and
   untick then retick a set.
3. Report an issue, pick an RPE, and **Finish & save**. The done screen shows the right counts.
4. The pill says **Offline · N waiting**.
5. Tick a habit.
6. Close the app completely (swipe it away), then open it again, still offline. Everything
   from steps 2–5 is still there, and the session shows as done.

## 3. Back online
1. Turn airplane mode off. Within a few seconds the pill goes to **Synced**.
2. On the web, as the coach (dana@ironridge.example): the session is in the athlete's
   history with every set, the check-in and the notes. The issue is in the attention
   feed. The habit tick shows.
3. On the phone, nothing changed or doubled.

## 4. A change the server refuses
1. Offline, tick yesterday's habit.
2. On the web as the coach, remove that habit.
3. Back online: the tick disappears, with a short "Not saved: …" notice.

## 5. Started on two devices
1. Two phones signed in as the same athlete, both offline. Start the same session on both,
   and log a set on each.
2. Bring one online, then the other. There's one session, and both sets are in it.

## 6. Signing out with unsent changes
1. Offline, log a set.
2. Sign out. The app warns that 1 change hasn't been sent. Cancel, go online, let it sync,
   then sign out: no warning.

## 7. Messages, numbers and videos
1. Offline, send the coach a message, and change your bodyweight on Profile. Both show at
   once, and the pill counts them.
2. Record a form video for an exercise: it says it's waiting to upload. Close the app, open
   it again: still waiting.
3. Online: the message and the new bodyweight reach the coach, the video uploads, and the
   coach's feed shows it.
4. The coach replies. On the phone the Messages button shows a red count until you open the
   Coach tab. A push (development build) opens the Coach tab when tapped.

## 8. Web
1. `npm run export:web && npm run serve:web`, then open http://localhost:8082 as the athlete.
2. Repeat 2–3 using the browser's offline switch (dev tools → Network → Offline).
3. Open a second tab: it says **GymTrainer is open in another tab**.
