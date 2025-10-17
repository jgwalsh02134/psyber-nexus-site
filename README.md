# Psyber Nexus

Production-ready, mobile-first site for Cloudflare Pages with a minimal JS layer and a secure OpenAI proxy via Pages Functions.

## Features

- Dark, IBM/CERN-inspired theme with semantic HTML and WCAG AA focus states
- Mobile-first responsive layout with sticky header and nav drawer
- Streaming AI console using Server-Sent Events against `/api/chat`
- Cloudflare Pages Functions for `/api/health` and `/api/chat`
- Strict security headers and robots/security metadata

## Structure

```text
/
├─ index.html
├─ about/index.html
├─ methods/index.html
├─ contact/index.html
├─ assets/
│  ├─ css/site.css
│  └─ js/app.js
├─ functions/
│  └─ api/
│     ├─ health.ts
│     └─ chat.ts
├─ _headers
├─ _redirects
├─ robots.txt
├─ security.txt
├─ sitemap.xml
├─ manifest.webmanifest
└─ favicon.svg
```

## Requirements

- Cloudflare Pages project
- Environment variable `OPENAI_API_KEY` (required for `/api/chat`)
- Optional `TURNSTILE_SECRET` (planned for `/api/contact`)

## Local development (optional)

You can use Wrangler to run Pages Functions locally:

```bash
npx wrangler pages dev .
```

Then visit the local preview URL shown in the terminal.

## Deployment (Cloudflare Pages)

1. Create a new Pages project in the Cloudflare Dashboard and connect this repository.
2. Build settings:
   - Framework preset: None
   - Build command: (leave empty)
   - Build output directory: / (root)
3. Add Environment Variable:
   - `OPENAI_API_KEY`: your OpenAI key
4. Deploy. After deployment, map your domain (e.g., `psyber.nexus`).

## Endpoints

- `GET /api/health` → `{ ok: true, service: "psyber-nexus", ts: "..." }`
- `POST /api/chat` → SSE stream proxy to OpenAI Chat Completions
  - Body: `{ messages: [{ role: "user", content: "..." }], model?: "gpt-4o-mini" }`

## Accessibility & Performance

- Semantic headings and landmarks, skip link, focus rings, large tap targets
- `prefers-reduced-motion` respected for smooth scrolling and animations
- Target Lighthouse (mobile): Performance ≥ 90; Accessibility ≥ 95

## Notes

- Contact form posts to `/api/contact` which is intentionally not implemented yet.
- Update `_headers` and `_redirects` as needed for your domain setup.
