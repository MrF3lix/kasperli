# Kasperli

Web UI for the [TTS API](../tts-api): a Next.js app (App Router, Tailwind, shadcn/ui) with PocketBase for accounts and kept samples.
The design is described in `tts-api/docs/auth-and-frontend.md`.

```
browser ──► Next.js ──► PocketBase   (login, users, kept samples)
                    └─► TTS gateway   (generation; forwarded with the user's PocketBase token)
```

The browser only talks to Next.js. The PocketBase token is kept in an httpOnly cookie (`pb_auth`) and never reaches page scripts.

## Layout

| Path | |
|---|---|
| `src/proxy.ts` | Redirects to `/login` without a valid-looking token, and refreshes tokens that expire within 2 days |
| `src/lib/auth.ts` | `getCurrentUser()`: checks the token against PocketBase. Call it wherever user data is read; the proxy check alone is not enough |
| `src/lib/session.ts`, `src/lib/auth-token.ts` | Reading and writing the auth cookie |
| `src/lib/pocketbase.ts` | A PocketBase client per request (server only) |
| `src/app/login/` | Login page and server action |
| `src/app/(app)/` | Pages for signed-in users |
| `src/app/api/` | Route handlers that forward to the TTS gateway (`API_URL`) with the user's token: models, jobs, progress stream, audio |
| `src/lib/gateway.ts` | The forwarding; checks the session against PocketBase (cached for 60 s per token) |
| `src/lib/speakers.ts`, `src/app/(app)/speakers/` | Saved speakers: listing, saving with deduplication, audio for previews, the Speakers page with renaming |
| `src/lib/samples.ts`, `src/app/(app)/saved/` | Kept samples: keeping and removing from the job list, the Saved page with notes |
| `src/app/(app)/record/`, `src/app/api/samples/record/` | Record page: users record themselves (16-bit mono WAV, converted in the browser), choose the dialect and check the transcript; saved as a sample with the model `recording` |
| `src/lib/stt.ts`, `src/app/api/transcriptions/` | Automatic transcripts of recordings: started as soon as a recording stops, forwarded to the STT gateway (`STT_API_URL`, model `whisper-swiss-german`) and polled until done |
| `src/lib/anonymizer.ts`, `src/app/api/anonymize/`, `src/app/(app)/anonymize/` | Anonymize page: a target recording is re-spoken in the voice of a reference (upload, recording or saved speaker) in a chosen dialect. The recording is transcribed (STT) as soon as it is added, so the transcript can be corrected first; each variant is its own job. Forwarded to the anonymizer gateway ([globi](../globi), `ANONYMIZER_URL`), polled until done; dialects come from its `/models`, falling back to the XTTS model's. Shared transcription UI: `src/components/auto-transcript.tsx`. Recent jobs are kept in the browser |
| `src/lib/datasets.ts`, `src/app/(app)/dataset/` | Datasets: created from selected samples on the Saved page, list, detail with zip download (`/api/dataset/[id]/export`), editing name, access and samples |
| `src/lib/files.ts` | Streams protected PocketBase files (speaker and sample audio) to the browser |
| `src/components/generate/` | Generate page: form, speaker upload/recording (converted to 16-bit mono WAV in the browser), job list with live progress |
| `pocketbase/pb_migrations/` | Collections and access rules. Edit the schema only through migrations |
| `scripts/create-account.mjs` | Creates users and the gateway's service account |

## Collections

| Collection | |
|---|---|
| `users` | Sign-up disabled; accounts are created by an admin. Extra fields `role` (`user`/`admin`) and `max_samples_per_job`, which users can't change themselves |
| `services` | Auth collection for the gateway's service account. Not visible to users |
| `speakers` | Reference recordings. Saved by the app when a job with a new recording is accepted, deduplicated per user by the SHA-256 of the stored WAV. Owners can rename and delete them (deletes their samples) |
| `samples` | Kept samples. The app copies a finished sample with its settings (text, dialect, model, seed) from the gateway when the user keeps it, linked to one of their own speakers. Owners can only edit `rating`, `tags`, `note` and the annotations afterwards. Recordings (model `recording`) have no speaker record, seed or job; `speaker_name` holds who recorded them, and owners can also change their transcript (`text`) and dialect |
| `datasets` | Named sets of samples. The owner and the `users` given access can view and edit them; only the owner can delete them. Samples in a dataset, and their speakers, are visible to everyone with access; users see each other's names and emails to share |
| `dataset_samples` | One record per sample in a dataset. Users can only add their own samples |
| `api_keys` | Personal API keys, stored as SHA-256 hashes |

## Development

Needs Node 24 (LTS; 22.13+ works too, odd-numbered releases like 23 don't) and Docker.

```bash
npm install
cp .env.example .env.local
```

Start PocketBase (data in `pocketbase/pb_data/`, port 8090):

```bash
npm run pb
```

On first start PocketBase prints a link for creating the first superuser, or create one directly:

```bash
docker compose -f compose.yaml -f compose.dev.yaml exec pocketbase /pb/pocketbase superuser upsert you@example.org <password> --dir=/pb/pb_data
```

Put the superuser's credentials in `.env.local` (`PB_SUPERUSER_EMAIL`, `PB_SUPERUSER_PASSWORD`), then create a user. The script prints a generated password:

```bash
npm run create-account -- user alice@example.org "Alice Example"
```

For generating, the TTS gateway must be running at `API_URL` (see the tts-api README). Start the app at http://localhost:3000:

```bash
npm run dev
```

The PocketBase dashboard is at http://127.0.0.1:8090/_/. Collection changes made there are written to `pocketbase/pb_migrations/` as new files; commit them.

Checks: `npm run lint` and `npm run typecheck`.

## Deployment

```bash
docker compose up -d --build
```

This builds and starts PocketBase and the app, both bound to localhost only (`PB_PORT`, default 8090, and `APP_PORT`, default 3000), for a reverse proxy such as Caddy in front. Settings are read from `.env` (not `.env.local`):

| Variable | |
|---|---|
| `NEXT_PUBLIC_PB_URL` | Public PocketBase URL, e.g. `https://pb.example.org`. Built into the browser bundle, so rebuild after changing it |
| `API_URL` | TTS gateway as seen from the app container (default: port 8000 on the Docker host) |
| `STT_API_URL` | STT gateway ([stt-api](../stt-api)) as seen from the app container (default: port 8020 on the Docker host). It has no authentication, so keep it off the public internet; only the app calls it |
| `ANONYMIZER_URL` | Anonymizer gateway ([globi](../globi)) as seen from the app container (default: port 8010 on the Docker host). It has no authentication either; only the app calls it |
| `PB_ENCRYPTION_KEY` | 32 random characters; encrypts PocketBase settings such as SMTP passwords |

In production, migrations are applied on start, and changes made in the dashboard don't create migration files.

The gateway logs in as a `services` record:

```bash
npm run create-account -- service gateway@tts.local "TTS gateway"
```

Before going public:

- Serve everything over HTTPS (the auth cookie is `Secure` in production).
- Block `/_/` (the PocketBase dashboard) at the reverse proxy, except from your own network, and enable MFA for superusers.
- Configure backups of the `pb-data` volume (PocketBase can also run scheduled backups itself).
- PocketBase is pre-1.0: upgrade it on purpose. Update `PB_VERSION` and the checksums in `pocketbase/Dockerfile`, and read its changelog first.
