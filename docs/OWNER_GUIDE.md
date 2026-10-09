# Owner guide (plain language)

## What you have right now

You have a working **demo** of the journal that runs entirely inside a web browser. It uses made-up ("synthetic") meals, nutrition numbers, history and a workout plan. Nothing is sent anywhere. There is no login yet, no cloud backup, and no AI.

The demo exists to answer one question: **does this feel easier than your notebook?** Do not type your real health records into it yet. It is not backed up, and the nutrition numbers are placeholders.

## Try it on your computer

1. Install Node.js 22 LTS from nodejs.org (a one-time step).
2. Open a terminal in the project folder and run:
   ```bash
   npm ci
   npm run dev
   ```
3. Open http://localhost:5173. To see the phone layout in Chrome, press F12 and then the phone/tablet icon.

## Try it on your Samsung phone (same Wi-Fi, no publishing)

1. On the computer, run `npm run dev -- --host`. It prints a "Network" address such as `http://192.168.1.20:5173`.
2. Open that address in Chrome on the phone.
3. Logging, the timer and saving all work. Two things do **not** work over this plain-HTTP address: installing to the home screen and offline mode. Browsers only allow those on HTTPS, which needs a private hosted URL later (checklist section 9). Your computer's firewall may also ask to allow the connection.

Things to try (about 10 minutes):
- **Meals:** tap *Dal katori* once. Time how long it takes from opening the app to seeing "Saved". Then tap **Undo**.
- **Amount…:** log 3 rotis. Then tap *Edit* on the timeline and delete it.
- **Train:** start *Push*, enter reps and kg, and tap the big ✓. Lock the phone for a minute, unlock it, and check that the rest timer kept counting. Pull down to refresh the page and check that the set is still ticked.
- **Progress:** switch between 7, 28 and 90 days. Tap a chart to read a day. Open "Show numbers".
- **Settings:** switch to Demo B. None of Demo A's meals should appear.

Write down anything that felt slow, confusing or too small. Keep this list outside the project folder if it contains personal details.

## Where data is stored

| What | Where | Survives |
|---|---|---|
| Meals, sets, weights, steps, the rest-timer end time | this browser's IndexedDB, separately per profile | reloads, closing the tab, restarting the phone |
| App files | the browser's cache (installed/HTTPS version only) | updates replace them, and your entries are not touched |
| Anything | — | **not** clearing site data, uninstalling the browser app, or a "reset demo" |

There is **no backup yet**. *Settings → Export my data (JSON)* downloads everything for the current profile in an open format. Treat that file like a medical record: store it privately and never commit it to git. **Restore/import is not built yet** (Phase 1). Do not rely on export as a backup until a restore has been tested.

## Deleting data

- *Settings → Reset demo data* deletes the current profile's on-device database and regenerates the demo.
- Clearing the site's data in the browser deletes all profiles on that device.
- Cloud account deletion, and the backup-expiry explanation that goes with it, will come with Supabase in Phase 1.

## Things only you can do (the builder must not)

- Create accounts (Supabase, Google AI Studio, hosting). Enable MFA on each, and keep passwords and recovery codes in a password manager.
- Enter secrets in those dashboards. **Never paste a key into a chat, an issue, a screenshot or a file in this project.**
- Decide when to publish a URL, turn on billing, or invite your wife or friends.
- Provide your real usual meals, portions and current workout plan when you are ready. Keep them outside the repository until the private cloud project exists.

## If a key ever leaks

Revoke or rotate it in the provider's dashboard straight away. Deleting it from a file does **not** revoke it. Then check the provider's usage logs.
