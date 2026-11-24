# FFIM Gather: setup and technical notes

The simple how-to guide is in the [README](../README.md). This page is for whoever sets the app up and looks after it.

FFIM Gather is a map-based app that helps a church team reach every house around it, keep in touch with the people they meet and look after their members. It's built for phones and simple to use, and it keeps working when there's no signal.

## Everything it does

**Three roles, each person signs in by tapping their name** (no code for now):

| Role | Can do |
|---|---|
| **Admin** | Everything. Draws zones on the map (this sets where the church works), picks a zone pastor for each zone, adds and removes people, changes the logo and app name, finds houses anywhere, exports. |
| **Zone pastor** | Sees their zones. Adds team members to their zone, assigns houses to people with an action (first visit, follow up, member care, invite, pray) and a due day, finds houses in their zone, exports their zone. |
| **Team member** | Sees their zone and a **My tasks** list. Logs visits, adds people and houses, and drags pins to fix positions. |

**On the map**, each house is a coloured dot. Red means not evangelised, orange means a follow-up is due, yellow means checked this week (it turns orange again next Monday), green means members live there and grey means do not visit. Houses assigned to you have a ring around them.

- **Members list:** under **People**, admins and pastors tap **Add member** to put members on the list, even before their house is on the map. When adding a person to a house, start typing their name or phone number. Matching people from your list appear, and tapping **Use** links them without retyping. If you type someone new, the app offers **Add as member** afterwards.
- **Making someone a member:** tap the heart next to their name, in the house panel or under **People**. The heart turns green, their house turns green, and it joins the weekly member check-ups (**Zones → Members**). Tap again (or **Undo**) to change back. Deleting a house never deletes members; they go back to the list.
- **Tap a house** to open its panel. The first row is one-tap visit logging (Prayed, Good talk, Invited, Not home, More). The toast lets you undo or add a contact.
- **Drag the pin** of the selected house to shift it.
- **Find houses** (sparkle button) drops a pin on every home on screen or in a whole zone, one pin per building. Weak detections that aren't buildings are skipped, as are sheds and big buildings.
- **Tidy up pins** (Manage) checks existing pins: removes ones that aren't on a building or are doubled, and adds homes that were missed. Pins anyone has worked with are never removed.
- **Empty houses:** after **Not home**, tap **House is empty**, or switch on *Empty house* under Edit. The pin becomes a hollow blue ring and leaves the follow-up lists until you tap **Lived in now**.
- **Church distance:** an admin marks the church (**Manage → Church → Set on map**, or search it and tap **Set as church**). Open a house and tap **To church** to see the road distance, walking time (at about 5 km/h) and a rough driving time, with the route drawn on the map. Nothing is measured unless you ask. **Zones → Nearest to church** sorts houses by road distance.
- **Ask (AI assistant):** type or speak, for example "we prayed with Kofi today", "who is due near me?" or "assign the due houses in Dansoman to Ama". It looks things up and can log visits, add people, add houses and assign work, always showing a **Confirm** card first. Answers can be read aloud.
- **Assign** (checklist button) lets you tap several pins, then pick a person, an action and a due day.
- Logging a visit **completes your task** at that house automatically.
- **Zones tab** (admins and pastors) shows a growth bar per zone (how much has been reached), plus Due, New, Members and Assigned lists with select-all and assign.
- **Keeps working on poor signal.** Houses, people and visits are saved on the phone first and sync later.
- **Export** houses, people, members, visits and tasks to CSV, or make a full backup.
- **Logo:** your logo is built in. An admin can change it under **Manage** (tap the logo, then Change logo), and every phone and the sign-in screen update. The home-screen icon of an already-installed app keeps the built-in logo. To change that icon too, replace `public/icon-*.png` and redeploy.

---

## Set it up (about 15 minutes, all free tiers)

You need three free accounts: **GitHub**, **Neon** and **Vercel**.

### 1. Put the code on GitHub
1. Create an account at <https://github.com> and click **New repository**. Name it `ffim-gather` and make it **Private**.
2. On the new repository page, click **uploading an existing file** and drag in everything from this folder, except `node_modules`, if it exists. Click **Commit**.

### 2. Create the database (Neon)
1. Create an account at <https://neon.tech> and create a project called `ffim-gather`. Pick the region closest to your church.
2. Click **Connect** and copy the connection string. It starts with `postgresql://…`.

### 3. Put the app online (Vercel)
1. Create an account at <https://vercel.com> using **Continue with GitHub**.
2. Click **Add New → Project**, choose `ffim-gather` and click **Import**.
3. Open **Environment Variables** and add:
   | Name | Value |
   |---|---|
   | `DATABASE_URL` | the Neon connection string from step 2 |
   | `FFIM_SETUP_CODE` | *(optional)* a code needed only to create the first admin. This stops a stranger from claiming your fresh deploy first. |
4. Click **Deploy**. After a minute you'll get a link like `https://ffim-gather.vercel.app`.

> Tip: In Vercel you can instead open **Storage → Connect Database → Neon**, which fills in `DATABASE_URL` for you.

The database tables are created automatically the first time someone syncs. You don't need to do anything else.

### 4. Switch on the AI assistant (free)
1. Go to <https://console.groq.com>, sign up (no card needed), open **API Keys** and create one. In Vercel, add it as `GROQ_API_KEY`. This switches on chat and voice (Whisper speech-to-text).
2. Optional backups, used when Groq is busy: a free Gemini key from <https://aistudio.google.com> as `GEMINI_API_KEY`, and/or a free OpenRouter key from <https://openrouter.ai> as `OPENROUTER_API_KEY`.
3. Redeploy (**Vercel → Deployments → ⋯ → Redeploy**). The **Ask** tab now works.

Free limits (late 2026, they change): Groq's free plan allows roughly 1,000 chats and 2,000 voice clips a day. Gemini Flash's free tier adds a few hundred more a day. That's plenty for a church team. Chats go to these AI companies to be answered, so don't put anything in a chat you wouldn't want them to see.

### 5. Set up and get the team on
1. Open the link. You'll be asked for your name, and you become the **admin**.
2. Go to **Manage**, then **Draw zone**. Tap the corners of an area on the map, then tap the check mark. Name the zone.
3. Under **Team**, tap **+** to add zone pastors and team members. Edit a zone to pick its pastor.
4. Send the link to everyone. They tap their name to sign in, then choose **Add to Home screen** in the browser menu.

---

## Everyday use

- **Pastors:** open the **Zones** tab, then **Due** or **New**. Tap **Select all** (or tick houses), then **Assign**. Pick a person and a day.
- **Team members:** open **Tasks**, tap the arrow to navigate, knock, then tap the check and choose what happened. Done.
- When someone joins the church, open their record and switch on **Church member**. Their house turns green.

---

## Install it like an app

Once it's live on Vercel, open the site on a phone:

- **Android (Chrome, Edge, Samsung Internet):** sign in, open **Manage** and tap **Install on this phone** (or "Install app" on the sign-in screen).
- **iPhone/iPad (Safari):** tap **Share**, then **Add to Home Screen**. The app shows these two steps if you tap Install.

It then opens from its own icon, full screen, with no address bar. The address bar can't be hidden on a plain browser tab, and the install button only appears on the live https site (or localhost), not on a LAN address like 192.168.x.x.

**Syncing a lot of data:** the first sign-in on a new phone downloads everything in the person's area. With about 25,000 houses that's 5 pages, usually a few seconds. The sync button shows a percentage while it runs. If the server doesn't answer within a minute, the app stops waiting and tries again 15 seconds later, so syncing can't get stuck.

## The map and search (all open source, no API keys)

| Part | What it uses |
|---|---|
| **Map** (default) | [OpenStreetMap](https://www.openstreetmap.org) data, drawn by [OpenFreeMap](https://openfreemap.org). Shows streets, areas and landmarks such as churches, schools, shops and filling stations. Open source, free, no key, no limits. |
| **Satellite** | Esri satellite photos, with the same OpenStreetMap labels and landmarks on top. Photo dates vary by area. |
| **Search** | [Photon](https://photon.komoot.io), an open-source OpenStreetMap search made for search-as-you-type. |
| **Zone outlines** | [Nominatim](https://nominatim.org), OpenStreetMap's own place lookup. It's used only when an admin taps **Make zone** or **Use <area>**. |
| **Find houses** | [Overture Maps buildings](https://docs.overturemaps.org/guides/buildings/) (OpenStreetMap, Google Open Buildings and Microsoft footprints merged without doubles; ODbL), newest monthly release, read straight from the cloud file. Overture says these tiles are for inspection rather than production, so if they can't be reached the app falls back to [VIDA's Google-Microsoft-OSM Open Buildings](https://source.coop/vida/google-microsoft-osm-open-buildings) (CC BY 4.0 / ODbL). |
| **Road distance** | OpenStreetMap roads from the same map files. The app joins them into a walking network and runs **A\*** (one house to the church) and **Dijkstra** (all houses at once) on the phone. No routing server is needed. |
| **Directions** | Opens Google Maps navigation with a plain link (free). |

**Ghana:** OpenStreetMap is built by volunteers. Ghana is actively mapped, including by local OSM communities and the Humanitarian OpenStreetMap Team. If a street, landmark or building is missing, anyone can add it at <https://www.openstreetmap.org>, and it appears in the app after the next map update (OpenFreeMap updates weekly).

**What you can type in the search box:**
- Areas and places: *Dansoman*, *Kaneshie*, *Madina Zongo Junction*
- Landmarks: *Korle Bu*, *Accra Mall*, *Kotoka Airport*
- Coordinates: `5.6037, -0.1870` or `5°36'13.3"N 0°11'13.2"W`
- Google Maps links, including short `maps.app.goo.gl/…` links shared on WhatsApp
- Plus codes: `6CQX8F9X+8C` or `8F9X+8C Accra`
- Your own houses and people, by name, house ID or phone

GhanaPost GPS addresses (GA-123-4567) can't be looked up with open data, so paste a Google Maps link or the coordinates instead.

**Making zones:** search an area, tap it, then tap **Make zone**. The zone uses the area's official OpenStreetMap outline when one exists. Otherwise, tap the corners yourself (**Manage**, then **Draw zone**, then search to jump there).

**Fair use:** the free public Photon and Nominatim servers are shared, donated services. Search waits until you stop typing, so it doesn't send a request on every key. Area outlines are looked up only when you ask for them, which keeps the app well within their rules. Nominatim's usage policy (<https://operations.osmfoundation.org/policies/nominatim/>) allows at most 1 request per second, no bulk or automatic lookups and no search-as-you-type. That's why Photon handles the search box and Nominatim handles only one-off outlines. If your church ever runs many teams, you can host your own Photon server and set `VITE_PHOTON_URL`.

**Optional settings** (not needed): `VITE_MAP_STYLE` (another MapLibre style), `VITE_PHOTO_TILES` (another satellite source), `VITE_PHOTON_URL` (your own search server), `VITE_SEARCH_COUNTRY` (default `GH`; keeps search results local), `VITE_BUILDINGS_PMTILES` (another buildings file). For the AI: `GROQ_MODEL`, `GEMINI_MODEL` and `OPENROUTER_MODEL` choose different free models.

---

## Connecting to other systems (member management, etc.)

The data structure is built to plug into other systems:

- **Every record has a permanent UUID**, made on the phone. It never changes, even across devices.
- **Link fields:** `houses.external_ref` and `people.external_member_id` hold the ID of the same record in your member management system. Fill them in to match records.
- **Custom fields:** every table has an `extra` JSON column for new fields that don't need a database change.
- **Read API** for other platforms (admins and pastors; send `Authorization: Bearer <token>`):
  - `GET /api/export?table=houses|people|visits|tasks|zones|users&format=json|csv`
  - `GET /api/export?table=house_overview`: one row per house with status, people count, member count and last contact
- **Two-way sync API:** `POST /api/sync` with `{cursor, changes:{houses:[…], people:[…], visits:[…]}}`. Any app can use it to send and receive changes. Every change is checked against the signed-in person's role and zones.
- **Direct database:** It's plain Postgres on Neon, so tools like Metabase, Retool, Supabase or a future .NET or Node build can read the tables (`zones`, `users`, `houses`, `people`, `visits`, `tasks`) and the `house_overview` view directly.
- **To add a field everywhere**, edit `shared/model.ts`. The database column, sync and exports update automatically.

See `db/schema.sql` for the full table layout.

---

## For developers

```bash
npm install
cp .env.example .env      # add your DATABASE_URL (Neon or any Postgres)
npm run dev               # app + API on http://localhost:5173
npm run build             # production build (PWA, service worker)
npm run db:setup          # optional: create tables right now
```

| Folder | What's in it |
|---|---|
| `shared/model.ts` | The data model, colour rules and labels, shared by the app and server |
| `server/` | Sign-in and roles (`auth.ts`), permission-aware sync, export, branding, the schema and the database driver (Neon HTTP or node-postgres) |
| `api/index.ts` | The one Vercel function. `vercel.json` sends every `/api/*` address to it, which keeps the app well under the free plan's 12-function limit |
| `src/` | The React app: `db.ts` (IndexedDB/Dexie), `sync.ts`, `osm.ts` (finding buildings), `routing.ts` (A\* and Dijkstra), `assistant.ts` (AI tools and confirmations), `tiles.ts` (map layers), `geocode.ts` (search) and `components/` |
| `server/ai.ts` | AI chat with provider fallback (Groq, then Gemini, then OpenRouter) and Whisper transcription. Keys never reach phones. |

**Sync model:** offline-first. Edits go to IndexedDB and an outbox, then get pushed. Pulls fetch everything changed since a server revision cursor. When two edits conflict, the latest `updated_at` wins. Deletes are soft (`deleted = true`) so they reach every phone.

**Security note:** For now anyone with the link can sign in as anyone on the list. The server still enforces each role's permissions, but someone could tap another person's name. The backend already supports a PIN per person (`users.pin_hash`). Switching on PINs in the app is a small next step and is recommended before storing much personal data.
