# Operating Guide

How to run, drive and demonstrate **Field Defibrillators — Pro Bono**.

For architecture, the database design and the LoRa theory, see [readme.md](readme.md).
This document is about *operating* the system: starting it, using every screen, managing the data,
and what to do when something is wrong.

---

## Contents

1. [At a glance](#1-at-a-glance)
2. [Before you start](#2-before-you-start)
3. [Starting and stopping](#3-starting-and-stopping)
4. [Setting up on a new machine](#4-setting-up-on-a-new-machine)
5. [Screen by screen](#5-screen-by-screen)
6. [The admin panel](#6-the-admin-panel)
7. [Managing the data](#7-managing-the-data)
8. [Demonstration script](#8-demonstration-script)
9. [Troubleshooting](#9-troubleshooting)
10. [Reference](#10-reference)

---

## 1. At a glance

```bash
cd C:\Users\idanm\Desktop\Shohat
npm run dev
```

Then open **http://localhost:3000**. Stop everything with `Ctrl+C` in that terminal.

| What | Where | Notes |
|---|---|---|
| Website | http://localhost:3000 | Next.js |
| Identity & Registry API | http://localhost:4000 | Express + MySQL |
| Dispatch & Telemetry API | http://localhost:5000 | Express + MongoDB + WebSocket |
| Admin login | `micha` / `1234` | at `/admin` |
| MySQL database | `field_defib` | 6 tables |
| MongoDB database | `field_defib` | 3 collections |

---

## 2. Before you start

Two database services must be running. **They do not behave the same way on boot:**

| Service | Starts automatically? | What to do |
|---|---|---|
| **MongoDB** | Yes — installed as an automatic Windows service | Nothing |
| **MySQL** (via WAMP) | **No** — start type is Manual | **Launch WAMP and wait for the tray icon to turn green** |

So the rule after every reboot is: **start WAMP first, then `npm run dev`.**

If you forget, the api server tells you immediately and exits:

```
[api] cannot reach MySQL. Check api/.env and that the server is running.
```

That is the failure behaving correctly — it fails on startup rather than on the first visitor's
registration.

### Checking both services

```bash
Get-Service MongoDB, wampmysqld64
```

Both should read `Running`. To start either one manually (needs an **administrator** terminal):

```bash
net start MongoDB
```

```bash
net start wampmysqld64
```

### Optional: make MySQL start on boot too

In an administrator terminal, once:

```bash
sc config wampmysqld64 start= auto
```

---

## 3. Starting and stopping

### All three services together

```bash
npm run dev
```

This runs `concurrently`, which prefixes each line with the service that produced it —
`api` in blue, `mesh` in magenta, `web` in green. A healthy startup looks like this:

```
[api]  MySQL connection OK
[api]  Identity & Registry service listening on http://localhost:4000
[mesh] MongoDB connection OK
[mesh] Dispatch & Telemetry service listening on http://localhost:5000
[mesh] WebSocket ready on ws://localhost:5000
[web]  ▲ Next.js 15.5.22  - Local: http://localhost:3000
```

Wait for **all three** before opening the browser. The web server is usually the slowest to be
ready on a cold start.

### One service at a time

Useful when you want to read one server's log without the others interleaving:

```bash
npm run dev:api
```

Also `npm run dev:mesh` and `npm run dev:web`.

Be aware of the dependencies when running services alone:

- `web` alone → pages render, but with their "service unavailable" states.
- `mesh` alone → telemetry works, but **dispatch fails**: it needs `api` to look up who the
  responders are.
- `api` alone → registration and the admin panel work fully; the simulator and emergency pages do not.

### Stopping

`Ctrl+C` in the terminal running `npm run dev` stops all three.

If a process was orphaned and a port stays occupied, find and kill it:

```bash
netstat -ano | findstr ":4000"
```

The last column is the PID. Then:

```bash
taskkill /F /PID <pid>
```

---

## 4. Setting up on a new machine

Already done on this computer. This section is for a fresh clone — for example, on the machine
where the project is graded.

**Prerequisites:** Node.js 18+, MySQL 8, MongoDB 6/7/8.

```bash
git clone <repository-url>
cd Shohat
npm run install:all
```

Create the three environment files:

```bash
Copy-Item api\.env.example api\.env; Copy-Item mesh\.env.example mesh\.env; Copy-Item web\.env.local.example web\.env.local
```

Open `api/.env` and set `MYSQL_PASSWORD` to the MySQL root password (blank for a default
WAMP/XAMPP install).

> **`INTERNAL_SERVICE_KEY` must be identical in `api/.env` and `mesh/.env`.** It is the shared
> secret the dispatch service uses to call `/internal/*`. If the two differ, every distress call
> fails with `502`.

Create the tables, then fill both databases:

```bash
npm run db:schema
```

```bash
npm run seed
```

Then `npm run dev` as usual.

---

## 5. Screen by screen

### `/` — Landing page

The public face of the project. The hero text, the three-line LoRa explainer and the
"how it works" paragraph are all **read from the database** and editable from the admin panel —
change them there and this page changes on reload.

The three counters (registered volunteers, defibrillator carriers, LoRa devices) are live
`COUNT` queries against MySQL, not fixed numbers.

Below the diagram sits the prominent link to the official **Magen David Adom** map of fixed
public defibrillators.

### `/register` — Volunteer registration

No password and no account — that is the design, enforced by the schema itself.

| Field | Required | Notes |
|---|---|---|
| שם פרטי (first name) | Yes | At least 2 characters |
| שם משפחה (last name) | No | Genuinely optional |
| נייד (mobile) | Yes | Israeli mobile `05X` + 7 digits. Spaces, dashes and `+972` are accepted and normalised |
| יישוב (city) | No | |
| Equipment | **At least one** | Defibrillator, LoRa device, or both |
| מזהה LoRa | Only if LoRa ticked | Meshtastic node id, e.g. `!a3f2c1b4` |

Two rules to demonstrate deliberately, because they are graded requirements:

- Submitting with **neither** equipment box ticked is rejected — a volunteer with no equipment has
  nothing to contribute to a rescue.
- Registering a phone number that already exists is rejected by a **UNIQUE constraint in the
  database**, not by application code that could be bypassed.

The number is also checked for availability as soon as you leave the phone field.

### `/simulator` — Raising a distress call

This is the control room. What each control does:

| Control | Effect |
|---|---|
| **Clicking the map** | Moves the casualty. The red circle follows |
| **רדיוס חיפוש** (200–5000 m) | Sent to the server as `maxDistance` in the `$geoNear` query. The circle on screen *is* the searched area |
| **כמה מתנדבים לדגום** (1–15) | How many of the responders inside the radius to sample randomly (`$sample`) |
| **שם / טלפון הקורא** | Appear in the SMS text and on the emergency page |

The grey dots on the map are the seeded volunteers at their last known positions. Click one to
open its popup — alongside the LoRa id and coverage it shows **battery level** and, for AED
carriers, whether their defibrillator **passed its last self-test** (Requirement #1). Both are
generated by the seed script and refresh every time you run `npm run seed`.

**Only devices that transmitted in the last 180 minutes are drawn.** The banner above the map
states this explicitly — for example *"מוצגים 50 מתוך 51 מכשירים רשומים"* — so a map with fewer
dots than you expect is the freshness rule working, not data loss. The same threshold governs
dispatch, so anything hidden from the map is also refused by the dispatcher. Change it with
`MAX_HEARTBEAT_AGE_MIN` in `mesh/.env`.

**Choosing where to click matters for a good demonstration.** The seeded devices are clustered
around Yarkon Park. Clicking dead centre can select a responder 80 m away, which produces a
100 m route that proves nothing. **Click toward the edge of the cluster** and you get a route of
1–3 km that visibly winds along real cycle paths — which is the point of requirement #10.

Press **🆘 שגרו קריאת מצוקה** and you are taken to the emergency page.

### `/emergency` — The live dispatch console

Opening this page without an alert id shows the most recent call. With no calls at all it shows
a green "no active distress call" state.

**The four tiles** summarise the dispatch: how many were found in the radius, how many are
reachable over LoRa, how many over SMS, and how many cannot be reached at all.

**The map** shows the casualty (🆘, pulsing), every sampled responder coloured by channel, and the
bicycle route of the responder who is on the way.

| Marker | Meaning |
|---|---|
| 🆘 red, pulsing | The casualty |
| 🚴 green, pulsing | The selected responder — the one actually riding |
| 📡 purple | Reached over the 433 MHz LoRa mesh |
| 📱 cyan | Reached over the cellular network by SMS |
| ✖ grey | **Unreachable** — no coverage and no LoRa device |

Those grey markers are shown on purpose. They are the gap that owning a LoRa node closes, and
they are the strongest argument the project makes.

**The table** lists every sampled responder with their channel, air distance, **when they last
broadcast**, what they carry (🫀 defibrillator, 📡 LoRa node), and a **מצב מכשיר** column with their
battery level and — only for AED carriers — a **תקין / לא תקין** (operational / not operational)
badge. It is blank for anyone without a defibrillator; that is deliberate, so "no AED" is never
drawn as "broken AED."

**The timeline** on the side fills in live over roughly 8 seconds, streamed over the WebSocket as
the alert propagates. Events arriving while you watch are marked with a red edge. The badge at the
top right shows whether the socket is connected.

**How the responder is chosen** — three tiers, evaluated in order, distance breaking ties only
within a tier:

1. Carries a defibrillator that is **operational** (or its health was never reported).
2. Carries a defibrillator confirmed **not** operational.
3. No defibrillator at all — can still start CPR.

The system will skip the nearest responder in favour of a farther one whose AED actually works. If
it has to fall back to tier 2 because nothing better is reachable, the responder card on the
emergency page shows an amber **"הדפיברילטור דיווח כלא תקין"** warning — this is Requirement #1's
`is_operational` field changing a real decision, not just being displayed.

If the route draws as a **dashed grey line**, the external routing service was unreachable and the
system fell back to a straight line — it says so on screen rather than pretending.

### `/buy` — LoRa equipment

The vendor list, the 433 MHz warning, and the MDA link again. Everything here is database-driven
and editable from the admin panel.

The warning at the top is not filler: the frequency is a **hardware** property. A 868 MHz device
will never hear a 433 MHz device, and the same model is sold in both.

---

## 6. The admin panel

Go to **`/admin`** and log in with **`micha` / `1234`**.

### How the session behaves

Worth understanding, because it looks like magic if you have not seen it before:

- The **access token lasts 15 minutes** and lives only in the page's memory.
- Pressing **F5 keeps you logged in** — the page is silently re-authenticated from the refresh
  cookie, which JavaScript cannot read.
- After 15 minutes of use, the next request renews the token **without interrupting you**.
- **התנתקות** (logout) revokes the session in the database. Clearing the cookie alone would not be
  enough — a stolen copy of the token would still work.

### מאגר המתנדבים — the registration database

- **Search** by name, phone or LoRa id. Typing is debounced by 350 ms, so it queries once you pause
  rather than on every keystroke.
- **Filter** by equipment type.
- **סוללה** — battery level, shown in red with a **טעינה נדרשת** badge below 20%. When any device
  is low, an amber banner at the top of the tab lists everyone needing attention, with their phone
  number and whether the maintenance SMS went out — the administrator's work queue.
- **שידור אחרון** — when that device last transmitted. This is the only column not sourced from
  MySQL: `api` fetches it from `mesh` over the internal service call, one request per page. A
  device past the 180-minute threshold is greyed and tagged **שקט**, meaning the dispatcher will
  not send to it. A responder who has never transmitted at all reads **מעולם לא שידר** — a
  different state from having gone quiet. If the mesh service is down the column reads **לא זמין**
  and everything else on the screen keeps working.
- **פעיל / מושהה** — click the badge to suspend a volunteer. A suspended volunteer stays in the
  database but is invisible to the dispatcher.
- **עריכה** — edit name, phone, LoRa id and city.
- **מחיקה** — permanent. Their equipment rows are removed with them automatically by the database's
  `ON DELETE CASCADE`, not by application code.

### תוכן שיווקי — the marketing copy

Pick a page, edit a block, press **שמירת הבלוק**, then reload the public page to see the change.
This is requirement #12: marketing text is maintained by the administrator, with no developer and
no redeploy.

One special case worth knowing: in **הסבר LoRa**, **each line becomes a numbered step** on the
landing page. Three lines produce three steps. Add a fourth line and a fourth step appears.

### קישורים חיצוניים — the external links

Three categories in one place: the LoRa vendors, the official MDA map, and learning resources.
The vendor screen shows a live count against the required minimum of three.

---

## 7. Managing the data

### Reset to a clean state

```bash
npm run seed
```

Clears and rewrites everything the seeder owns: 50 volunteers with their equipment, the admin
account, the content blocks, the external links, and all telemetry. It also clears any alerts left
over from testing.

**Run this before a presentation** so the alert history is clean and the counters read exactly 50.

It is safe to run repeatedly, and it does **not** require `npm run db:schema` again — that one only
creates the tables and has already been done.

### Rebuild the tables from scratch

Only needed if the schema itself changed or the database was dropped:

```bash
npm run db:schema
```

Then re-seed.

### Looking inside MySQL

The easiest route on this machine is **phpMyAdmin**, which WAMP already provides:

**http://localhost/phpmyadmin** — user `root`, empty password, database `field_defib`.

Command line is also available, though `mysql` is not on the PATH here:

```bash
& "C:\wamp64\bin\mysql\mysql8.4.7\bin\mysql.exe" -u root field_defib
```

Useful queries:

```sql
SELECT COUNT(*) FROM responders;
SELECT r.first_name, r.phone, GROUP_CONCAT(d.kind) AS gear
  FROM responders r LEFT JOIN devices d ON d.responder_id = r.id
  GROUP BY r.id LIMIT 10;
SELECT id, admin_id, expires_at, revoked_at FROM refresh_tokens ORDER BY id DESC LIMIT 5;
```

That last one is a good thing to have on screen during a defence: you can watch a row appear when
you log in, and watch `revoked_at` fill in when the token rotates or you log out.

### Looking inside MongoDB

No shell is installed on this machine. Two options if you want one:

```bash
winget install MongoDB.Compass.Full
```

A graphical browser — open `field_defib` and look at the `alerts` collection. Showing a real alert
document, with its nested `candidates` and `timeline` arrays, is a strong way to answer
*"why did this need a document database?"*

```bash
winget install MongoDB.Shell
```

Gives you `mongosh` for a command line instead.

### Inspecting through the API instead

This needs nothing installed and works right now, with the servers running:

```bash
curl http://localhost:4000/health
```

```bash
curl http://localhost:5000/telemetry/latest
```

```bash
curl "http://localhost:5000/alerts?limit=5"
```

```bash
curl http://localhost:5000/alerts/ALR-XXXXXX/events
```

That last one returns the raw radio log for a call — one row per delivery, with hop counts and
signal strength per LoRa node.

---

## 8. Demonstration script

A ten-minute walkthrough, in a sensible order, that hits all fifteen requirements.

**Before you begin:** start WAMP, run `npm run seed`, run `npm run dev`, and confirm you have
internet — the bicycle routing calls an external service. Everything else works offline.

| # | Do this | Point out |
|---|---|---|
| 1 | Open `/` | Hebrew RTL throughout; the counters are live SQL; the three-line LoRa explainer and the flow diagram are the two-channel design |
| 2 | Scroll to the MDA link | Requirement #13 — this project complements the official map of fixed devices |
| 3 | Open `/register`, tick nothing, submit | Rejected: eligibility is a rule, not a suggestion |
| 4 | Tick the defibrillator box, submit | Registered with no password anywhere — the column does not exist |
| 5 | Try registering the same number again | Rejected by a UNIQUE constraint in the database |
| 6 | Open `/simulator` | The banner: only devices transmitting in the last 180 min are shown, and the same rule governs dispatch. Explain radius → `$match` on the latest position |
| 7 | Click near the **edge** of the cluster, radius ≈ 1500 m, fire | |
| 8 | Watch `/emergency` fill in | The timeline is pushed by the server over a WebSocket, not polled |
| 9 | Point at a grey ✖ marker | No coverage, no LoRa — this is the gap the project exists to close |
| 10 | Point at the green route | A real cycle path, not a straight line. Compare the route length with the air distance |
| 11 | Look at the **מצב מכשיר** column in the table | Battery % and an operational badge — Requirement #1's device telemetry |
| 12 | If the primary card shows an amber warning | The closest AED was confirmed broken, so the algorithm routed to a farther one that works — `isOperational` changing a real decision, not just a display |
| 13 | Open `/admin`, log in | JWT access token in memory; refresh token in an httpOnly cookie |
| 14 | Press F5 | Still logged in — silently re-authenticated from the cookie |
| 15 | Edit a content block, save, reload `/` | Requirement #12: the site's copy is data |
| 16 | Show the responders table: search, suspend, delete | Deleting cascades to their equipment |
| 16b | Point at the **שידור אחרון** column | The only column not from MySQL — `api` asks `mesh` over the internal service call. Same 180-min threshold as the map and the dispatcher |
| 17 | Open `/buy` | Three vendors, and the 433 MHz warning explained as a hardware property |

**Step 12 needs a bit of luck** — only about 1 in 7 seeded AED carriers comes back non-operational,
so a random click will not always produce the warning. To guarantee it for a defence: before the
demo, run `curl http://localhost:5000/telemetry/latest` and note the `lat`/`lng` of a row with
`"isOperational":false`, then click that exact spot on the simulator map with a small radius
(around 300–500 m) so it is the only — or closest — AED carrier sampled.

**If asked "what is actually simulated?"** — answer directly: the radio propagation, the SMS
delivery and the device positions. The databases, the geospatial query, the cross-service join,
the authentication, the WebSocket and the bicycle routing are all real. See section 12 of the
[readme](readme.md#12-what-is-real-and-what-is-simulated).

---

## 9. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `[api] cannot reach MySQL` | WAMP is not running | Start WAMP, wait for the green tray icon |
| `[mesh] cannot reach MongoDB` | The service is stopped | `net start MongoDB` in an admin terminal |
| `EADDRINUSE` on 3000/4000/5000 | An orphaned process | `netstat -ano \| findstr ":4000"` then `taskkill /F /PID <pid>` |
| Every page suddenly returns **500** after running `npm run build` | `next build` and `next dev` share the `.next` folder, and the build overwrote what the running dev server had loaded | Stop with `Ctrl+C` and run `npm run dev` again. **Never run a production build while the dev server is running** |
| Every dispatch returns 502 | `INTERNAL_SERVICE_KEY` differs between the two `.env` files | Make them identical, restart both servers |
| Simulator map has only the 🆘 marker | The mesh service or MongoDB is down | Check the mesh log |
| Map shows fewer dots than expected | Working as designed — devices silent for over 180 min are hidden | Read the banner above the map; re-run `npm run seed` to refresh timestamps, or raise `MAX_HEARTBEAT_AGE_MIN` |
| `Table 'field_defib.admins' doesn't exist` | Schema never created | `npm run db:schema`, then `npm run seed` |
| The route is a dashed grey line | The routing service was unreachable | Check internet. Everything else still works |
| Login says the password is wrong | The database was rebuilt without re-seeding | `npm run seed` recreates the admin |
| A valid phone number is rejected | Only Israeli mobiles are accepted | `05X` + 7 digits. Landlines are not accepted |
| Emergency page says "מנותק" | The WebSocket dropped, usually because the mesh server restarted | Reload the page |

---

## 10. Reference

### Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Start all three services |
| `npm run dev:api` / `dev:mesh` / `dev:web` | Start one service |
| `npm run db:schema` | Create the database and tables |
| `npm run seed` | Fill both databases (safe to repeat) |
| `npm test` | Run both backend test suites |
| `npm run test:geofencing` | Geo-fence, freshness and prioritisation assertions |
| `npm run test:maintenance` | Low-battery alert state machine |
| `npm run install:all` | Install dependencies for all four packages |
| `npm --prefix web run build` | Production build of the front end |

### Environment files

| File | Key settings |
|---|---|
| `api/.env` | `MYSQL_*`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `INTERNAL_SERVICE_KEY`, `MESH_URL`, `ADMIN_USERNAME`, `ADMIN_PASSWORD` |
| `mesh/.env` | `MONGO_URI`, `API_URL`, `INTERNAL_SERVICE_KEY`, `MAX_HEARTBEAT_AGE_MIN`, `BROUTER_URL` |
| `web/.env.local` | `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_MESH_URL`, `NEXT_PUBLIC_MESH_WS` |

`INTERNAL_SERVICE_KEY` must match between the first two. The two JWT secrets must be different
from each other — that is deliberate, so a leak of one does not compromise the other.

### Databases

**MySQL `field_defib`** — `admins`, `refresh_tokens`, `responders`, `devices`, `content_blocks`,
`external_links`

**MongoDB `field_defib`** — `telemetry`, `alerts`, `mesh_events`, `maintenance_alerts`

### Simulator defaults

| Setting | Default | Where to change |
|---|---|---|
| Map centre | Yarkon Park, 32.1010 / 34.8090 | `web/lib/config.js` |
| Radius | 1500 m | Slider, or the same file |
| Sample size | 8 | Slider, or the same file |
| Heartbeat freshness limit | 180 minutes | `MAX_HEARTBEAT_AGE_MIN` in `mesh/.env` |
| Seeded volunteers | 50 | `RESPONDER_COUNT` in `scripts/seed.js` |

---

*This guide covers operation. For the architecture, the two-database rationale and the LoRa theory,
see [readme.md](readme.md).*
