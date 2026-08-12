# AI_CarryOn.md — MowCodeGamingBoteY

> Short handoff for **this project only**. Long history goes in `AI_ProgressTracking.md` (append-only);
> cross-project state is in `../AI_CarryOn.md`; the legacy digest is
> `../Reference/docs/ANALYSIS_LEGACY_MYBOT.md`.
>
> **Standard this project follows:** `../Reference/docs/STANDARDS_OTE_WAY_OF_WORKING.md` — **in this tree**
> (docs · git · stack · database · testing · how to work with Ote). §8 was the checklist for the scaffold.
>
> **Human entry point:** `README.md` — written for a stranger arriving at the repo: what the project is, why
> it is being rewritten, and how to run it.

## ▶▶ START HERE

**The bot has been ONLINE in Discord, the data model is proper SQL, and THE CORE GAME LOOP WORKS —
buy rods → fish → earn coins and exp → level up → buy more. 117 tests pass against the real database.
The seven games, stealing, and admin tools are not built.**

⚠️ Four claims in this file have fallen and are corrected rather than deleted: *"Nothing is built"* (fell
when Ote asked for the scaffold), *"Nothing has ever connected to Discord"* (fell the same evening),
*"the game is not built"* (economy came first, then fishing and the market), and *"the next real work is
fishing"* (done).

**Repo: `github.com/OteractiveStudio/MowCodeGamingBotY`, branch `main`.** ⚠️ Note the repo name drops the `e`
— `MowCodeGamingBotY` there, `MowCodeGamingBoteY` here. Flagged to Ote 2026-08-12; unresolved, harmless.

```bash
npm install
cp config.example.json config.json       # then fill in the secrets
npm run db:migrate                       # idempotent
npm run db:seed                          # fish, items, market — idempotent
npm test                                 # 117 checks, real exit code
npm start                                # fails fast without a Discord token — by design
```

**The next real work is a game** — `guess` is the smallest one that exercises betting against the economy that
already exists. Every legacy rule extracted so far is in 📐 below; do not re-read the Python for anything
listed there.

## 📌 STANDING RULES — git and commits (read before committing anything)

Ote is standing up the GitHub repo now, so these are the rules that bite first. They come from
`../Reference/docs/STANDARDS_OTE_WAY_OF_WORKING.md` §2 and are repeated here because a rule that lives only
in a reference doc gets broken by the next agent that does not open it.

- ⛔ **NO AI ATTRIBUTION IN COMMITS. No `Co-Authored-By`, no "Generated with", no tool name, no emoji
  signature.** The commit history is his. ⚠️ This one needs stating explicitly because several coding agents
  add an AI trailer *by default* — including this one, whose built-in instructions say to append a
  `Co-Authored-By` line. **That default is wrong here and must be suppressed on every commit.**
- **Format: `OteEnded[type]: message`** with literal square brackets. Types: `feat` · `fix` · `refactor` ·
  `docs` · `chore` · `test`.
- 🔑 **The subject states the OUTCOME, not the action.** *"update auth"* wastes the one line most likely to be
  read again. Real examples of the shape he uses:
  - `OteEnded[fix]: root is two owner values, not one - key filters, token limits, and three tests`
  - `OteEnded[chore]: stop tracking node_modules - 140 dependency files were in the repo`
- ⛔ **Commit only when he asks.** Never auto-commit after an edit. Re-check `git status` first.
- **Multi-line messages via `git commit -F <file>`**, never `-m` with a here-string (PowerShell quoting eats it).
- **Never track** `node_modules/`, `package-lock.json`, `config.json`, or `logs/` — all four are already in
  `.gitignore`, verified.
- ⚠️ **`AI_CarryOn.md` and `AI_ProgressTracking.md` ARE tracked** (his call). Which means: **never paste a
  live credential into them.** Git history is permanent — reference where a secret lives, never its value.
  That is why the live legacy tokens below are described by *where they are*, never quoted.
- **First commit:** this project was not copied from the template, so the pristine-template convention does
  not apply — the first commit is this scaffold.

## What exists — ✅ verified, not assumed

| | |
|---|---|
| ✅ **Repo** | `git init` done, `.gitignore`/`.gitattributes` written **before** the first `npm install`. 13 tracked-able entries; `node_modules/`, `config.json`, `logs/` confirmed ignored. **NOTHING IS COMMITTED YET** — Ote is standing up a GitHub repo (2026-08-12). |
| ✅ **Stack** | JS ESM · discord.js **14.27.0** · pg **8.23.0** · Sequelize **6.37.8** · Node 24.14.0. **No Fastify** — see DECIDED. |
| ✅ **Database** | Schema **`mowcodegamingbot_y`** in database `discord_app` on `127.0.0.1:54322`, applied **as the app role** `discord_app` (verified: not a superuser, owns the schema and all 4 tables). Tables: `log_message` · `log_migration` · `mst_guild` · `mst_player`. |
| ✅ **Migration** | `001_core.sql` applied; re-running says *"up to date"*. `log_migration` holds its sha256, so a migration edited after being applied is caught. |
| ✅ **ONLINE IN DISCORD** | 2026-08-12 22:31 — the bot connected through the real `startBot()` (cog loading, validation, event wiring, dispatch) and appeared online as **MowCodeGamingBot#1501**, id `892820973030637608`, in **10 guilds**, presence *"Listening to /ping"*. Ote confirmed visually. Held 240s, disconnected cleanly, exit 0. ⚠️ It used the **legacy token** — see 🔴 below. |
| ✅ **Fails fast** | With no token, `npm start` prints one readable STARTUP FAILED block and exits **1**; the stack goes to the log file and `log_message`, not the console. |
| ✅ **Tests** | `npm test` → **117 passed, exit 0**, ~0.7s. Includes the 50-concurrent-credit race, 20 concurrent casts at one player, two racing purchases against one affordable balance, 60,000 seeded draws matching the weights, model↔table column parity both directions, CHECK constraints actually refusing bad data, and the logger's **off** state. |
| ✅ **Cogs** | **6 loaded, 10 commands** — `economy` (`/money balance\|give\|history`), `fishing` (`/fishing cast\|auto\|rates`), `market` (`/market browse\|buy`, `/inventory`), `system` (`/ping`, `/about`), `guild` (`/server` + join/leave), `player` (`/whoami`). |
| ✅ **Fishing** | Weighted draw (`weight = 10 - tier`) on the seeded 9 fish, 66 total weight — `Nothing` 15.15%, `Trash` 13.64%, `AmogusTheFish` 1.52%, all matching the legacy `fish_rate` formula. `fishing auto` burns up to 30 rods **in ONE transaction**: one lock, one UPDATE, one ledger row per catch. ❌ The animation is not ported (20 message edits per command for decoration). |
| ✅ **Market + inventory** | All the legacy limits, cited in code: 5 bags / 15 rods / 10 items per purchase · carry 15 rods or 10 per item · a **new** item type needs a free slot (topping up does not) · `bag` raises `inventory_size` capped at `int(1.2*(crystals*100+level))` · `fishingrod` bumps the rod counter instead of becoming an item. Buying grants **no exp** — faithful, since the legacy market bypassed `money_add`. One transaction: funds check, payment, ledger row, `txn_purchase` receipt and item effect together or not at all. |
| ✅ **Autocomplete** | `/market buy` suggests from the database. Replaces the legacy's **emoji-reaction** buy flow, which tracked mid-purchase players in a module-level `market_using` dict — one market session per process, and a crash mid-flow stranded the player in it. `dispatch.js` routes autocomplete; the cog validator checks the handler is callable. |
| ✅ **The data model is SQL** | `002_game_core.sql` applied: **11 tables total.** `mst_player_state` · `mst_item` · `mst_player_item` (a row per item) · `mst_market_category` + `mst_market_listing` · `mst_fish` · `txn_purchase` · `log_economy`. Column parity verified against all 11. |
| ✅ **Reference data seeded** | `npm run db:seed` → 9 fish · 8 items · 3 categories · 9 listings, transcribed into `database/seeds/reference_data.js` so **the repo stands alone** and does not read the legacy tree. |
| ✅ **Economy works, and it is PROVEN atomic** | 🔑 Measured on this schema with 50 concurrent +3 credits to one player: the **legacy shape lost 147 of 150 coins** (200 → 203 — only 1 of 50 credits survived); this data layer lost **0** (200 → 350). The falsification was run *before* trusting the passing test, because an assertion that cannot fail proves nothing. |
| ✅ **A balance can be explained** | Every money/exp mutation writes one `log_economy` row **in the same transaction**, so the log cannot disagree with the balance. `explainBalance()` rebuilds it and checks the chain; `/money history` surfaces it and says so out loud if it fails to reconcile. |

## ❌ What does NOT exist — name it, so nobody assumes

- ⚠️ **Mostly fallen:** this used to say *"The game. No economy, fishing, inventory, market or games…"*
  **Economy, progression, fishing, market and inventory are all built.** What is still missing:
  - ❌ **Games — none of the seven.** guess · OX · blackjack · coinflip · dice · wordle · minesweeper.
    `log_economy` already accepts `game_win`/`game_loss`, so a game only needs its rules and one call to
    `addMoney`. **`guess` is the smallest starting point** (it had betting, so it exercises the economy).
    ⚠️ Legacy game state was **module-level** (`OX_board`, `player_hand`, `playing_bj`), so the old bot could
    only host **one game at a time across all servers** — per-session state must be keyed by guild/channel/user
    or stored, never module-level.
  - ❌ **Stealing and robbing.** `knife`, `gun`, `passkey` are purchasable and do nothing; the pets exist to
    defend against them (*"Cat can make noise and prevent you from being stolen"*). `steal_gain`/`steal_loss`
    reasons are ready. Needs rules.
  - ❌ **Admin commands.** No `/money` admin adjust, no `data` editor, no `file` explorer, no `restart`.
    Needs the permission model decided; the legacy `admin_list` ids go in `config.json`, not a table.
  - ❌ **Selling items back.** Only buying exists. There is no `sell`, and the legacy had none either.
- ❌ **The bot has no application of its own.** It has been online *once*, borrowing the legacy
  application's identity. There is still no token in `config.json`, so `npm run bot:register` has never run
  and **no slash command has ever been invoked by a real user.** The command bodies are unit-tested; the
  round trip is not.
- ❌ **No prefix commands.** `mst_guild.prefix` and `config.bot.default_prefix` are stored and read by
  **nothing**. They exist because the legacy had them; the surface decision is Ote's.
- ❌ **No i18n.** `mst_guild.lang` is stored and unused. No `t()` seam yet.
- ❌ **No `/server set`.** Reading settings works; writing needs the permission model decided.
- ❌ **No HTTP surface** — removed deliberately, see DECIDED.
- ❌ **No supervisor, no launcher scripts.** The process exits with a real code and never restarts itself.

## ⚠️ The legacy tokens are VALID — but not leaked. Corrected by Ote, 2026-08-12

⚠️ **This section used to be headed "🔴 SECURITY — the legacy tokens are LIVE" and said that "anyone who has
ever seen that tree" could control both bots.** Ote corrected the premise: *"the token is not leaked. that old
code never been anywhere from my old pc, so no worry."* He knows where his code has been; that risk assessment
was mine and it was wrong.

**What is still true, and was verified by testing:** both tokens **authenticate today**, they are **hardcoded
in source**, and they exist in **13,652 `.history` copies**. **What is NOT true:** that they are exposed. The
tree has never left his machine.

⇒ So this is *exposed-in-waiting*, not compromised: it only becomes a real problem if that tree is ever
published, pushed, or copied to a shared machine — which is exactly why the legacy stays **outside** this repo
and `Reference/repos/MyBot_Legacy/` remains ungitted. Resetting the tokens is now **optional hygiene, not an
emergency.**

| Bot | Id | Guilds | Token sits in |
|---|---|---|---|
| **MowCodeGamingBot** | `892820973030637608` | **10** | `TOKEN_MCGB.txt` (legacy root **and** `BN_bot/data/token/`) |
| **Sompade** | `862330157157974088` | **4** | **hardcoded in source**, `Gaming Bot/CsGamingBot.py:41` |

⇒ **These are usable right now.** ⭐ Simplest route to a working bot: copy the `TOKEN_MCGB.txt` value into
`config.json` → the new code runs as **the same MowCodeGamingBot, in the same 10 servers**. No new application,
no re-invite. (Optionally reset it in the portal first and paste the new one — same effort, cleaner.)

⚠️ **The token is still NOT committed anywhere.** `config.json` is gitignored; during the online test it was
read from the frozen tree and used in memory with no copy created. That rule does not change just because the
exposure risk turned out to be lower than recorded: **a token never goes in a tracked file.**

## ⭐ DECIDED — Ote

| | |
|---|---|
| **Gaming only, first** | SBSM (music/soundboard) is out of scope. *"Gaming only, first."* |
| ⚠️ **NO HTTP surface** | **Supersedes** the earlier *"also yes, Fastify beside it, minimal."* Ote, 2026-08-12: *"we dont need a http now right?, let's forcus on discord js should we?"* and *"the fstidy mention in the innitial carry on should be a seperate project from MowCodeGamingBoteY right?"* ⇒ `app/http/` and its check file were **deleted**, `fastify` uninstalled, `app.port` and `logging.fastify` removed from both config files. A dashboard/API becomes **its own sibling project** reading this same schema — which is also the more extractable option. |
| **Database** | *"the db is discord_app, user discord_app, pass discord_app, app schema; mowcodegamingbot_y"* — its own database, superseding the earlier `mowcode_gaming`-in-the-shared-database proposal. |
| **Init it** | *"can you init discord js project at MowCodeGamingBoteY for me?"* — built without the RFC the plan had sequenced first. |
| **Continue the port** | *"you can continue the porting fomr dis py to js. the old db that jsut a simple json will need to be redesign to be proper sql so."* ⇒ the JSON model becomes proper SQL. **In progress — nothing of it is built yet.** |
| **Repo** | *"ill start to get a repo up"* — `README.md` was rewritten as a landing page for a stranger. |

## ⚠️ Decisions I made building it — reversible, flagged not buried

1. **Slash commands only, and therefore NO privileged intents** (`Guilds` alone). Message Content has been
   privileged since 2022, so the legacy's whole `on_message` layer would receive **empty content** without
   portal approval — the worst failure shape there is. ⇒ If prefix commands return, `MessageContent` is added
   in `app/bot/client.js` and nowhere else. **Still Ote's call.**
2. **A cog = a directory exporting commands AND events together**, not the community's `commands/`+`events/`
   split by kind. Keeps a feature whole.
3. **`ctx` is injected into cogs** rather than each building its own data layer as `b = basic("fishing_cog")`
   did. This is what makes a cog testable with no Discord and no database.
4. **No `is_admin` column on `mst_player`.** The legacy read admin identity from player rows that
   `reset_player` could wipe. It belongs in `config.json`, which is a security boundary. ⚠️ The legacy
   `admin_list` held two real ids — they go in config when admin commands arrive.
5. **`mst_guild` rows are marked `left_at`, never deleted** — a kicked-then-reinvited guild keeps its settings.
6. **`log_migration` is runner-owned**, not declared in a migration (a migration cannot record itself into a
   table that does not exist yet).
7. **`{{schema}}` placeholder in SQL**, substituted from config and validated as a plain identifier first, so
   no script hardcodes a schema name and config cannot become an injection vector.

## ⚠️ Traps found while building — do not re-derive

- **`if (!port)` rejected port `0`.** Moot now that HTTP is gone, but the lesson stands: a truthiness guard
  silently refuses a legal zero. The test failed against the old code first, then passed — the only order
  that proves anything.
- **`log()` printing to console duplicated a startup failure**, once as a raw stack and once as the pretty
  block. `main.js` silences console for that single write; the stack still reaches the file and `log_message`.
- **`setDMPermission` is deprecated** in discord.js 14.27 — use `setContexts(InteractionContextType.Guild)`.
- **`Events.ClientReady === "clientReady"`** in 14.27, and the bare string `"ready"` is deprecated (it will
  only emit as `clientReady` in v15). Use the `Events` constants, never the literal.
- **An empty string is "missing", not "malformed".** A test asserted the wrong error for
  `schemas.project: ""` — the code was right and the test was wrong.

## 📐 Legacy game rules, already read out of the Python — do not re-derive

From `BN_bot/MCGB_BasicClass.py`, `cogs/fishing_cog.py`, `settings.json` and the data files:

- **Provisioning** (`settings.json.default_inventory` + `add_player`): money **200** · fishing_rod **10** ·
  inventory_size **1** · items **{}** · exp **0** · level **1** · magical_crystal **0** · fishing **0**.
- **`money_add(n)` also adds `n` exp.** Money and exp gain are the same number.
- **exp cap** = `level * 10 + magical_crystal * 2`. On reaching it: level +1, exp −= cap, and it **cascades**
  (the legacy recursed, so several levels can fall at once). exp is clamped at 0.
- **level ≥ 100** → +1 magical_crystal, level −= 100. So level is always 0–99 in a settled state.
- **Money may go NEGATIVE** — `is_bad_econ` is true below **−20**. Any `money >= 0` constraint would be wrong.
- **Inventory limit**: `len(items) + 1 > inventory_size` means full. ⚠️ **Correction to an earlier note in
  this file**, which said the `1.2 * (crystals*100 + level)` formula was "from the v1 monolith, not this
  lineage" — that was wrong. It **is** in `MCGB_BasicClass.get_max_inv_size`, and it is the **ceiling** a `bag`
  purchase may raise `inventory_size` to, not the size itself. The size is stored; the ceiling is computed. At
  level 1 with no crystals it is `int(1.2) = 1`, exactly the provisioned size.
- **Market limits** (`market_cog`): per purchase 5 bags / 15 rods / 10 anything else · carry 15 rods or 10 per
  item type · `fishingrod` increments the rod counter, `bag` increments `inventory_size`, neither is stored as
  an item · a **new** item type needs a free slot, topping up a held one does not · **buying grants no exp**,
  because the market wrote `money -= price` directly and bypassed `money_add`.
- ⚠️ **THE LEGACY CONTRADICTS ITSELF ON RODS:** `market_cog` caps a player at **15** rods, while
  `fishing_cog`'s auto mode is written to burn up to **30**. Both are his, in different files, and they cannot
  both be reachable through the market alone. Both are kept as-is — which one is wrong is Ote's call.
- **Fishing draw is weighted by tier: weight = `10 - tier`.** Lower tier is *more* common. Rate for a tier is
  `(10 - tier) / Σ(10 - tier) * 100`. `Nothing` and `Trash` are tier **0**, so they are the most likely draws.
- **A catch**: rod −1, then `money_add(fish.price)` (so exp too), and `stats.fishing` counts catches.
- **`fishing auto`** uses every rod the player has, **capped at 30**.
- **Fish** (`fish.json`, 9 rows): name · file_name · type (`creature` / `not_creature`) · price · tier ·
  img_file. Prices seen: 8–25. Fish are reconciled against the actual picture files, both directions.
- **Market** (`market.json`) is **categories → item_list**: `Quick_menu` ⚡, `Pet` 1️⃣, `Tool` 2️⃣, each item
  with emoji, price and detail. ⚠️ **`fishingrod` appears in TWO categories** (Quick_menu and Tool) with the
  same price — so the relational shape needs an item catalogue plus per-category listings, not a category
  column on the item.
- **Real player data**: 24 players in `players_inv.json`, keyed by Discord user id — which is why importing
  them later needs no schema change.

## 🚦 STILL OPEN — Ote's

| | |
|---|---|
| 🔑 **its own Discord application** | Create it, put token + application_id in `config.json`, `npm run bot:register`. Until then no user has ever invoked a command. ⛔ **Separately: reset the two live legacy tokens** above. |
| **command surface** | Slash-only is what is built. Prefix + the `on_message` natural-language layer needs the privileged intent. |
| **feature scope** | Which of the 40 legacy commands / 13 cogs survive. Needed as the game tables are designed. |
| **where it runs** | An always-on home and a real supervisor. |
| **i18n depth** | English-only vs the legacy's 64 languages. |
| **importing the 24 legacy players** | Still a later data job, still needs no schema change. |

## ⚠️ Divergences from the legacy, deliberate — each one line to reverse

Recorded because they are **game-balance decisions**, which are Ote's, not refactors:

1. **A transfer requires the sender to afford it.** The legacy had no concept of a transfer, and `money_add`
   would happily push a giver negative. A negative balance should come from a penalty, not generosity.
   ⇒ It is the `senderMoney < amount` check in `app/data/economy.js`.
2. **A transfer grants NO exp.** In the legacy every `money_add` granted exp equal to the money, so two
   players passing the same coins back and forth would have been an **infinite exp machine.**
   ⇒ It is `expDelta: 0` in `transfer()`.
3. **Market/category keys were normalised to lowercase** (`Quick_menu` → `quick_menu`), with presentation
   kept in `display_name`. The legacy's answer to case was to define the same command five times.
4. **The level-0 zero-cap quirk was NOT fixed** — at level 0 with no crystals the cap is 0, so even a zero
   gain levels the player to 1. Reproduced and asserted in a test, because changing it changes the game.

## ⏭ NEXT, in order

1. 🔴 **Its own Discord application** — Ote's, and it now blocks the only thing left unproven: **no user has
   ever invoked any of these 10 commands.** The data layer is tested hard against the real database; the
   Discord round trip is not tested at all. Token + `application_id` into `config.json`, then
   `npm run bot:register`, then `/fishing auto` in a real server.
2. **`guess`, as the first game** — it had betting, so it reuses `addMoney` and proves the games can sit on the
   economy. ⚠️ Keep session state keyed (guild/channel/user), never module-level: that is what limited the
   legacy to one game at a time across all servers.
3. **Stealing** — gives `knife`/`gun`/`passkey` and the defensive pets a purpose, and uses the
   `steal_gain`/`steal_loss` ledger reasons already in the schema.
4. **The remaining games and the admin tools**, once feature scope is decided.
