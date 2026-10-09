# AGENTS.md

## What this is
VOTe 1.0 is a Bahasa Melayu-first documentation assistant for Occupational Therapists. It started as a single-file Claude artifact ("Versi Awam") and was ported to Netlify. The UI copy mixes Malay and English on purpose. Keep it that way.

## Architecture
- `index.html`: all markup for the five views (home, session, guide, library, settings), the bottom/side nav and the sheet overlay.
- `src/styles.css`: the whole design system (CSS variables, light and dark themes).
- `src/app.js`: the original app logic, mostly unchanged: state, speech, SOAP prompt (`SOAP_RULES`), Clinical Check, export, guide, library and admin dashboard rendering.
- `src/platform.js`: **adapter layer**. The original code calls `claude.use('user' | 'db' | 'sample' | 'downloads')`. This module implements that API on Netlify:
  - `user`: Netlify Identity (`isOwner` = Identity role `admin`)
  - `db`: a Firestore-like `doc().get/set` and `collection().get` backed by `/api/usage` and `/api/admin/usage`
  - `sample.json(prompt)`: POSTs to `/api/ai` and parses the JSON reply
  - `use()` returns `null` when nobody is logged in, and the app then falls back to guest or copy-paste behaviour.
  The adapter also contains the auth helpers used by the login sheet (`showLoginHelp`, `showNewPassword` in app.js).
- `netlify/functions/ai.mts`: auth-required Claude call via AI Gateway (`claude-sonnet-5-5`). Prompts are built client-side.
- `netlify/functions/usage.mts`: GET/PUT the signed-in user's usage JSON.
- `netlify/functions/admin-usage.mts`: returns every user's usage JSON, admin role only.
- `db/schema.ts`: a single `usage` table (`user_id` PK, `data` jsonb). Migrations go in `netlify/database/migrations/` (`npx drizzle-kit generate --name <name>`). Never edit applied migrations.

## Non-obvious decisions and rules
- **No clinical data is persisted.** Transcripts and SOAP notes live only in memory. Never add storage for them, and never put clinical text into `usage.data`.
- SOAP report language (`reportLang`, English default, BM optional) is separate from the speech language; it is appended to `SOAP_RULES` via `REPORT_LANG` and it is not persisted: it resets to English on every load and on START NEW CLIENT. JSON keys stay `S/O/A/P` in both languages.
- Copy-paste SOAP uses `SOAP_MANUAL_SUFFIX` (strict JSON, plain-text S:/O:/A:/P: fallback); `parseSoapReply` reads both.
- Automatic AI requires login. This protects the site owner's AI credits. Guests use copy-paste.
- The shape of the usage JSON (`t`, `d`, `docMs`, `docN`, `fb`, `first`, `last`) is defined by `initAnalytics`/`track` in app.js. The admin dashboard aggregates it client-side.
- Share and direct links use `location.origin`.
- The logo is served through the Netlify Image CDN (`/.netlify/images?url=/img/...`).
- Run `node /opt/buildhome/.claude/skills/netlify-identity/scripts/enable.cjs` if Identity ever needs re-enabling.
