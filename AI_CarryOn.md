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

**The bot has been ONLINE in Discord, the data model is now proper SQL, the economy works, and 75 tests pass
against the real database. Fishing, market, inventory and games are not built.**

⚠️ Three claims in this file have fallen and are corrected rather than deleted: *"Nothing is built"* (fell
when Ote asked for the scaffold), *"Nothing has ever connected to Discord"* (fell the same evening), and
*"the game is not built"* (partly fell — economy and progression are real now).

**Repo: `github.com/OteractiveStudio/MowCodeGamingBotY`, branch `main`.** ⚠️ Note the repo name drops the `e`
— `MowCodeGamingBotY` there, `MowCodeGamingBoteY` here. Flagged to Ote 2026-08-12; unresolved, harmless.

```bash
npm install
cp config.example.json config.json       # then fill in the secrets
npm run db:migrate                       # idempotent
npm run db:seed                          # fish, items, market — idempotent
npm test                                 # 75 checks, real exit code
npm start                                # fails fast without a Discord token — by design
```

**The next real work is fishing** — the weighted draw, then `fishing auto` with its 30-rod cap as one
transaction instead of 120 file rewrites. Every rule it needs is in 📐 below; do not re-read the Python.

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
| ✅ **Tests** | `npm test` → **75 passed, exit 0**, ~0.5s. Includes the 50-concurrent-credit race, 25 concurrent upserts, model↔table column parity both directions, CHECK constraints actually refusing bad data, and the logger's **off** state. |
| ✅ **Cogs** | 4 loaded, 6 commands — `economy` (`/money balance\|give\|history`), `system` (`/ping`, `/about`), `guild` (`/server` + join/leave), `player` (`/whoami`, now with a wallet). |
| ✅ **The data model is SQL** | `002_game_core.sql` applied: **11 tables total.** `mst_player_state` · `mst_item` · `mst_player_item` (a row per item) · `mst_market_category` + `mst_market_listing` · `mst_fish` · `txn_purchase` · `log_economy`. Column parity verified against all 11. |
| ✅ **Reference data seeded** | `npm run db:seed` → 9 fish · 8 items · 3 categories · 9 listings, transcribed into `database/seeds/reference_data.js` so **the repo stands alone** and does not read the legacy tree. |
| ✅ **Economy works, and it is PROVEN atomic** | 🔑 Measured on this schema with 50 concurrent +3 credits to one player: the **legacy shape lost 147 of 150 coins** (200 → 203 — only 1 of 50 credits survived); this data layer lost **0** (200 → 350). The falsification was run *before* trusting the passing test, because an assertion that cannot fail proves nothing. |
| ✅ **A balance can be explained** | Every money/exp mutation writes one `log_economy` row **in the same transaction**, so the log cannot disagree with the balance. `explainBalance()` rebuilds it and checks the chain; `/money history` surfaces it and says so out loud if it fails to reconcile. |

## ❌ What does NOT exist — name it, so nobody assumes

- ⚠️ **Partly fallen:** this used to say *"The game. No economy, fishing, inventory, market or games…
  `mst_player` is identity only."* **Economy and progression are now built.** What is still missing:
  - ❌ **Fishing.** `mst_fish` is seeded but nothing draws from it. Needs the weighted draw (`10 - tier`),
    rod consumption, `fishing_count`, and `fishing auto`'s 30-rod cap as ONE transaction. **Next up.**
  - ❌ **Inventory and market.** `mst_item`, `mst_player_item`, `mst_market_*` exist and are seeded, but
    nothing buys, holds or spends. The inventory-size limit is unenforced because nothing can hold an item.
  - ❌ **Games.** None of the seven. `log_economy` has `game_win`/`game_loss` reasons ready for them.
  - ❌ **Admin/steal/cheat.** `/money` has no admin adjust; `steal_gain`/`steal_loss` reasons exist but no
    rules do. Needs the permission model and the knife/gun/passkey items to mean something.
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

## 🔴 SECURITY — the legacy tokens are LIVE, confirmed by testing

⚠️ This is stronger than the earlier records, which said only *"reset them."* On **2026-08-12** both were
tested against Discord's API and **both still authenticate, five years on:**

| Bot | Id | Guilds | Token sits in |
|---|---|---|---|
| **MowCodeGamingBot** | `892820973030637608` | **10** | `TOKEN_MCGB.txt` (legacy root **and** `BN_bot/data/token/`) |
| **Sompade** | `862330157157974088` | **4** | **hardcoded in source**, `Gaming Bot/CsGamingBot.py:41` |

⛔ **Both must be reset in the developer portal.** Anyone who has ever seen that tree — or any of the 13,652
`.history` copies — can control both bots in 14 guild memberships, some with 100–244 members.

⚠️ **The legacy token was deliberately NOT written into `config.json`.** It was read from the frozen tree,
used in memory for the one online test, and no copy was created. **Do not adopt a compromised credential as
this project's operating credential** — the new bot gets its own application.

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
- **Inventory limit**: `len(items) + 1 > inventory_size` means full. `inventory_size` is **stored, not
  computed** (the `1.2 * (crystals*100 + level)` formula in the digest is from the v1 monolith, not this
  lineage).
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

1. **Fishing** — the weighted draw (`weight = 10 - tier`, so `Nothing`/`Trash` dominate), rod consumption,
   `fishing_count`, and **`fishing auto` (30-rod cap) as ONE transaction** rather than the legacy's 120 file
   rewrites. `mst_fish` is already seeded; `addMoney(reason: 'fishing_catch', ref: fish_key)` already exists,
   so a catch is a few lines behind the seam.
2. **Inventory + market** — buying moves coins via `addMoney(reason: 'market_purchase')`, writes
   `txn_purchase`, and inserts/increments `mst_player_item` in the same transaction, honouring
   `inventory_size`. The `bag` item raises that size.
3. **Its own Discord application**, then `/money balance` invoked by a real user — the first true end-to-end
   proof of a command with a database behind it.
4. **Games**, once feature scope is decided. `log_economy` already accepts `game_win`/`game_loss`.
