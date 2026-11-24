# FFIM Gather - Developer README

Technical documentation for developing, deploying and extending FFIM Gather.

## Overview

FFIM Gather is an offline-first React progressive web app (PWA) with a small TypeScript HTTP API:

- **Client:** React 19, TypeScript, Vite, Leaflet/MapLibre and Dexie.
- **Local persistence:** IndexedDB through Dexie.
- **Server persistence:** PostgreSQL, typically Neon, accessed through `@neondatabase/serverless` or `pg`.
- **Deployment:** Vercel serverless functions plus a Vite static build.
- **Optional AI:** Groq, Gemini and OpenRouter chat fallback; Groq Whisper transcription.

The browser and server share the canonical model in [`shared/model.ts`](shared/model.ts). This is intentional: the same field definitions drive TypeScript types, schema creation, synchronisation and exports.

## Requirements

- Node.js with npm
- A PostgreSQL database for local API work or deployment
- Optional: a Groq, Gemini or OpenRouter API key for the assistant

## Local setup

```bash
npm install
copy .env.example .env
npm run dev
```

The development server starts the Vite client and mounts the API routes through the `devApi` plugin in [`vite.config.ts`](vite.config.ts). Open `http://localhost:5173`.

Useful commands:

```bash
npm run typecheck
npm run build
npm run preview
npm run db:setup
```

- `typecheck` runs TypeScript without emitting files.
- `build` creates the production PWA in `dist`.
- `preview` serves the production build and the API middleware.
- `db:setup` runs [`scripts/db-setup.ts`](scripts/db-setup.ts) against `.env`.

## Environment variables

Copy [`.env.example`](.env.example) to `.env`. Do not commit `.env`.

### Required

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string. Neon and standard Postgres URLs are supported. |

### Authentication

| Variable | Purpose |
|---|---|
| `FFIM_SETUP_CODE` | Optional code required when creating the first admin. |
| `FFIM_SECRET` | Optional signing secret. If omitted, one is generated and persisted in `ffim_meta`. |

### AI

| Variable | Purpose |
|---|---|
| `GROQ_API_KEY` | Enables Groq chat and Whisper voice transcription. |
| `GEMINI_API_KEY` | Optional chat fallback. |
| `OPENROUTER_API_KEY` | Optional final chat fallback. |
| `GROQ_MODEL` | Optional Groq model override. |
| `GEMINI_MODEL` | Optional Gemini model override. |
| `OPENROUTER_MODEL` | Optional OpenRouter model override. |

### Client map configuration

These are read as Vite client variables when prefixed with `VITE_`:

| Variable | Purpose |
|---|---|
| `VITE_MAP_STYLE` | Alternate MapLibre style. |
| `VITE_PHOTO_TILES` | Alternate satellite tile source. |
| `VITE_PHOTON_URL` | Alternate Photon search server. |
| `VITE_SEARCH_COUNTRY` | Search country filter; defaults to `GH`. |
| `VITE_BUILDINGS_PMTILES` | Alternate building PMTiles source. |

## Architecture

### Request flow

```text
React UI
  -> src/session.ts / src/sync.ts
  -> /api/*
  -> server/http.ts
  -> server/auth.ts, server/sync.ts, server/ai.ts, server/export.ts
  -> PostgreSQL
```

In development, Vite calls `server/http.ts` directly through the custom middleware. In Vercel, each file in [`api/`](api/) is a thin adapter around the same route handler.

### Important directories

| Path | Responsibility |
|---|---|
| [`src/`](src/) | Browser application, UI, local database, maps, routing and sync. |
| [`src/components/`](src/components/) | Feature-level React components and forms. |
| [`shared/model.ts`](shared/model.ts) | Tables, types, labels, status rules and shared permissions. |
| [`server/`](server/) | HTTP routing, auth, database access, sync, exports, branding and AI. |
| [`api/`](api/) | Vercel entry points. |
| [`db/schema.sql`](db/schema.sql) | Human-readable reference schema. |
| [`public/`](public/) | PWA icons and static assets. |
| [`vite.config.ts`](vite.config.ts) | React, PWA and local API integration. |

## Data model

The primary tables are:

- `zones` - named polygons and zone pastors;
- `users` - team members and roles;
- `houses` - geographic household records;
- `people` - contacts associated with houses;
- `visits` - outreach and care activity;
- `tasks` - assigned work and due dates.

Every synchronised row includes:

- a UUID created on the client;
- `created_at`, `updated_at` and `updated_by`;
- `deleted` for soft deletion;
- `extra` JSONB for extension fields;
- a monotonically increasing server `rev`;
- `server_updated_at`.

The `house_overview` SQL view provides a reporting-friendly house status, people counts, member counts and last contact time.

When adding a field:

1. Update `TABLES` and the corresponding TypeScript interface in [`shared/model.ts`](shared/model.ts).
2. Update the reference copy in [`db/schema.sql`](db/schema.sql) if the change is intended to be documented there.
3. Update affected forms, exports or AI tools.
4. Run `npm run typecheck` and `npm run build`.

`server/schema.ts` creates missing columns with `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, so deployed databases can migrate forward on the next request.

## Offline-first and synchronisation

### Local writes

All client writes should go through the helpers in [`src/db.ts`](src/db.ts):

1. Write to the relevant Dexie table.
2. Add or update an `outbox` row keyed as `${table}:${id}`.
3. Notify local subscribers.
4. Let `src/sync.ts` send the change later.

Do not write directly to a table from a feature component unless there is a specific migration or import reason.

### Push and pull

`syncNow()` sends up to 1,000 pending outbox entries per table and includes the current server cursor. The server:

- authorises the caller and restricts rows to their zones;
- applies incoming changes;
- returns rows changed after the cursor;
- returns a new cursor and a scope identifier.

The client deletes an outbox entry only when the local row still has the timestamp that was sent. This prevents a newer local edit from being lost while an older request is in flight.

Incoming rows are applied only when there is no pending local edit and the incoming `updated_at` is at least as new as the local row. Deletes are soft deletes so they propagate to other devices.

Automatic sync runs:

- on app open;
- after local changes, with a short debounce;
- when the browser returns online;
- when the document becomes visible;
- every 60 seconds.

If the server reports a different scope, the client retains unsent edits, clears out-of-scope records and downloads the new scope from cursor zero.

## Authentication and permissions

Authentication is implemented in [`server/auth.ts`](server/auth.ts):

- the first setup creates an admin;
- the sign-in list exposes active team names and roles;
- login returns a signed bearer token;
- tokens expire after 180 days;
- token versions invalidate sessions when a user is deactivated;
- optional PINs are stored as salted `scrypt` hashes.

Roles are:

| Role | Scope |
|---|---|
| `admin` | All zones and administrative actions. |
| `pastor` | Their assigned zone plus zones where they are pastor. |
| `member` | Their assigned zone and personal tasks. |

Keep the permission rules in [`shared/model.ts`](shared/model.ts) and the server enforcement in [`server/sync.ts`](server/sync.ts) aligned. Client-side hiding is only a UX feature; the server must remain authoritative.

## API surface

All API routes are dispatched by [`server/http.ts`](server/http.ts). Authenticated routes expect `Authorization: Bearer <token>`.

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/health` | Health and database configuration check. |
| `GET` | `/api/branding` | Read workspace branding. |
| `GET` | `/api/auth/team` | List active names for sign-in. |
| `POST` | `/api/auth/setup` | Create the first admin. |
| `POST` | `/api/auth/login` | Sign in by user ID and optional PIN. |
| `GET` | `/api/auth/me` | Return the authenticated profile. |
| `POST` | `/api/sync` | Push local changes and pull server changes. |
| `POST` | `/api/users` | Create or update a team member. |
| `POST` | `/api/branding` | Update branding with permission checks. |
| `GET` | `/api/export` | Export permitted tables as JSON or CSV. |
| `GET` | `/api/assistant-status` | Report configured AI capabilities. |
| `POST` | `/api/assistant` | Send a chat/tool-calling request to the AI fallback chain. |
| `POST` | `/api/transcribe` | Transcribe a base64 audio clip with Groq Whisper. |
| `GET` | `/api/resolve-link` | Resolve supported shared map links. |

The sync payload is shaped like:

```json
{
  "cursor": 123,
  "changes": {
    "houses": [],
    "people": [],
    "visits": [],
    "tasks": [],
    "zones": []
  }
}
```

## Maps, buildings and routing

- [`src/tiles.ts`](src/tiles.ts) loads the base and satellite map layers.
- [`src/geocode.ts`](src/geocode.ts) handles search, coordinates, Plus Codes and map links.
- [`src/osm.ts`](src/osm.ts) reads building data from PMTiles and creates candidate homes.
- [`src/routing.ts`](src/routing.ts) builds a local road graph and calculates routes/distances.

The app intentionally avoids a paid routing backend. Road distance is calculated locally from downloaded OpenStreetMap road tiles using A* for a single route and Dijkstra for multiple destinations.

Respect the usage policies of public map and geocoding services. Search is debounced and Nominatim is used for one-off area outlines rather than continuous search.

## AI assistant

[`server/ai.ts`](server/ai.ts) keeps provider keys on the server and tries configured providers in this order:

1. Groq
2. Google Gemini
3. OpenRouter

The browser-side assistant in [`src/assistant.ts`](src/assistant.ts) supplies read and mutation tools. Mutation tools are surfaced to the user as confirmation actions before client-side writes run.

Do not put provider keys in `VITE_` variables. They must never be shipped to the browser.

## Deployment

Vercel uses [`vercel.json`](vercel.json):

- build command: `npm run build`;
- output directory: `dist`;
- API functions under `api/`;
- non-API routes rewrite to `index.html`.

Recommended deployment sequence:

1. Push the repository to a private Git provider.
2. Import it into Vercel.
3. Set `DATABASE_URL` and, before first use, `FFIM_SETUP_CODE`.
4. Add AI keys only if the assistant is wanted.
5. Deploy and check `/api/health`.
6. Open the app and create the first admin.
7. Draw zones and add the team.

The server creates or updates the schema on the first database-backed request. [`npm run db:setup`](package.json) is useful for explicit provisioning and local verification.

## Testing and verification

There is currently no committed test suite. Before opening a pull request, run:

```bash
npm run typecheck
npm run build
```

For changes affecting sync, permissions or schema, manually verify:

- sign-in and sign-out;
- admin, pastor and member visibility;
- offline create/edit followed by reconnect;
- conflict behaviour when a row changes on two clients;
- soft deletion propagation;
- export permissions;
- first-run schema creation on an empty database.

## Security and operational notes

- Do not commit `.env` or provider credentials.
- Use a private deployment and restrict database access.
- The server is the authority for role and zone permissions.
- PIN support exists and should be enabled before storing significant personal data.
- AI requests can leave the deployment and be processed by the selected provider.
- Public map and search providers can be unavailable or incomplete.
- `CORS` is currently permissive in [`server/http.ts`](server/http.ts); tighten it if the deployment is exposed beyond the intended app origin.

## Contribution checklist

Before merging a change:

1. Keep browser and server types in sync.
2. Route all local writes through the Dexie/outbox helpers.
3. Enforce new permissions on the server.
4. Preserve offline behaviour.
5. Avoid exposing secrets through `VITE_` variables.
6. Run `npm run typecheck` and `npm run build`.
7. Update [README.md](README.md) for user-visible behaviour and this file for implementation changes.
