# AI Progress Tracking — MowCodeGamingBoteY

## Purpose

- Detailed, chronological implementation history for **this project only**.
- Keep long history here, not in `AI_CarryOn.md` (which is current-state and gets rewritten in place).
- Workspace-level or cross-project changes also get a brief mirror entry in
  `../AI_OverallProgressTracking.md`.

## Logging Rules

- Add a new entry after each meaningful planning or implementation update inside `MowCodeGamingBoteY/`.
- Keep each entry concise but specific.
- Include date, summary, files touched, decisions, and next action.
- Before writing a timestamp, get the real current local time from the terminal. On Windows PowerShell,
  use `Get-Date -Format "yyyy-MM-dd HH:mm:ss K"` and record the local `YYYY-MM-DD HH:mm` value from that
  output.
- Use newest entries at the bottom (append-only). **Never edit an entry after the fact** — if it turns out
  to be wrong, say so in a later entry and correct the claim in `AI_CarryOn.md`.

## Entry Template

### YYYY-MM-DD HH:mm

- Summary:
- Files touched:
- Decisions:
- Next action:

## Entries

The work that came *before* this project is workspace-level and lives in
`../AI_OverallProgressTracking.md` (the 2026-08-12 entry: the legacy Python scan and its digest at
`../Reference/docs/ANALYSIS_LEGACY_MYBOT.md`).

### 2026-08-12 22:12

- Summary: **The project is scaffolded, boots, and its suite passes against the real database.** On Ote's
  instruction — *"can you init discord js project at MowCodeGamingBoteY for me? we will use pg as db via
  squlize. the db is discord_app, user discord_app, pass discord_app, app schema; mowcodegamingbot_y"* — the
  directory went from two docs to a working project. Built in the §8 order: **`.gitignore` +
  `.gitattributes` first**, before the first `npm install`, then `package.json` (ESM), then the config pair,
  then the schema, then the app. Installed **discord.js 14.27.0 · Fastify 5.11.3 · pg 8.23.0 · Sequelize
  6.37.8** on Node 24.14.0. ⚠️ **Ote's database instruction superseded the earlier plan** — the carry-on had
  proposed schema `mowcode_gaming` inside the existing project database; it is now its **own database**
  `discord_app` with role `discord_app` and schema `mowcodegamingbot_y`. Verified against the live server
  before writing any SQL: the role is **not** a superuser but **does** hold `CREATE` on the database, which
  is what lets the migration be applied as the app role with no superuser step — so every object is owned by
  the app and writable by it (§4's trap avoided by checking, not assuming). **What it does now:** applies
  `001_core.sql` idempotently (`log_message`, `mst_guild`, `mst_player`, plus a runner-owned
  `log_migration` ledger keyed by sha256); boots `config → logging → database → bot → HTTP`; answers
  `GET /api/health` on **8401** with a payload that reports the real bot and database state and **503s when
  degraded**; and fails fast with one readable block and exit 1 when the Discord token is missing.
  **`npm test` → 49 passed, exit 0.**
- Files touched: `.gitignore` · `.gitattributes` · `package.json` · `config.example.json` (tracked) ·
  `config.json` (gitignored, holds the real credentials) · `main.js` · `lib/utility.js` ·
  `database/{index.js,connection-config.js}` · `database/migrations/001_core.sql` ·
  `database/scripts/migrate.js` · `database/models/{index,log_message,mst_guild,mst_player}` ·
  `app/bot/{client,loader,dispatch,registry,index}.js` · `app/data/{player,guild}.js` ·
  `app/cogs/{system,guild,player}/index.js` · `app/http/server.js` · `scripts/register-commands.js` ·
  `test/` (harness, 4 unit files, 3 check files, 3 fixtures, `pipeline/test-all.mjs`, its own
  `package.json`) · `README.md` · `AI_CarryOn.md` (rewritten — the "nothing is built" claim fell).
- Decisions: **The two things Ote named as his legacy standouts were carried deliberately, not by
  accident.** (1) **Cogs**: `app/bot/loader.js` loads `app/cogs/<name>/index.js` exporting commands AND
  events *together* — rejecting the common discord.js pattern of splitting `commands/` from `events/` by
  kind, which would scatter one feature across two trees. `ctx` (`client, db, config, log`) is **injected**,
  replacing the legacy's `b = basic("fishing_cog")` at import time, which is what makes a cog testable with
  no Discord and no database. The loader **refuses to start** on a duplicate command name or a cog whose
  `name` disagrees with its directory — the legacy shipped `ox`/`Ox`/`oX`/`xo`/`XO` as five commands and
  defined `get_server_prefix` twice with different behaviour. (2) **Expressive logging**: run-scoped files
  keeping the legacy's exact `YYYYMMDD_HHMMSS` stamp, every line tagged with level + emitting module, going
  to console/file/`log_message` independently — and the switch **works this time**, because the legacy's
  `if not self.is_debug: return` tested a method that was never called (always truthy), so `settings.json.debug`
  did nothing. `logging.message.min_level` is read per call and the **off state is asserted by a test**.
  **Slash-commands-only, therefore no privileged intents** (`Guilds` alone): Message Content has been
  privileged since 2022, so the legacy's `on_message` layer would silently receive empty strings — flagged
  as still Ote's decision, and confined to one file if it changes. **No `is_admin` on `mst_player`** — the
  legacy read admin identity from player rows that `reset_player` could wipe, so it lives in config.
  **Guild rows are marked `left_at`, never deleted**, so settings survive a re-invite. **`{{schema}}`
  placeholder in the SQL**, substituted from config and validated as a plain identifier first, so no script
  hardcodes a schema name and config cannot become an injection vector. **Runtime `cog reload` was left
  OUT** rather than half-built: ESM has no un-import, so it needs cache-busting URLs and listener teardown;
  `npm run dev` restarts instead. **`git init` done, nothing committed** — §2 says commit only when he asks.
  ⚠️ **Two real bugs the tests caught, recorded so they are not re-derived:** `if (!port)` rejected port
  **0**, which the HTTP check uses so it never fights the real process for 8401 — the test failed against
  the old code first and passed after the fix, which is the only order that proves anything; and a startup
  failure printed **twice**, once as a raw stack from `log()`'s console output and once as the formatted
  block, so console is now silenced for that single write while the stack still lands in the file and in
  `log_message` (confirmed by querying the table).
- Next action: **Economy as the first vertical slice** — `mst_player_state` + `log_economy` and `/money`,
  with a test proving a balance can be *explained* from the log, not just read. In parallel and blocking
  everything Discord-facing: 🔴 **Ote creates the Discord application and puts a token in `config.json`** —
  until then the gateway, `npm run bot:register` and every `execute()` are unproven against the real API.
  ⛔ Still outstanding and independent: **reset the leaked legacy tokens** (one is hardcoded at
  `../Reference/repos/MyBot_Legacy/Gaming Bot/CsGamingBot.py:41` and still controls a bot in 12 servers).

### 2026-08-12 22:38

- Summary: **The bot went ONLINE in Discord for the first time, the HTTP surface was removed at Ote's
  instruction, and the README became a repo landing page.** Three separate things, in the order he asked for
  them. **(1) Online:** he asked *"can you use mowcodegaime bot token from legacy repo to connect?. i want to
  see if it online"* — so both legacy MCGB token sources were tested read-only against Discord's API first,
  and 🔴 **both are still valid five years on**: `MowCodeGamingBot` id `892820973030637608` in **10 guilds**,
  and a second bot `Sompade` id `862330157157974088` in **4** whose token is the one hardcoded at
  `CsGamingBot.py:41`. The bot was then brought up through the **real `startBot()`** — cog loading,
  validation, event wiring, dispatch — and appeared online as `MowCodeGamingBot#1501` with presence *Listening
  to /ping* in 10 guilds (174, 244, 107… members). Ote confirmed visually with a screenshot. Held 240s,
  disconnected cleanly, exit 0, nothing left running. ⚠️ **The legacy token was never written into
  `config.json`** — read from the frozen tree, used in memory, no copy created, because a compromised
  credential must not become this project's operating credential. **(2) HTTP removed:** *"we dont need a http
  now right?, let's forcus on discord js should we?"* and *"the fstidy mention in the innitial carry on should
  be a seperate project from MowCodeGamingBoteY right?"* — `app/http/` and `test/checks/http.check.mjs`
  deleted, `fastify` uninstalled, `app.port` and `logging.fastify` removed from both config files, `main.js`
  reduced to `config → logging → database → bot`. Suite went 49 → **45 checks, still exit 0.** **(3) README**
  rewritten for a stranger arriving at the repo, since he said *"ill start to get a repo up"*: what the
  project is, the read-whole-file/write-whole-file problem it exists to fix (with the actual legacy
  `money_add` quoted), honest status, and the cog + logging patterns explained. **(4)** The legacy game rules
  were read out of the Python and written into `AI_CarryOn.md` §📐 so the port does not require re-reading it.
- Files touched: **deleted** `app/http/server.js`, `test/checks/http.check.mjs` · `main.js` (HTTP removed,
  boot reduced) · `package.json` (fastify uninstalled, description + keywords) · `config.json` +
  `config.example.json` (`app.port` and `logging.fastify` removed) · `README.md` (rewritten) ·
  `AI_CarryOn.md` (rewritten — the "never connected to Discord" claim fell; security section upgraded from
  "reset them" to "confirmed live"; legacy rules section added). Scratchpad-only, not in the repo: the token
  check and online-smoke scripts.
- Decisions: ⚠️ **"Fastify beside it, minimal" is SUPERSEDED** — the process is a Discord bot and nothing
  else; a dashboard or API becomes its own sibling project reading the same schema, which is also the more
  extractable option and matches the workspace tie-break rule. Recorded as his call, with his words, rather
  than quietly dropped. The removal was done properly (dependency uninstalled, config keys removed, test file
  deleted) rather than left dormant behind a flag, because dead code that looks live is the failure the ❌
  discipline exists to prevent. ⚠️ **Using the legacy token was treated as the owner using his own
  credential — legitimate — but confined**: read-only validity check first, no copy persisted, no slash
  commands registered against the legacy application (that would have modified its command list), and `db`
  passed as `null` so nothing wrote rows on behalf of a compromised credential. **The security record was
  upgraded from a recommendation to a finding**: two live tokens, 14 guild memberships, some 100–244 members.
- Next action: **build the data model redesign** — `002_game_core.sql` with `mst_player_state`, `log_economy`
  (append-only, so a balance can be *explained*), `mst_item` + `mst_player_item` (a row per item, not a dict),
  `mst_market_category` + `mst_market_listing` (because `fishingrod` is listed in two categories),
  `mst_fish`, `txn_purchase`. Then `app/data/economy.js` doing the money→exp→level→crystal cascade in **one
  locked transaction** with its log row, tested with concurrent credits asserting nothing is lost. All the
  rules and numbers it needs are already in `AI_CarryOn.md` §📐. **Not started** — deliberately not begun
  while Ote is standing up the GitHub repo, so he pushes a tree he has seen rather than one that grew nine
  tables underneath him.
