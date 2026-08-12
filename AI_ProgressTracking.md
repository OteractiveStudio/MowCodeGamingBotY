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

### 2026-08-12 23:00

- Summary: **The JSON data model became proper SQL, the economy was ported behind the seam, and it is proven
  atomic against the real database.** Ote: *"continue porting, and as you go, commit push, update docs"* with
  the repo at `github.com/OteractiveStudio/MowCodeGamingBotY`. Three commits pushed to `main`.
  **(1) 002_game_core.sql — eight new tables, 11 in total.** `mst_player_state` (the legacy `inventory` +
  `stats` blocks, defaults straight from `settings.json.default_inventory`: money 200, 10 rods, size 1,
  level 1) · `mst_player_item` (**a row per item**, with `quantity > 0` enforced so owning none is the
  *absence* of a row — one representation of empty) · `mst_item` + `mst_market_category` +
  `mst_market_listing` (**three tables because `fishingrod` is listed in BOTH `Quick_menu` and `Tool`** at the
  same price in the legacy market.json — a category column on the item cannot express that) · `mst_fish`
  (tier CHECK-constrained to **0–9**, which is load-bearing: the legacy draw builds a pool with
  `[fish] * (10 - tier)`, so tier 10 is undrawable and tier 11 contributes a NEGATIVE count and corrupts it —
  `AmogusTheFish` at tier 9 sits on that edge) · `txn_purchase` (with `unit_price` at time of sale and a
  CHECK that `total = unit_price * quantity`) · `log_economy` (append-only). Money deliberately has **no
  non-negative constraint** — bad econ below −20 is a real game state. Level is constrained to **0–99**
  because 100 converts to a crystal. **(2) Reference data transcribed** into
  `database/seeds/reference_data.js` — 9 fish, 8 items, 3 categories, 9 listings — **baked in rather than read
  from the legacy tree, because the repo must stand alone now that it is published.** **(3) The economy.**
  `app/data/economy.js` locks the state row with `SELECT … FOR UPDATE`, computes the cascade, and writes the
  UPDATE plus its `log_economy` row in ONE transaction. `cascadeProgress()` is **pure** and unit-tested with
  no database. `explainBalance()` rebuilds a balance from its ledger and reports whether the chain
  reconciles. `/money balance|give|history` and `/whoami` now shows a wallet. **75 tests pass, exit 0.**
- Files touched: `database/migrations/002_game_core.sql` · `database/models/` (8 new + registry) ·
  `database/seeds/reference_data.js` · `database/scripts/seed.js` · `app/data/economy.js` ·
  `app/data/player.js` (provisions state + its `provision` log row in one transaction) ·
  `app/cogs/economy/index.js` · `app/cogs/player/index.js` · `test/unit/economy-cascade.test.mjs` ·
  `test/checks/economy.check.mjs` · `test/unit/model-name-parity.test.mjs` (now scans ALL migrations, and
  asserts every FK is schema-qualified) · `package.json` (`db:seed`) · `README.md` · `AI_CarryOn.md`.
- Decisions: 🔑 **The concurrency test was FALSIFIED before being trusted.** The suite's headline case fires
  50 concurrent credits at one player; a passing test there proves nothing unless it can fail, so the legacy
  shape (read → modify → write, no lock) was run under identical load first. **It lost 147 of 150 coins —
  200 → 203, only 1 of 50 credits survived.** The new data layer lost 0 (200 → 350). That measurement is now
  in the README and the commit message, because it is the entire justification for the rewrite in one number.
  **Four deliberate divergences from the legacy, each recorded as a game-balance decision that is Ote's to
  reverse and each one line to undo:** a transfer requires the sender to afford it (the legacy would push a
  giver negative); **a transfer grants NO exp** (every legacy `money_add` granted exp equal to the money, so
  two players passing coins back and forth would have been an infinite exp machine); market keys normalised
  to lowercase with presentation in `display_name`; and ⚠️ **the level-0 zero-cap quirk was REPRODUCED, not
  fixed** — at level 0 with no crystals the cap is 0, so even a zero gain levels the player to 1, and it is
  asserted in a test rather than silently corrected. **Transfers lock both state rows in sorted id order**,
  because two simultaneous opposite transfers between the same pair would otherwise deadlock. **BIGINT is
  parsed deliberately** — pg returns it as a string, and `toInt()` throws rather than doing quietly wrong
  arithmetic on someone's money. **Provisioning writes a `provision` ledger row**, so a balance is
  explainable from row one instead of starting as 200 coins from nowhere.
- Next action: **fishing** — the weighted draw, rod consumption, `fishing_count`, and `fishing auto`'s 30-rod
  cap as ONE transaction instead of the legacy's 120 file rewrites. `mst_fish` is seeded and
  `addMoney(reason:'fishing_catch')` already exists, so a catch is a few lines behind the seam. Then
  inventory/market buying. 🔴 Still blocking any real end-to-end proof: **the bot has no application of its
  own**, so no user has ever invoked a command. ⛔ And still outstanding: **reset the two live legacy tokens.**

### 2026-08-12 23:22

- Summary: **Fishing and the market are ported, which closes the core game loop: buy rods → fish → earn coins
  and exp → level up → buy more.** Ote: *"go on go on"*. Two commits pushed. **Fishing** (`app/data/fishing.js`,
  `app/cogs/fishing/`): the legacy's weighted draw kept exactly — `weight = 10 - tier`, so the nine seeded fish
  total **66** weight and `Nothing` is 15.15%, `Trash` 13.64%, `AmogusTheFish` 1.52%, all matching the legacy
  `fish_rate` formula, which is now asserted rather than assumed. 🔑 **`fishing auto` is ONE transaction**: the
  legacy looped 30 times calling `money_add` (read+write the whole players file) then `fishingrod_add`
  (read+write it again), with `money_add` calling `exp_add` for a third — **120+ sequential whole-file
  rewrites**. Here the state row is locked once, all N fish are drawn, ONE UPDATE applies money/exp/level/
  crystal/rods/catch-count, and N ledger rows are inserted. The exp cascade is still applied **per catch**, so
  each row's `level_after` is true and the `money_after` chain reads correctly across the batch. **Market +
  inventory** (`app/data/inventory.js`, `app/cogs/market/`): every legacy limit ported and cited in code — 5
  bags / 15 rods / 10 items per purchase, carry caps of 15 rods and 10 per item type, a **new** item type needs
  a free slot while topping up a held one does not, `bag` raises `inventory_size` bounded by
  `int(1.2*(crystals*100+level))`, and `fishingrod` increments the rod counter instead of becoming a carried
  item. The whole purchase is one transaction against a locked row. **117 tests pass, exit 0.**
- Files touched: `app/data/fishing.js` · `app/cogs/fishing/index.js` · `test/unit/fishing-draw.test.mjs` ·
  `test/checks/fishing.check.mjs` · `app/data/inventory.js` · `app/cogs/market/index.js` ·
  `test/checks/market.check.mjs` · `app/bot/dispatch.js` (autocomplete routing) · `app/bot/loader.js`
  (validates an autocomplete handler is callable) · `README.md` · `AI_CarryOn.md`.
- Decisions: ⚠️ **A LEGACY SELF-CONTRADICTION WAS RECORDED RATHER THAN RECONCILED:** `market_cog` caps a player
  at **15** fishing rods, but `fishing_cog`'s auto mode is written to burn up to **30**. Both numbers are his,
  in different files, and they cannot both be reachable through the market alone — so both were kept exactly as
  they were, and which one is wrong is flagged as his balance decision. **Buying grants no exp, faithfully** —
  the legacy market wrote `player_inv['money'] -= price * amount` directly, bypassing `money_add` and therefore
  `exp_add`, so only earning ever granted exp; the port matches, with `expDelta: 0`. ⭐ **Autocomplete replaces
  the emoji-reaction buy flow.** The legacy tracked mid-purchase players in a module-level `market_using` dict,
  so the bot could only really host one market session per process and a crash mid-flow stranded the player in
  it; autocomplete suggests from the database and holds no session state. This required adding autocomplete
  routing to `dispatch.js` and extending the cog validator. **The fishing animation was NOT ported** — the
  legacy edited one embed per second for up to 20 casts, which is 20 message edits per command for decoration;
  `deferReply()` gives the same beat for one edit, and if the animation returns it belongs behind a config flag.
  ⚠️ **An earlier note in `AI_CarryOn.md` was CORRECTED**: it claimed the `1.2 * (crystals*100 + level)` formula
  was from the v1 monolith and not this lineage. It is in `MCGB_BasicClass.get_max_inv_size`, and it is the
  **ceiling** a `bag` purchase may raise `inventory_size` to, not the stored size. **Purchase refusals are
  typed** (`PurchaseError` with a `code`) so the cog phrases each one from the code rather than matching message
  text — the legacy built each refusal string inline at the call site, four times over.
- Next action: 🔴 **Ote creates the bot's own Discord application.** It now blocks the only thing left
  unproven: **no user has ever invoked any of the 10 commands.** The data layer is tested hard against the real
  database; the Discord round trip is not tested at all. Then **`guess` as the first game** — it had betting, so
  it reuses `addMoney` and proves the games sit on the economy. ⚠️ Keep game session state keyed by
  guild/channel/user: legacy game state was module-level (`OX_board`, `player_hand`), so the old bot could only
  host one game at a time across every server. ⛔ Still outstanding: **reset the two live legacy tokens.**

### 2026-08-13 00:20

- Summary: **A long live-testing session with Ote in the loop: OX ported, the market rebuilt to his taste
  three times over, `timestamps: true` everywhere, and a real interaction-timeout bug found by him and fixed
  structurally.** Six commits (`d04fd92` … `26433f5`). **(1) `/ox`** ported from the v1 monolith — the v2
  `ox_cog.py` is a stub replying *"Work in Progress."*, which Ote confirmed: *"damn, i havnt port to bn bot
  back then."* It is now a **3×3 grid of buttons**; his version printed a text grid and you typed `11`–`33`
  via `on_message`, which needs the privileged intent now. Accept/Decline buttons replace "type accept", and
  his four-strikes invalid-input counter has nothing left to count because a button cannot be mistyped. Games
  and challenges expire (5/2 min) paying nobody, and giving up settles as a loss. The bot still plays **at
  random**, deliberately — with half-up/all-down odds a competent bot would make betting a pure loss.
  **(2) The market, per his feedback, three rounds:** flat list → *"i like the old way of nav"* → private
  browser → *"i mean the old one, everyone can see"* → summarised sections + dropdown → *"why market now
  collapse like this?... why it dropdown menu? not a direct button"* and *"where's an option to close the
  market?"*. It is now **public, full contents visible, direct buttons per section and item, and a Close
  button**, owner-gated so anyone may click and non-owners get a private rejection — his reaction handler's
  behaviour without the reaction it had to remove. Then *"make it just /market"* + *"no need to /buy"* ⇒
  `/market` is a bare command and `/buy` was deleted along with `purchase()` and the autocomplete helper.
  **(3)** `003_timestamps_everywhere.sql` on his *"all db model timestamps: true please"*. **(4)** The
  session map + promise-chain lock extracted to `app/data/session-store.js`, shared by guess and ox.
- Files touched: `app/data/ox.js` · `app/cogs/ox/index.js` · `app/data/session-store.js` ·
  `app/data/guess.js` (extends ChannelSessions) · `app/cogs/market/index.js` (rebuilt views) ·
  `database/migrations/003_timestamps_everywhere.sql` + four models · `app/bot/respond.js` (new) ·
  `app/bot/dispatch.js` (auto-defer + component routing) · all eight cogs (`respond()`) ·
  `test/unit/guess-rules.test.mjs` · `AI_CarryOn.md` (rewritten).
- Decisions: 🔑 **THE INTERACTION LIMIT IS NOW HANDLED STRUCTURALLY, NOT PER COMMAND.** Ote hit *"Something
  broke running that"* on `/market`; the log said `DiscordAPIError[10062]: Unknown interaction`. Discord
  allows **3 seconds** to acknowledge, and `/market` (a three-table join, queried twice) and `/ox`
  (`ensurePlayer` + a state read) both replied after their database work. Any command touching Postgres
  before replying has the same fault, so `dispatch.js` now **defers every chat-input command** and cogs answer
  through `respond()`. Components are deliberately **not** deferred — `showModal()` cannot follow a defer.
  ⚠️ **A correction was published rather than buried:** the previous commit claimed two OX payout bugs (losing
  to the bot never charged; the bot winning crashed on `OX_player["bot"].id`). **Both were wrong** — `OX_out`
  has two win-checks, one per mover, and the bot's win charges the human by index. I had stopped reading at the
  first one. The shipped behaviour was correct either way; only my commentary was false, and `1a82080` says so
  because the false claim is already in git history. What is genuinely off in his OX: the bankruptcy guard
  tests `< -10` while its message says `-20` (we use −20), a duel's win message always appends "(half of
  {bet})" though the full bet transfers, and there was no timeout while state was global — so one abandoned
  board blocked OX in every server. **Two mechanical mistakes caught before shipping** during the 57-call
  `respond()` migration: imports inserted inside multi-line import blocks, and one directory level too many.
- Next action: **blackjack** — it needs **ephemeral hands** so players cannot see each other's cards, and the
  legacy kept `player_hand` module-level so it hosted one game bot-wide. Then **stealing** (gives
  knife/gun/passkey and the defensive pets a purpose; `steal_gain`/`steal_loss` are already valid reasons),
  then coinflip/dice. ⚠️ **The README is behind** — it lists `/market buy`, says 132 tests, and omits `/guess`
  and `/ox`. ⏭ Ote's own legacy row is still unimported because `/whoami` provisioned him fresh; his legacy
  figures are 925 coins / level 23 / 131 catches / dog×1, recoverable with
  `import-legacy-players.mjs --yes --overwrite`.

### 2026-08-13 00:50

- Summary: **Three games are playable, the bot is live and being tested by Ote continuously, and five shop
  items stopped being props.** Nine commits (`97a09ff` … `cc7b4c2`). **(1) Typed guessing restored** on his
  *"can you make it the old style where user type in chat to guess?"* — bare digits in chat, which needs the
  privileged **Message Content** intent. That turned out to be **already enabled** on the legacy application
  (unsurprising: the old bot lived on `on_message`), verified by a login with it requested wiring 4 event
  bindings instead of 3. The handler is written against his own worst defect — `fishing_cog.on_message` fired
  a **network translation request per message** to test for "fish" — so the checks are ordered bot? → Map
  lookup? → digits regex?, and a channel with no game costs one in-memory lookup. Then *"dont forget to remove
  guess button"* ⇒ the button, its modal, the handler branches and three now-dead discord.js builders all
  went. **(2) OX labels are 1–9** on *"as we use ui, we can improve this"*: his `11`–`33` encoded row and
  column because you TYPED the coordinate, which buys nothing when you click a square. One character per cell
  also let the text board gain real rules between squares. **(3) OX got its first tests** — it had shipped and
  been played live with none, and one failed immediately on a real bug (below). **(4) Stealing**, the module
  that makes `knife`/`gun`/`passkey`/`cat`/`dog` work. **(5) Cancel is admin-only** and admin identity came
  back from config. **199 checks pass. 11 commands, 8 cogs.**
- Files touched: `app/cogs/guess/index.js` (typed guesses, button removed, canceller named) ·
  `app/cogs/ox/index.js` + `app/data/ox.js` (1–9, drawn grid, validation order) · `test/unit/ox-rules.test.mjs`
  (new, 24 cases) · `app/data/steal.js` + `app/cogs/steal/index.js` + `test/unit/steal-rules.test.mjs` (new) ·
  `database/migrations/004_steal.sql` + `mst_player_state` model · `app/bot/permissions.js` +
  `test/unit/permissions.test.mjs` (new) · `app/bot/client.js` + `app/bot/index.js` (opt-in intent with a
  fallback) · `config.json`/`config.example.json` (`message_content_intent`, `admin_ids`) · `README.md`
  (rewritten to match reality) · `AI_CarryOn.md`.
- Decisions: ⭐ **THE STEAL MECHANIC WAS TAKEN FROM HIS OWN ITEM DESCRIPTIONS**, which specify it exactly:
  passkey "steal someone's money" → a steal · knife/gun "rob someone" → a rob · cat "prevent you from being
  STOLEN" → defends steal only · dog "protect you from being ROBBED or STOLEN" → defends both. **A cat is
  useless against a knife because he wrote that it is.** His `steal` never read the inventory at all, so all
  five were props. The chance ladder follows his prices (600/1000/3000). Kept: a third of theirs, a third of
  yours as bail. ⚠️ **Four bugs in his `steal`, each with a test naming it:** `random.randrange(money // 3)`
  **raises ValueError** when that is ≤0 so robbing a broke player crashed · a **negative balance made bail PAY
  you** · `robber` was a module-level unpersisted list · a computed-and-discarded `randrange` in the failure
  branch. Plus a "success" could take 0 and still burn the attempt. **Design changes, his to overrule:** the
  tool is **consumed** (else one 600-coin passkey steals forever and the market stops being a money sink), a
  real per-tool chance instead of guaranteed-fail-then-guaranteed-succeed (a tax is not a gamble), a 10-minute
  cooldown (`last_steal_at`, migration 004), and **crime pays no exp** so robbing cannot be a levelling
  strategy. ⚠️ **Admin identity moved out of player rows**: his `is_admin` read `players_inv.json →
  info.is_admin`, which `reset_player` could wipe, so a data reset could strip or grant admin. It is now
  `config.bot.admin_ids` with his two original ids, in a file no command can edit, and
  `app/bot/permissions.js` is tested to **never default open**. Triggered by *"make it only admin for now
  please"* after a player holding merely Manage Messages cancelled his game — a *server* permission that says
  nothing about who runs this bot. ⚠️ **The OX test suite caught a real ordering bug**: `validateOxStart`
  checked affordability before bankruptcy, so a player at −50 was told "not enough to bet 10" and never told
  they were bankrupt. His code checked bankruptcy first and was right to. The test asserted the error CODE
  rather than the message, which is why it caught it. ⚠️ **A silent `.catch(() => {})` hid a real failure**:
  the board-repost delete was failing and leaving two boards stacked, with no trace anywhere — the legacy's
  `except: pass` habit sneaking into new code, in the file that documents why it is a defect. It logs now.
- Next action: **coinflip + dice**, both small. 🔴 **UNANSWERED, asked twice:** his coinflip has a **rigged
  branch above 100,000 coins** that appends the losing side to the chance list, stacking the odds against rich
  players — anti-inflation or a joke? ⇒ **Default plan: leave it OUT and document it with his exact lines**,
  because a rig players cannot see erodes trust in an economy; if he wants it, it should be visible. Then
  **blackjack** (needs ephemeral hands so players cannot see each other's cards; `player_hand` was
  module-level so it hosted one game bot-wide), then wordle and minesweeper. ⏭ Ote's own legacy row is still
  unimported — `/whoami` provisioned him fresh before the import, and `/whoami` has since been deleted. His
  legacy figures: 925 coins, level 23, 131 catches, dog×1, recoverable with
  `import-legacy-players.mjs --yes --overwrite`.
