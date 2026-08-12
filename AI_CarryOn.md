# AI_CarryOn.md — MowCodeGamingBoteY

> Short handoff for **this project only**. Long history goes in `AI_ProgressTracking.md` (append-only);
> cross-project state is in `../AI_CarryOn.md`; the legacy digest is
> `../Reference/docs/ANALYSIS_LEGACY_MYBOT.md`.
>
> **Standard this project follows:** `../Reference/docs/STANDARDS_OTE_WAY_OF_WORKING.md` — **in this tree**.
> **Human entry point:** `README.md`.

## ▶▶ START HERE

**The bot is LIVE in Ote's server and the game loop works.** 8 cogs · 10 commands · 11 tables ·
**154 tests** · 12 commits on `main`.

**Repo:** `github.com/OteractiveStudio/MowCodeGamingBotY` (⚠️ repo name drops the `e` — flagged, harmless).

```bash
npm install
cp config.example.json config.json    # token + DB password go here; gitignored
npm run db:migrate                    # 001, 002, 003 — idempotent
npm run db:seed                       # fish, items, market — idempotent
npm test                              # 154 checks, real exit code
npm run bot:register                  # ONLY after changing a SlashCommandBuilder
npm start
```

⚠️ **The bot runs under the LEGACY MowCodeGamingBot application** (`892820973030637608`, 10 guilds), on
Ote's instruction. Its token is in `config.json` via `DevTools/maintenance/use-legacy-token.mjs`.
`dev_guild_id` is `859279060999995392`.

## What exists — ✅ verified against the real thing

| | |
|---|---|
| ✅ **Live** | Logged in as `MowCodeGamingBot#1501`, 10 guilds. Commands invoked by Ote for real. |
| ✅ **Stack** | JS ESM · discord.js **14.27** · pg · Sequelize 6 · Node 24. **No Fastify** (removed). |
| ✅ **Database** | `discord_app` on `127.0.0.1:54322`, schema **`mowcodegamingbot_y`**, applied as the app role (not a superuser). **11 tables.** |
| ✅ **Economy** | Coins, exp, level, crystals. Cascade is pure + unit-tested. Every mutation writes `log_economy` **in the same transaction**. 🔑 Measured: legacy read-modify-write lost **147 of 150** coins under 50 concurrent credits; this loses **0**. |
| ✅ **Fishing** | Weighted draw (`10 - tier`), 9 fish, 66 total weight. `auto` = 30 rods in **ONE transaction**. **His animation is restored**, with his own `rod_left < 21` throttle. |
| ✅ **Market** | **Public click-through**: full contents visible, direct buttons per section and item, quantity buttons, modal for a custom amount, **Close** button. Owner-gated — anyone may click, non-owners get a private rejection. |
| ✅ **Games** | `/guess` (bet 10–1000, 7 attempts, ×5/×2/×1.5/×0.5, per-guess cost) and `/ox` (3×3 **button grid**, vs bot or duel). |
| ✅ **Legacy players imported** | All **24**, keyed by Discord id. `emanresu` leads: 1401 coins, level 31, 397 catches. |
| ✅ **Drift check** | On boot, compares the published command list to the code and names what differs. Verified live. |

## ❌ What does NOT exist

- ❌ **Blackjack, coinflip, dice, wordle, minesweeper.** `guess` and `ox` are the only games.
- ❌ **Stealing/robbing.** `knife`/`gun`/`passkey` are purchasable and do nothing. `steal_gain`/`steal_loss`
  ledger reasons exist, unused. Pets (`cat`/`dog`) were the defence.
- ❌ **Admin commands.** No `/money` adjust, no `data` editor, no `file` explorer, no `restart`. The legacy
  `admin_list` ids (`403536649222356992`, `880012304740126720`) go in `config.json` when they land.
- ❌ **Selling items back.** Buying only — the legacy had no sell either.
- ❌ **i18n.** `mst_guild.lang` stored, unused. No `t()` seam.
- ❌ **Prefix commands.** `mst_guild.prefix` + `bot.default_prefix` stored, read by nothing.
- ❌ **Autocomplete is now UNUSED.** `dispatch.js` still routes it, but `/buy` was deleted, so nothing
  declares it. Infrastructure, currently unexercised.
- ❌ **No supervisor.** The process exits with a real code and never restarts itself.

## ⭐ DECIDED — Ote, with his words

| | |
|---|---|
| **Gaming only** | *"Gaming only, first."* SBSM/music/TTS are out of scope. |
| **No HTTP** | *"we dont need a http now right?"* + *"the fstidy... should be a seperate project"* ⇒ Fastify **removed**. A dashboard is its own project. |
| **Database** | *"the db is discord_app, user discord_app, pass discord_app, app schema; mowcodegamingbot_y"* |
| **Market UX** | *"i like the old way of nav"* → *"everyone can see when user call market... also can click reaction, just my program rejected it"* → *"why market now collapse like this?... why it dropdown menu? not a direct button"* → *"where's an option to close the market?"* ⇒ **public, full contents, direct buttons, Close.** |
| **One command** | *"make it just /market"* + *"no need to /buy"* ⇒ `/market` only; `/buy` deleted. |
| **Timestamps** | *"all db model timestamps: true please"* ⇒ migration 003, every model `timestamps: true`. |
| **Improve his code** | *"you can improve the logic of game running, the old code was when im a student"* + *"fix my old logic bug and go on"* + *"that was my event odler code. if there's bug. fix and ship"* |
| **Tokens not leaked** | *"the token is not leaked. that old code never been anywhere from my old pc"* ⇒ valid but unexposed; resetting is optional hygiene. |

## ⚠️ TRAPS — do not re-derive these

1. 🔑 **Discord gives 3 SECONDS to acknowledge an interaction.** `/market` and `/ox` died with
   `DiscordAPIError[10062]: Unknown interaction` because they read Postgres before replying.
   ⇒ **`dispatch.js` defers EVERY chat-input command**; cogs answer via `respond()` from
   `app/bot/respond.js`. **Never call `deferReply()` in a cog** — that is a second defer and throws.
   ⇒ **Components are NOT deferred**: `showModal()` cannot follow a defer.
   ⇒ `editReply` cannot set ephemeral; declare `defer: "ephemeral"` on the command instead.
2. **Re-register only when a `SlashCommandBuilder` changes**, not when `execute()` changes. The boot-time
   drift check names what drifted if you forget.
3. **A command cannot have both a bare form and subcommands.** That is why `/market browse` became
   `/market` and `/buy` had to be top-level (then deleted).
4. **`if (!port)` rejects port 0.** A truthiness check on a legal zero. Test failed pre-fix, passed post-fix.
5. **The session lock map grew forever** because cleanup compared against the inner promise, not the chained
   one. Now in `app/data/session-store.js`, one copy, shared by guess and ox.
6. **`setDMPermission` is deprecated** → `setContexts(InteractionContextType.Guild)`.
7. **`Events.ClientReady === "clientReady"`**; the bare string `"ready"` is deprecated.
8. **BIGINT comes back from pg as a STRING.** `toInt()` throws rather than doing wrong arithmetic on money.
9. ⚠️ **I claimed two OX payout bugs that DO NOT EXIST** — I stopped reading at the first win-check. `OX_out`
   has TWO, one per mover; the bot's win is handled separately and charges the human by index. His code was
   right. Corrected in `1a82080` and in `app/data/ox.js`'s header.

## 📐 Legacy rules already extracted — do not re-read the Python

- **Provisioning**: money **200** · rods **10** · inventory_size **1** · exp 0 · level 1 · crystals 0.
- **`money_add(n)` also adds `n` exp.** Earning grants exp; **spending does not** (the market bypassed
  `money_add`). Transfers grant none either (would be an infinite exp machine).
- **exp cap** = `level*10 + crystal*2`; at cap → level +1, remainder carries, **cascades**. Level **100** →
  +1 crystal, level −100. Level settles **0–99**. exp clamps at 0.
- ⚠️ **Level-0 zero-cap quirk REPRODUCED**: at level 0 with no crystals the cap is 0, so even a zero gain
  levels you to 1. Asserted in a test, not "fixed".
- **Money may go NEGATIVE**; below **−20** is bad econ.
- **Fishing**: weight `10 - tier` (lower = commoner), rod −1 per cast, catch auto-sold, `auto` cap **30**.
- **Market**: per purchase 5 bags / 15 rods / 10 else · carry 15 rods / 10 per item · a NEW item type needs
  a free slot, topping up does not · `bag` raises `inventory_size` up to `int(1.2*(crystals*100+level))` ·
  `fishingrod` bumps the rod counter instead of becoming an item.
- ⚠️ **He contradicts himself on rods**: market caps at **15**, `fishing auto` burns up to **30**. Both kept.
- **Guess**: bet 10–1000 (default 10) · 7 shared attempts · target 1–100 · 5 min · ×5 / ×2 / ×1.5 / ×0.5 /
  nothing · losers pay `round(guesses × bet / 7)`.
- **OX**: duel bet ≤1000 (both must afford), vs bot ≤40 · vs bot **win half, lose all** · duel winner takes
  the full bet · draw pays nobody · **the bot plays at RANDOM on purpose** (the weak bot is the balance).
- ⚠️ **OX bankruptcy guard** tested `< -10` while its message said `-20`. We use −20.

## ⚠️ Divergences from the legacy — game balance, Ote's to reverse

1. **Transfers require the sender to afford it** (his would push a giver negative).
2. **Transfers grant no exp** (else passing coins back and forth farms exp forever).
3. **Guess timeout now bills the guessers**, as running out of attempts does. His charged nothing.
4. **Guess: the target-setter wins** when nobody guesses — his message said so while the code paid the
   *last guesser*. This is the bug he asked to have fixed.
5. **OX: giving up settles as a loss** (else quitting is a free escape from a lost position).
6. **OX games/challenges expire** (5 min / 2 min), paying nobody. His had no timeout, and because his state
   was global an abandoned board blocked OX in **every** server.
7. **Market/category keys lowercased**, presentation in `display_name`.
8. **No bet escrow.** Sessions are in-memory; escrow + a restart would take coins with no game to win them
   back. Nothing is deducted until a game ends, so a lost session costs nobody anything.

## ⏭ NEXT, in order

1. **Blackjack** — the game that needs **ephemeral hands** so players cannot see each other's cards. The
   legacy kept `player_hand` module-level, so it hosted one game bot-wide; use `ChannelSessions`.
2. **Stealing** — gives `knife`/`gun`/`passkey` and the defensive pets a purpose; `steal_gain`/`steal_loss`
   are already valid ledger reasons.
3. **coinflip / dice** — both small; coinflip's legacy rules are in `CsGamingBot.py` around line 1240
   (min 6 coins to play, bet ≥3, bet ≤ half your money, and a rigged branch above 100,000 coins).
4. **Ote's own legacy row** is NOT imported — `/whoami` provisioned him fresh first. His legacy figures:
   925 coins, level 23, 131 catches, dog×1. Run
   `node DevTools/maintenance/import-legacy-players.mjs --yes --overwrite` to take it (overwrites his
   current test progress).
5. **The README is behind**: it still lists `/market buy`, says 132 tests, and omits `/guess` and `/ox`.

## 🧰 DevTools (workspace root, outside this repo, ungitted)

| Script | |
|---|---|
| `use-legacy-token.mjs` | copies the legacy token file → `config.json`, prints only a fingerprint |
| `import-legacy-players.mjs` | the 24-player import, dry-run by default |
| `pg-purge-test-rows.mjs` | removes reserved 9xx… test ids after a killed run, dry-run by default |
| `pg-clean-temp.mjs` | drops stranded `pg_temp_*` schemas (copied from the `AI_LLMv2` workspace — **fix bugs in both copies**) |
| `check-legacy-tokens.mjs` | are the old tokens still valid (they are) |
| `bot-online-smoke.mjs` | bring the bot online for N seconds via the real `startBot()` |
| `prove-atomicity.mjs` | the 147-of-150-lost measurement |
