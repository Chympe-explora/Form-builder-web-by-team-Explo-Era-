# Form & Website Builder

A Google Forms–style form and mini-website builder: creators sign up,
build multi-page forms/websites with a no-code editor, publish to a
unique public link, collect responses, and manage everything from a
private dashboard.

**Architecture:** one reusable public renderer displays *any* creator's
project by loading its saved config from the API — there is no separate
codebase generated per user. Frontend hosts on GitHub Pages, the API
runs on a Cloudflare Worker, structured data lives in Cloudflare D1, and
uploaded files are stored via a Telegram bot.

## What's in this bundle

| File | Purpose |
|---|---|
| `schema.sql` | D1 tables: users, projects, responses, media |
| `CONFIG_SHAPE.md` | The JSON shape a project's pages/fields are stored as |
| `worker/index.js` | Cloudflare Worker API — auth, project CRUD, publish, public fetch-by-slug, responses, Telegram-backed media |
| `worker/wrangler.toml` | Worker config |
| `public/renderer.html` | The single public-facing renderer (deploys as `/f/index.html`) |
| `404.html` | GitHub Pages redirect so `/f/abc123` resolves to the renderer with a pretty URL |
| `admin/index.html` | The admin app — dashboard, builder, settings, media, responses |

Everything is plain HTML/CSS/JS — no build step, no npm install for the
frontend.

## Feature checklist

- [x] Multiple projects per creator, multiple pages per project
- [x] Heading, paragraph, image, image gallery, button, text/long-text,
      dropdown, checkboxes, multiple choice, date, number, email, file
      upload
- [x] Add, reorder (drag-and-drop + up/down arrows), edit, duplicate,
      hide, delete elements
- [x] Unique public URL per project (`/f/<slug>`), draft vs. published
      states, edit anytime after publishing
- [x] In-app multi-page preview before publishing (Next/Back, required-
      field validation), nothing is submitted
- [x] Independently enable/disable + retext the Next, Back, Submit,
      Copy, Download, and Upload buttons
- [x] Full text/color/font/button/layout customization from the admin
      dashboard, reflected live on the public link
- [x] Logo, banner, inline images, image galleries with reorder/caption/
      alt text; visitor file uploads when enabled
- [x] WhatsApp number + prefilled message template sent on submission
- [x] Prefilled-link generator (`?name=John&package=Adventure`) built
      into the editor
- [x] Response dashboard: search, date-range filter, detail view, CSV
      export, delete
- [x] Per-creator data isolation — every API call is scoped to the
      authenticated owner
- [x] No secrets (JWT signing key, Telegram bot token) ever touch
      frontend code

## Deploy the backend

1. `npm install -g wrangler` (if you don't have it), then `wrangler login`.
2. `wrangler d1 create form_builder_db`, copy the returned `database_id`
   into `worker/wrangler.toml`.
3. `wrangler d1 execute form_builder_db --file=schema.sql`
4. Create a Telegram bot with **@BotFather**, add it to a private
   channel/group you control, and get that chat's numeric ID (forward a
   message from the chat to **@userinfobot**, or check the Bot API's
   `getUpdates` response).
5. From `worker/`, set secrets:
   ```
   wrangler secret put JWT_SECRET
   wrangler secret put TELEGRAM_BOT_TOKEN
   wrangler secret put TELEGRAM_CHAT_ID
   ```
   `JWT_SECRET` should be a long random string — e.g. `openssl rand -hex 32`.
6. `wrangler deploy` — note the `*.workers.dev` URL it gives you.

## Deploy the renderer (with pretty `/f/abc123` URLs)

1. In `public/renderer.html`, add a script tag above the existing one:
   ```html
   <script>window.FORM_BUILDER_API_BASE = 'https://your-worker.workers.dev'</script>
   ```
2. In your GitHub Pages repo, lay it out like this:
   ```
   /404.html              ← from this bundle, repo root
   /f/index.html          ← public/renderer.html, renamed
   ```
3. That's it — no build step. When a visitor opens `/f/abc123`, GitHub
   Pages can't find a matching file (only `/f/index.html` exists), so it
   serves `404.html`. That script sees the path starts with `/f/`,
   stashes it, and redirects to `/f/index.html`, which restores the
   original `/f/abc123?...` URL in the address bar via
   `history.replaceState` before reading the slug — the visitor never
   sees the redirect and the address bar stays on the pretty link. This
   is the standard GitHub Pages SPA-routing trick, scoped to `/f/` so it
   won't swallow unrelated 404s elsewhere on the same site.
4. Visiting `/f/index.html` or `/f/` directly (no slug) shows the "not
   available" state — correct behavior, since there's no project to load.

## Deploy the admin app

1. In `admin/index.html`, add above the existing script tag:
   ```html
   <script>
     window.FORM_BUILDER_API_BASE = 'https://your-worker.workers.dev';
     window.FORM_BUILDER_PUBLIC_BASE = 'https://your-github-pages-domain/f';
   </script>
   ```
2. Host it anywhere — a private path on the same GitHub Pages site, its
   own repo (e.g. `admin.yourdomain.com`), or even opened locally for
   testing. It's a single static file with no dependencies.
3. Open it and sign up. Every project you create is scoped to your
   login only — the Worker checks `user_id` on every request, so
   creators can only ever see their own projects, media, and responses.

### Using the admin app

- **Dashboard** — create projects, see draft/published status, jump to
  the live public link, delete a project (also removes its responses
  and media).
- **Pages tab** — add pages; add elements from the type dropdown, then
  edit each element's text/label/options/required/prefill-key inline;
  drag by the ⋮⋮ handle to reorder (up/down arrows also work and are
  the reliable option on touch devices), duplicate, hide (keeps it
  saved but off the public page), or delete.
- **Theme / Buttons / WhatsApp tabs** — colors, per-button enable +
  custom text, and the WhatsApp number + `{{prefillKey}}` message
  template used when a visitor submits.
- **Media tab** — upload logos/banners/images (stored via your Telegram
  bot); copy the returned media ID into an Image element, an Image
  Gallery element (add multiple, reorder, caption, alt text), or the
  Theme tab's logo/banner fields.
- **Responses tab** — search text, filter by date range, view a
  submission's full detail, download the currently-filtered set as CSV,
  or delete a submission.
- **Preview** — steps through the actual multi-page flow (Next/Back,
  required-field validation) using your current draft — no publish
  needed, and nothing is submitted or saved. File uploads aren't
  testable in preview; check those on the published link.
- **Prefilled Link** button — pick a project, fill in whichever fields
  you want pre-populated, and it builds and copies the
  `?key=value&...` link for you from each field's Prefill key.

Every edit autosaves straight to the Worker — there's no separate
"save" step to remember.

## Security notes

- Passwords are hashed with PBKDF2-SHA256 (100,000 iterations) and a
  per-user random salt — plaintext passwords are never stored.
- Auth uses a signed JWT (HMAC-SHA256); the signing key lives only in
  the Worker's environment as a secret, never in any frontend file.
- The Telegram bot token and chat ID are Worker-only secrets. The
  public renderer and admin app only ever talk to your Worker, never to
  Telegram directly, so those credentials can't leak via the browser.
- Every authenticated endpoint checks `user_id` (or joins through the
  owning project) before returning or modifying data, so one creator
  can't read or edit another's projects, media, or responses.
- CORS is currently open (`Access-Control-Allow-Origin: *`) so the
  renderer and admin app can be hosted on any domain. If you'd rather
  lock the API to your own domains, replace that with your specific
  origins in `worker/index.js`.

## Known limitations / good next steps

- Image uploads go to a single shared Telegram chat; very high-volume
  creators may eventually want per-project or per-creator storage
  segregation.
- Deleting a project removes its D1 rows but doesn't delete the
  underlying Telegram messages — inconsequential at small scale, worth
  a cleanup job if usage grows.
- The in-app preview renders using the draft config directly rather
  than a server-side "preview" endpoint; functionally equivalent for a
  single admin session, but two people can't preview the same draft
  simultaneously and see each other's live edits.

None of these block real-world use — they're the natural next
increments once you're live and see how creators actually use it.
