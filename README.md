# VOTe 1.0 · Voice Occupational Therapy

**Speak. Structure. Document.** VOTe helps Occupational Therapists in Malaysia turn a spoken or typed session narrative (Bahasa Melayu, English or rojak) into a **draft SOAP note** that follows the KKM *Panduan Dokumentasi (Format SOAP) Perkhidmatan Terapi Cara Kerja* (2023). The therapist always reviews it, runs a Clinical Check and accepts responsibility before copying or exporting.

## Features

- **Session**: speech-to-text dictation (Web Speech API), pause/resume, extra notes, SOAP generation, edit, Clinical Check gate, copy and export to PDF, DOCX or TXT.
- **Panduan SOAP**: quick and guided modes with prompts for each S/O/A/P section.
- **OT Library**: term explanations (OTPF-4, documentation terms, DSM-5-TR overview, psychoeducation), pain-tool helper and "Explore this case".
- **Two AI modes**
  - *Automatic*: for signed-in pilot users. Generation runs server-side through Netlify AI Gateway (Claude), so no API key is needed.
  - *Copy-paste*: for everyone. The therapist copies the prompt into ChatGPT or Gemini and pastes the JSON answer back.
- **Accounts and pilot analytics**: sign up and log in with Netlify Identity. Only anonymous usage counters and feedback ratings are stored, never transcripts, SOAP content or patient data. Guests are not tracked.
- **Creator dashboard**: users with the Identity `admin` role see aggregate usage, a 14-day trend and feedback under Settings.

## Tech

- Vite with plain HTML, CSS and JavaScript (`index.html`, `src/`)
- Netlify Functions (`netlify/functions/`): `/api/ai`, `/api/usage`, `/api/admin/usage`
- Netlify Identity via `@netlify/identity`
- Netlify Database (Postgres) with Drizzle ORM (`db/schema.ts`, migrations in `netlify/database/migrations/`)
- Netlify AI Gateway with `@anthropic-ai/sdk`
- Netlify Image CDN for the logo

## Run locally

```bash
npm install
netlify dev
```

`netlify dev` provides Identity, Database, AI Gateway and the Image CDN locally.

## Setting up the admin (creator) account

1. In the Netlify dashboard open **Identity** and click **Invite users**, then enter your email.
2. Accept the invite from the email. VOTe opens and asks you to set a password.
3. In **Identity**, open your user and add the role `admin`.
4. Use **Admin Log In** on the home screen.

New sign-ups need email confirmation by default. You can change registration (open or invite-only) and autoconfirm in **Project configuration > Identity**.
