# Field Defibrillators — Pro Bono
### דפיברילטורים בשטח — מיזם התנדבותי

A real-time map of **mobile** defibrillators, with a hybrid alerting system that keeps working
where the cellular network does not: a **433 MHz LoRa mesh** built on the Meshtastic protocol.

Final project — Full-Stack Web Development, Afeka College of Engineering.

> **Just want to run it and drive it?** See the **[Operating Guide](OPERATING.md)** — startup,
> every screen explained, data management, a demonstration script and troubleshooting.
> This file covers the architecture, the database design and the LoRa theory.

---

## Table of contents

1. [The problem](#1-the-problem)
2. [The solution](#2-the-solution)
3. [Architecture](#3-architecture)
4. [Why two databases](#4-why-two-databases)
5. [Technology stack](#5-technology-stack)
6. [Installation](#6-installation)
7. [Running the project](#7-running-the-project)
8. [Project structure](#8-project-structure)
9. [API reference](#9-api-reference)
10. [Authentication design](#10-authentication-design)
11. [LoRa — the theory behind the integration](#11-lora--the-theory-behind-the-integration)
12. [What is real and what is simulated](#12-what-is-real-and-what-is-simulated)
13. [Requirements traceability](#13-requirements-traceability)
14. [Troubleshooting](#14-troubleshooting)

---

## 1. The problem

Sudden cardiac arrest is a race against the clock. Without defibrillation, the chance of survival
drops by roughly 7–10% for every minute that passes; the commonly cited **"golden window" is
0–4 minutes**. An ambulance rarely reaches a forest trail, a bike path or a ridge line in four
minutes — but another cyclist, a runner or a hiker carrying a portable AED very often is already
within that radius.

Two things stand between that person and the casualty:

1. **Nobody knows they are there.** Portable defibrillators are invisible: they are in a backpack,
   not on a public map.
2. **You cannot call them.** Exactly where the ambulance cannot reach, the cellular network usually
   cannot either. A push notification or an SMS to someone with no signal is a message that is
   never delivered.

Israel's Magen David Adom publishes an excellent map of **fixed** public defibrillators — this
project links to it prominently and is designed to complement it, not to replace it. Fixed devices
solve the shopping-mall case. They do not solve the trail case.

## 2. The solution

Volunteers who carry a portable AED register on the site (no password, no account — see
[requirement 15](#13-requirements-traceability)). Their devices report their position periodically.
When a distress call is raised, the system samples the registered responders inside a configurable
radius and reaches each of them on **whichever channel can actually deliver**:

| Situation | Channel used | What arrives |
|---|---|---|
| Has cellular coverage | **SMS / cellular** | A message with the casualty's location and phone number |
| No coverage, owns a LoRa node | **LoRa mesh (433 MHz)** | A packet that hops between nodes to their device, which beeps and blinks |
| No coverage, no LoRa node | **Unreachable** | Nothing — and the system says so, on screen, on purpose |

That third row is not an oversight. It is displayed deliberately in the UI, because the empty seat
is the entire argument for owning a LoRa node.

Selected responders receive **bicycle navigation** to the scene — routed on actual cycle paths, not
a straight line across a river.

## 3. Architecture

Three processes, each with one responsibility and its own reason to exist.

```
┌─────────────────────────────────────────────────────────────┐
│  BROWSER  (Hebrew / RTL)                                    │
└───┬─────────────────────┬───────────────────┬───────────────┘
    │ HTML / SSR          │ REST + JWT        │ WebSocket (live alert)
    ▼                     ▼                   ▼
┌─────────────┐   ┌──────────────────┐  ┌──────────────────────┐
│  web  :3000 │   │  api      :4000  │  │  mesh        :5000   │
│  Next.js    │   │  Node + Express  │  │  Node + Express + ws │
│  React      │   │  Identity &      │  │  Dispatch &          │
│  Tailwind   │   │  Registry        │  │  Telemetry           │
└─────────────┘   └────────┬─────────┘  └──────────┬───────────┘
                           │  internal REST        │
                           │  (x-service-key)      │
                           │◄──────────────────────┤
                           ▼                       ▼
                    ┌─────────────┐        ┌──────────────┐
                    │  MySQL 8    │        │  MongoDB     │
                    │  (SQL)      │        │  (NoSQL)     │
                    └─────────────┘        └──────────────┘
```

**`api` (:4000)** — the Express server required by the assignment. It owns the relational data:
admins, sessions, registered responders, their equipment, and the admin-editable site content.
It never opens a MongoDB connection.

**`mesh` (:5000)** — the second server. It owns the document data: position heartbeats, alert
documents, and the radio event log. It also hosts the WebSocket that drives the emergency page.
It never opens a MySQL connection.

**`web` (:3000)** — Next.js. No database access at all; it talks to the two servers over HTTP.

### The dispatch flow

This is the sequence worth understanding, because it is where both databases and both servers
meet in a single user action:

```
1. mesh   $geoNear on `telemetry`      →  each responder's LATEST fix, then the radius
2. mesh → api   GET /internal/responders?ids=…   →  turn those ids into names, phones, equipment
3. mesh   choose a channel per responder          →  LORA / SMS / NONE
4. mesh   GET a bicycle route for the chosen one  →  BRouter, trekking profile
5. mesh   write the alert document, then stream the propagation over the WebSocket
```

Step 2 is a **cross-database join performed at the service layer**. Splitting the data was a
deliberate choice, so owning the join is the price of that choice — it costs exactly one HTTP
request per alert, not one per responder.

The same join runs in the **opposite direction** for the admin panel: registrations come out of
MySQL, and `api` asks `mesh` (`GET /internal/last-seen`) when each of those devices last
transmitted, so the maintenance screen can show a "שידור אחרון" column. One request per page of
20 rows, not one per row. That call degrades on purpose — if `mesh` is unreachable the admin panel
still lists and edits registrations, and simply reports the telemetry column as unavailable.
Managing registrations is pure MySQL work and must not stop because the telemetry service is down.

## 4. Why two databases

> **SQL stores *who and what*. NoSQL stores *when and where*.**

**MySQL** holds data whose rows reference each other and must stay consistent:

- `phone` and `lora_id` need **UNIQUE** constraints — one number, one volunteer.
- `devices` needs a **FOREIGN KEY with ON DELETE CASCADE** — equipment cannot outlive its owner.
- Eligibility validation is a **JOIN**, not an `if`.
- Registering a responder together with their devices is a **transaction** — a responder stored
  without equipment would be invisible to the dispatcher.

**MongoDB** holds data that is time-series, geographic, or variably shaped:

- `telemetry` is queried geographically. A **2dsphere index** with `$geoNear` answers
  *"who is within 1500 m of this point?"* inside the database. In SQL we would pull rows out and
  compute haversine distances in JavaScript.
- `alerts` contains nested arrays (`candidates`, `timeline`) of unknown length — three more tables
  and three more joins in a relational schema.
- `mesh_events` is an append-only log where a LoRa hop carries `rssi`/`snr` and an SMS delivery
  carries neither. A document store absorbs that without a migration.

Neither database uses an ORM. `mysql2` with hand-written parameterised SQL, and the official
`mongodb` driver with visible pipelines — every query in this project is readable and explainable.

## 5. Technology stack

| Layer | Choice | Note |
|---|---|---|
| Language | JavaScript (ESM) | `"type": "module"` in every package |
| Frontend | Next.js 15 (App Router) + React 19 | Server components where there is no state |
| Styling | Tailwind CSS 3.4 | The only stylesheet is `globals.css` |
| Backend | Node.js + Express 4 (×2 servers) | |
| Auth | `jsonwebtoken` + `bcryptjs` | Access + refresh, with a revocation whitelist |
| SQL | MySQL 8 via `mysql2/promise` | No ORM |
| NoSQL | MongoDB 7 via the official driver | 2dsphere geospatial index |
| Realtime | `ws` | Attached to the same HTTP server |
| Maps | Leaflet + OpenStreetMap | No API key, no billing account |
| Routing | BRouter (`trekking` profile) | Free, keyless, real cycle paths |

**Deliberately not used:** no ORM, no `react-leaflet`, no component library, no CSS framework other
than Tailwind, no Google Maps or Mapbox key. Everything a reader sees is either standard library,
one of the packages above, or code in this repository.

## 6. Installation

### Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Node.js | 18 or newer | Tested on 24. Needs global `fetch` and `crypto.randomUUID` |
| MySQL | 8.x | XAMPP / WAMP / a standalone server all work |
| MongoDB | 6.x or 7.x | `winget install MongoDB.Server` on Windows |

### Steps

```bash
git clone <your-repository-url>
cd Shohat
npm run install:all
```

Create the three environment files from their templates:

```bash
cp api/.env.example api/.env
cp mesh/.env.example mesh/.env
cp web/.env.local.example web/.env.local
```

On Windows PowerShell:

```powershell
Copy-Item api\.env.example api\.env; Copy-Item mesh\.env.example mesh\.env; Copy-Item web\.env.local.example web\.env.local
```

Then open `api/.env` and set `MYSQL_PASSWORD` to your MySQL root password (XAMPP and WAMP both
default to an empty password, in which case leave it blank).

> **Two values must match between the two files:** `INTERNAL_SERVICE_KEY` in `api/.env` and in
> `mesh/.env`. That shared secret is what lets the mesh service call `/internal/*`. If they differ,
> every dispatch fails with `502` and the emergency page reports that the registry is unavailable.

Create the tables, then fill both databases:

```bash
npm run db:schema
npm run seed
```

`db:schema` creates the `field_defib` database and its six tables. `seed` writes ~50 responders and
their equipment into MySQL, plus position heartbeats into MongoDB, and creates the admin account.
It is **idempotent** — it clears what it seeded before seeding again, so you can re-run it freely.

## 7. Running the project

```bash
npm run dev
```

One command starts all three processes with colour-coded logs:

| Service | URL |
|---|---|
| Website | http://localhost:3000 |
| Identity & Registry API | http://localhost:4000 |
| Dispatch & Telemetry API | http://localhost:5000 |

To run one service on its own: `npm run dev:api`, `npm run dev:mesh`, `npm run dev:web`.

### Admin credentials

```
username: micha
password: 1234
```

Set in `api/.env` and stored in the database as a **bcrypt hash** — the plain password exists
nowhere in the schema, and the seed script cannot read it back either.

### A five-minute tour

1. **http://localhost:3000** — the landing page: the three-line LoRa explainer, the flow diagram,
   and live counters read from MySQL.
2. **`/simulator`** — click anywhere on the map to move the casualty, set the **radius**, then press
   *שגרו קריאת מצוקה*.
3. You land on **`/emergency`** and watch the propagation arrive live over the WebSocket: gateway
   transmission, each responder notified by LoRa or SMS, the unreachable ones, and finally the
   selected responder's bicycle route drawn on the map.
4. **`/admin`** — log in and edit the marketing copy, then reload the landing page and watch it
   change. Search, edit and delete registrations.

## 8. Project structure

```
Shohat/
├─ package.json               concurrently — one `npm run dev` for everything
├─ readme.md                  this file
│
├─ api/                       Identity & Registry      :4000
│  ├─ server.js               middleware order, CORS, route mounting
│  ├─ db/
│  │  ├─ schema.sql           the relational schema, commented table by table
│  │  ├─ pool.js              connection pool, query(), withTransaction()
│  │  └─ applySchema.js       `npm run db:schema`
│  ├─ lib/
│  │  ├─ tokens.js            sign / verify / hash / cookie options
│  │  └─ validate.js          registration rules, phone + LoRa id normalisation
│  ├─ middleware/
│  │  ├─ verifyJwt.js         the guard on /admin
│  │  ├─ serviceKey.js        the guard on /internal
│  │  └─ common.js            logger, asyncHandler, 404, error handler
│  └─ routes/                 auth · responders · admin · content · internal
│
├─ mesh/                      Dispatch & Telemetry     :5000
│  ├─ server.js               http.createServer so HTTP and WS share the port
│  ├─ db/mongo.js             connection + index creation on startup
│  ├─ lib/
│  │  ├─ dispatch.js          THE DISPATCH ENGINE — read this one first
│  │  ├─ realtime.js          WebSocket hub, subscriptions, heartbeat
│  │  └─ routing.js           BRouter bicycle routing + haversine fallback
│  ├─ middleware/common.js    logger, asyncHandler, 404, error handler
│  └─ routes/                 alerts · telemetry · route
│
├─ web/                       Next.js front end        :3000
│  ├─ app/
│  │  ├─ layout.js            <html lang="he" dir="rtl">
│  │  ├─ page.js              landing page (server component)
│  │  ├─ register/            registration form
│  │  ├─ simulator/           the red button
│  │  ├─ emergency/           the live dispatch console
│  │  ├─ buy/                 LoRa vendors, 433 MHz warning
│  │  └─ admin/               guard, login, three management tabs
│  ├─ components/             Header · Footer · MapCanvas · WorkflowDiagram
│  └─ lib/
│     ├─ api.js               fetch client for both servers + silent refresh
│     ├─ auth.js              admin session context
│     ├─ useAlertSocket.js    the WebSocket hook
│     ├─ server-data.js       server-side loading with graceful fallbacks
│     └─ config.js            URLs, defaults, channel vocabulary
│
└─ scripts/seed.js            fills BOTH databases in one pass
```

## 9. API reference

### `api` — http://localhost:4000

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/auth/login` | — | Returns an access token + sets the refresh cookie |
| POST | `/auth/refresh` | cookie | Rotates the refresh token, returns a new access token |
| POST | `/auth/logout` | cookie | Revokes the session |
| GET | `/auth/me` | Bearer | Confirms the token is still valid |
| POST | `/responders` | — | **Public registration** (no password) |
| GET | `/responders/phone-taken` | — | Live availability check for the form |
| GET | `/responders/stats` | — | Aggregate counters for the landing page |
| GET | `/content/:pageKey` | — | Admin-editable copy for one page |
| GET | `/content/links/:category` | — | `BUY_LORA` \| `OFFICIAL_MAP` \| `LEARN` |
| GET | `/admin/responders` | Bearer | Search + paging over the registration database |
| PATCH | `/admin/responders/:id` | Bearer | Edit a registration |
| DELETE | `/admin/responders/:id` | Bearer | Delete (devices cascade) |
| PUT | `/admin/content/:page/:section` | Bearer | Save a content block |
| POST/PATCH/DELETE | `/admin/links/:id?` | Bearer | Manage external links |
| GET | `/internal/responders` | service key | **Server-to-server** id → person |
| GET | `/internal/last-seen` | service key | *(on mesh)* **Server-to-server** id → last transmission |

### `mesh` — http://localhost:5000

| Method | Path | Purpose |
|---|---|---|
| POST | `/alerts` | Raise a distress call — the dispatch engine entry point |
| GET | `/alerts` | Recent calls |
| GET | `/alerts/:alertId` | One call with candidates, route and timeline |
| GET | `/alerts/:alertId/events` | The raw radio log behind the timeline |
| GET | `/internal/last-seen` | **Server-to-server** — when did these devices last transmit? (service key) |
| POST | `/telemetry` | One device heartbeat (what a real gateway would send) |
| GET | `/telemetry/latest` | Newest position per **currently transmitting** device, plus counts of those withheld as silent |
| GET | `/route` | Bicycle routing proxy |
| GET | `/maintenance/alerts` | Devices currently below the battery threshold |
| GET | `/maintenance/history` | Open and resolved alerts, the audit trail |
| POST | `/maintenance/reconcile` | Re-evaluate every device from its latest heartbeat (idempotent) |

WebSocket: connect to `ws://localhost:5000`, send `{"type":"SUBSCRIBE","alertId":"ALR-…"}`, then
receive `TIMELINE`, `ROUTE` and `DONE` frames as the alert propagates.

## 10. Authentication design

```
LOGIN
  password ──bcrypt.compare──► admins.password_hash
       │
       ├──► ACCESS TOKEN   15 min   JSON body      → kept in React memory
       └──► REFRESH TOKEN   7 days  httpOnly cookie → SHA-256 hash stored in DB

EVERY ADMIN REQUEST      Authorization: Bearer <access token>

WHEN IT EXPIRES (401 TOKEN_EXPIRED)
  POST /auth/refresh  ─► signature check
                      ─► whitelist check in refresh_tokens
                      ─► ROTATION: old row revoked, new token issued
```

Design decisions, and the reasoning behind each:

- **The access token lives in a JavaScript variable, not `localStorage`.** Any injected script can
  read `localStorage`. A module variable dies with the tab, and the session is restored silently
  from the cookie on the next load.
- **The refresh token is `httpOnly`, `sameSite=strict`, `path=/auth`.** The page's JavaScript cannot
  read it at all, and it is not attached to cross-site requests, which is the CSRF defence.
- **Only a SHA-256 hash of it is stored.** A leak of the `refresh_tokens` table hands an attacker
  nothing usable. bcrypt is used for passwords (low entropy, worth slowing down) but not here — a
  signed random token is not brute-forceable, and this hash is computed on every silent refresh.
- **Rotation with reuse detection.** Each refresh revokes the old row and issues a new one.
  If a token that was *already rotated away* is presented, that means either theft or a stale tab —
  so **every** session belonging to that admin is revoked immediately.
- **Login never distinguishes "no such user" from "wrong password."** Different messages would let
  an attacker enumerate valid usernames.
- **The front end shares one in-flight refresh promise.** Three simultaneous `TOKEN_EXPIRED`
  responses must not trigger three refreshes — the second and third would present a token the first
  already rotated, and the server would correctly treat that as a replay.

## 11. LoRa — the theory behind the integration

### What LoRa actually is

**LoRa** ("Long Range") is a *physical layer* radio modulation developed by Semtech. It uses
**Chirp Spread Spectrum (CSS)**: instead of encoding bits by shifting amplitude or phase at a fixed
frequency, each symbol is a *chirp* — a signal that sweeps across the channel bandwidth. Spreading
the energy across a wide band and a relatively long time makes the signal remarkably robust: a LoRa
receiver can demodulate a transmission that is **below the noise floor**, tens of dB weaker than
anything a conventional narrowband receiver could recover.

That property is the whole story. It buys enormous **link budget** — and therefore range — and pays
for it with **data rate**.

| Parameter | Typical value | Consequence |
|---|---|---|
| Spreading factor | SF7 … SF12 | Higher SF = longer range, slower, longer airtime |
| Bandwidth | 125 / 250 / 500 kHz | Narrower = more range, less throughput |
| Data rate | ~0.3 – 27 kbit/s | Text, not voice; certainly not video |
| Range (urban) | ~1 – 3 km | Buildings and foliage dominate |
| Range (line of sight) | 10 km and beyond | Ridge to ridge is the best case |
| Power draw | Milliwatts, in bursts | A node runs for days on a small battery |

A LoRa link is therefore useless for a phone call and perfect for a coordinate.

### Why 433 MHz specifically

LoRa hardware is sold for several bands, and **the band is a hardware property, not a setting**:
433, 868 and 915 MHz radios are physically different modules. A 868 MHz device will never hear a
433 MHz device — which is why the purchase page in this project warns about it as loudly as it does.

433 MHz (the 433.05–434.79 MHz ISM segment) is the band used for this project's region. Lower
frequency means longer wavelength, which diffracts around obstacles and penetrates vegetation
better than 868 or 915 MHz — exactly the terrain this system targets. The trade-offs are a smaller
antenna-efficiency-to-size ratio at practical antenna lengths, and a busier band: 433 MHz ISM is
shared with car key fobs, weather stations and (overlapping) the 70 cm amateur band, so ISM users
must tolerate interference from other legitimate users.

> **Regulatory note.** ISM operation is subject to transmit-power and duty-cycle limits set by the
> national regulator (in Israel, the Ministry of Communications). Duty-cycle limits in particular
> constrain how often a node may transmit. Anyone deploying real hardware should verify the current
> rules rather than rely on this document.

### How Meshtastic turns radios into a network

Raw LoRa gives you a point-to-point link. **Meshtastic** is the open-source firmware that turns a
collection of those links into a self-organising **mesh**:

- Every node is both an endpoint and a repeater. There is no base station and no infrastructure.
- A packet is **flooded**: a node that receives a packet it has not seen before rebroadcasts it.
- Loops are prevented by a **hop limit** (typically 3, configurable) and by **deduplication** on a
  packet id, so a packet is relayed once per node and then dies.
- Traffic on a channel is **encrypted with AES-256** using a pre-shared key, so anyone without the
  channel key hears noise.
- Payloads are small — on the order of ~200 bytes — which fits a position report with room to spare.
- Nodes broadcast periodic **position and telemetry** packets, which is precisely the `telemetry`
  collection in this project's MongoDB.

Note that Meshtastic is **not LoRaWAN**. LoRaWAN is a star topology that requires gateways and a
network server; Meshtastic is peer-to-peer and needs nothing but the devices themselves. For a
group of cyclists on a trail, that distinction is the difference between "works" and "does not."

### Why this fits emergency alerting so well

The message this system needs to deliver is a **latitude, a longitude and an identifier** — a few
dozen bytes, sent rarely, that must arrive where there is no infrastructure. That is the exact shape
of problem LoRa was designed for. A cardiac-arrest alert is small, urgent, infrequent, and worthless
if it depends on a cell tower that is not there.

The honest limitations, which belong in any defence of this design:

- **Latency is seconds, not milliseconds.** Airtime at high spreading factors plus per-hop relaying
  means a mesh delivery can take several seconds. Against a four-minute window, acceptable.
- **Delivery is not guaranteed.** Flooding is best-effort. There is no ACK from an unknown recipient.
- **Density is required.** A mesh with one node is a radio talking to itself. Coverage improves
  quadratically with adoption, which is why the site markets the hardware at all.
- **It is a complement, not a replacement.** The system states plainly on every page that it does
  not replace calling 101.

### How the two channels are chosen

The decision is made per responder, per alert, from data — not from a random number:

```js
function chooseChannel({ hasLora, cellCoverage }) {
  if (cellCoverage) return 'SMS';    // location + casualty's phone number
  if (hasLora)      return 'LORA';   // 433 MHz mesh reaches them anyway
  return 'NONE';                     // shown deliberately: this is the gap LoRa closes
}
```

`cellCoverage` is stored on the **telemetry document**, not on the responder, because coverage is a
property of *where someone is*, not of *who they are*.

### "Recently transmitting" is one rule, applied everywhere

A device only exists to the system if it has broadcast within
`MAX_HEARTBEAT_AGE_MIN` (default **180 minutes**, set in `mesh/.env`). That threshold lives in
`mesh/lib/freshness.js` and is imported by both the map endpoint and the dispatch engine, so the
two can never disagree — **a device the map draws as present is always a device the dispatcher is
willing to send**, and a silent one is neither drawn nor dispatched. `GET /telemetry/latest`
reports the withheld devices as a count rather than dropping them silently, so the simulator can
say "50 of 51 transmitting" instead of quietly showing one dot fewer than the database holds.

Order of operations matters here, and getting it backwards is a subtle trap. The pipeline reduces
each responder to their **latest** heartbeat *first*, and only then applies the radius:

```js
{ $geoNear: { …, query: { ts: { $gte: cutoff } } } },  // no maxDistance - see below
{ $sort:  { ts: -1 } },
{ $group: { _id: '$responderId', latest: { $first: '$$ROOT' } } },
{ $replaceRoot: { newRoot: '$latest' } },
{ $match: { distanceM: { $lte: radiusM } } },          // radius vs. the CURRENT position
```

Putting `maxDistance` inside `$geoNear` would filter individual *heartbeats* rather than
*responders*. A volunteer who was beside the casualty an hour ago but has since ridden five
kilometres away would keep their old in-radius heartbeat, lose their newer out-of-radius one, and
be dispatched as though standing on the scene. `$geoNear` annotates every heartbeat with its own
`distanceM`, so filtering after the `$group` measures where each responder actually is now.

### Low-battery maintenance alerts

A defibrillator that is present but flat is worse than none at all — the map shows a rescuer who
cannot rescue. When a heartbeat reports a battery below **20%** (`LOW_BATTERY_THRESHOLD`), the mesh
service raises a maintenance alert and sends the owner a simulated SMS asking them to charge the
unit *before* anyone needs it.

The state machine, in `mesh/lib/maintenance.js`:

```
drops below 20%   ->  OPEN alert created, owner notified ONCE
stays below 20%   ->  existing alert updated, NO second notification
recovers to >=20% ->  alert RESOLVED, kept for the audit trail
```

Deduplication is the point. A LoRa node reports every few minutes, so a naive implementation would
text the owner dozens of times before the battery died. "At most one OPEN alert per responder per
type" is enforced by a **unique partial index** in MongoDB rather than by a check-then-insert in
application code, so even two simultaneous heartbeats cannot produce two notifications.

Note the split: the low-battery *status* shown in the UI is **derived on read** (`batteryLevel <
threshold`, always current), while an alert *record* is written only when a notification actually
goes out. Storing the status as well would give two sources of truth that could disagree.

Because `scripts/seed.js` writes telemetry straight into MongoDB rather than through
`POST /telemetry`, seeded low batteries never pass the ingest hook — so the seed finishes by calling
`POST /maintenance/reconcile`, which brings the alert table in line with the current telemetry. It
is idempotent.

### Device health drives selection, not just display

Every telemetry heartbeat also carries two independent readings (Requirement #1):

- **`batteryLevel`** (0–100%) — the radio/phone's own battery.
- **`isOperational`** — whether the **defibrillator itself** passed its self-test, `null` when the
  responder carries no AED at all. It is deliberately decoupled from `batteryLevel`: a fully charged
  phone can be paired with an AED that has expired pads or failed diagnostics, and the reverse is
  just as true.

Both live in MongoDB, not MySQL, for the same reason position does: they change over time and are
only meaningful alongside the broadcast timestamp they were measured at, not as a static property
of the responder's registration row.

`isOperational` is not decoration — it changes who gets selected. `mesh/lib/dispatch.js` scores each
reachable candidate before picking who to route to:

```js
const score = (c) => (c.hasAed ? (c.isOperational === false ? 1 : 2) : 0);
```

An AED confirmed broken outranks having no AED at all (a responder can still start CPR), but is
deliberately ranked **below** an operational one regardless of distance — the system will pass over
the nearest responder in favour of a farther one whose defibrillator actually works. When no
operational AED is reachable and the algorithm has to fall back to a broken one, the emergency page
shows an explicit warning rather than presenting it as a normal dispatch.

## 12. What is real and what is simulated

Requirement 1 of the assignment is that the scenario is a **web simulator** — no radio hardware is
submitted. Being precise about the boundary matters more than blurring it:

| Component | Status |
|---|---|
| Both databases, schema, indexes, queries | **Real** |
| JWT authentication with rotation and revocation | **Real** |
| Registration, validation, admin CRUD | **Real** |
| Geospatial radius search (`$geoNear`, 2dsphere) | **Real** |
| Cross-database, cross-service join | **Real** |
| WebSocket streaming to the browser | **Real** |
| Bicycle routing on actual cycle paths | **Real** (BRouter, live external service) |
| Map and tiles | **Real** (OpenStreetMap) |
| Device positions and heartbeats | **Seeded** — written by `scripts/seed.js`, in the exact format a real gateway would POST |
| Device health (`batteryLevel`, `isOperational`) | **Seeded**, but the dispatch decision it drives is **real** — see below |
| Radio propagation, hop counts, RSSI/SNR | **Simulated** — plausible values written to `mesh_events` |
| SMS delivery | **Simulated** — no message is sent to any carrier |
| LoRa downlink (beep/blink) | **Simulated** — a document plus a WebSocket frame |

The simulated parts all sit behind the same interfaces the real ones would use. `POST /telemetry` is
the endpoint a Meshtastic gateway would call; the seed script calls it in the same shape. Replacing
the simulation with hardware would mean pointing a real gateway at that endpoint — not rewriting
the system.

## 13. Requirements traceability

| # | Requirement | Where it lives |
|---|---|---|
| 1 | Web-based simulator, no hardware; device health (`batteryLevel`, `isOperational`) | `mesh/lib/dispatch.js` → `simulatePropagation()`, `score()` |
| 2 | Hebrew, right-to-left by default | `web/app/layout.js` — `<html lang="he" dir="rtl">` |
| 3 | Convenient admin panel | `web/app/admin/` — three tabs |
| 4 | 3-line LoRa explainer + flow diagram | `web/app/page.js`, `web/components/WorkflowDiagram.js` |
| 5 | Prominent emergency page | `web/app/emergency/page.js` |
| 6 | Registration fields, last name optional | `api/db/schema.sql` → `responders` |
| 7 | Responsive, Tailwind only | mobile-first; `globals.css` is the only stylesheet |
| 8 | Eligibility validation | `devices` table + `api/lib/validate.js` |
| 9 | ~50 seeded users, random sampling, last broadcast time | `scripts/seed.js`, `$sample`, `lastSeenMinutes` |
| 10 | Radius parameter + bicycle routing | `$geoNear maxDistance`, `mesh/lib/routing.js` |
| 11 | JWT admin login, `micha`/`1234` | `api/routes/auth.routes.js` |
| 12 | Admin edits marketing pages + database | `content_blocks`, `external_links`, admin tabs |
| 13 | External MDA map link | `external_links` (`OFFICIAL_MAP`), landing page + footer |
| 14 | 3+ LoRa vendors, 433 MHz emphasis | `external_links` (`BUY_LORA`), `web/app/buy/page.js` |
| 15 | Frictionless registration, no password | No password column exists on `responders` |

## 14. Troubleshooting

**`cannot reach MySQL` on startup**
Check that the MySQL service is running and that `MYSQL_PASSWORD` in `api/.env` matches your server.
XAMPP and WAMP default to an empty root password.

**`cannot reach MongoDB. Is mongod running?`**
Start the MongoDB service. On Windows: `net start MongoDB`, or install it with
`winget install MongoDB.Server`.

**Every dispatch fails with 502 / "שירות הרישום אינו זמין"**
`INTERNAL_SERVICE_KEY` differs between `api/.env` and `mesh/.env`. They must be identical.

**The seed script fails with `Table 'field_defib.admins' doesn't exist`**
Run `npm run db:schema` first.

**The route on the map is a dashed grey line**
BRouter was unreachable, so the system fell back to a straight line and says so on screen. Check
your internet connection; the rest of the simulation is unaffected.

**The registration form rejects a phone number that looks fine**
The server expects an Israeli mobile: `05X` followed by 7 digits. Spaces, dashes and a `+972`
prefix are normalised automatically; landlines are not accepted.

---

## Academic note

This project was written for the Full-Stack Web Development course at Afeka College. It is a
teaching simulator, not a medical device, and it is not a substitute for calling **101**.

The LoRa hardware links on the purchase page point to third-party vendors. They are provided for
information; this project is not affiliated with, and receives nothing from, any of them.
#   A E D - E m e r g e n c y - S i t e  
 