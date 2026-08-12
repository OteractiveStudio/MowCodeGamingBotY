# AI_CarryOn.md — MowCodeGamingBoteY

> Short handoff for **this project only**. Long history goes in `AI_ProgressTracking.md` (append-only);
> cross-project state is in `../AI_CarryOn.md`; the legacy digest is
> `../Reference/docs/ANALYSIS_LEGACY_MYBOT.md`.
>
> **Standard this project follows:** `../Reference/docs/STANDARDS_OTE_WAY_OF_WORKING.md` — **in this tree**.
> **Human entry point:** `README.md`.

## ▶▶ START HERE

**The bot is LIVE in Ote's server, the game loop works, and three games are playable.**
8 cogs · **11 commands** · 11 tables · **199 tests** · 15 commits on `main`.

🔑 **RUN IT WITH `run_windows.bat`** (or `node main.js`), **NEVER `npm start`** — see TRAPS #9. npm runs the
bot as a child process, so stopping npm orphans it. `main.js` records its own pid in `logs/bot.pid`, which is
how the run script tells our bot apart from any other Node process on the machine; `stop_windows.bat` reads it.

**Repo:** `github.com/OteractiveStudio/MowCodeGamingBotY` (⚠️ repo name drops the `e` — flagged, harmless).

```bash
npm install
cp config.example.json config.json    # token + DB password go here; gitignored
npm run db:migrate                    # 001-004 — idempotent
npm run db:seed                       # fish, items, market — idempotent
npm test                              # 199 checks, real exit code
npm run bot:register                  # ONLY after changing a SlashCommandBuilder
run_windows.bat                       # or: node main.js  (NEVER npm start)
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
| ✅ **Games** | `/guess` — **type a bare number in chat**, his original UX. The Guess button and its modal were REMOVED at his request; `/guess try` survives as the guaranteed path. Cancel = **starter or a config bot admin**. `/ox` — 3×3 **button grid** labelled 1–9, vs bot or duel, give-up settles as a loss. |
| ✅ **Stealing** | `/steal` + `/crime`. **The five prop items finally work**, and the mechanic came from his own item text: passkey=steal 35% · knife=rob 50% · gun=rob 70% · cat defends steal −30% · dog defends both −50%. Tool is **consumed** either way; 10-min cooldown on `last_steal_at`; up to a third of theirs, a third of yours as bail. Crime pays **no exp**. |
| ✅ **Bot admins** | `config.bot.admin_ids` — his legacy `admin_list` ids, moved out of player rows (where `reset_player` could wipe them) into config. `app/bot/permissions.js`, tested to never default open. |
| ✅ **MESSAGE CONTENT intent is ENABLED** on the legacy application | Verified by a successful login with it requested (`wired 4 event binding(s)`). ⚠️ Requesting it without the portal toggle makes **login itself fail**; `app/bot/index.js` catches that, rebuilds without it, and says which switch to flip. Flag: `discord.message_content_intent`. |
| ✅ **Legacy players imported** | All **24**, keyed by Discord id. `emanresu` leads: 1401 coins, level 31, 397 catches. |
| ✅ **Drift check** | On boot, compares the published command list to the code and names what differs. Verified live. |

## ❌ What does NOT exist

- ❌ **Blackjack, coinflip, dice, wordle, minesweeper.** `guess`, `ox` and `steal` are what exist.
- ❌ **Admin COMMANDS.** `admin_ids` exists and gates game cancellation, but there is no `/money` adjust,
  no `data` editor, no `file` explorer, no `restart`.
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
| **Type to guess** | *"can you make it the old style where user type in chat to guess? it better ux then out in a form every time?"* + *"dont forget to remove guess button"* ⇒ bare digits in chat; button and modal deleted. Needs the Message Content intent, which IS enabled. |
| **Keep his guesses visible** | *"dont del my message when i guess number"* then *"i mean you shoukd remove your message, not user's/ right?"* ⇒ the BOT's old board is deleted, the player's message stays. |
| **Admin-only cancel** | *"make it only admin for now please"* (after a Manage-Messages holder cancelled his game) ⇒ `config.bot.admin_ids`, not Discord permissions. |
| **OX board 1–9** | *"as we use ui, we can improve this. use 1 2 3 4 5 6 7 8 9 so it look cleaner"* ⇒ his 11–33 row/col labels are gone; you click a square, so the row digit bought nothing. |
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
9. 🔑 **`npm start` ORPHANS THE BOT.** `TaskStop`/killing npm leaves its `node main.js` child holding
   the gateway — **six** old builds were answering interactions at once, so freshly-rendered buttons
   were handled by processes that had never heard of them. ⇒ **Always run `node main.js` directly**,
   and check with
   `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ? { $_.CommandLine -like '*main.js*' }`.
   ⚠️ PID 23436 (`"C:\Program Files\nodejs\node.exe" main.js`, started 22:12) is **NOT ours** — leave it.
10. **A session created before a reply must be rolled back if the reply throws.** An `/ox` whose reply
   died on the 3-second limit left the game in the map, so the channel refused new games for one that
   was never shown. Both ox and guess now undo it.
11. ⚠️ **An `on_message` listener must be free for non-matching messages.** His `fishing_cog` ran a
   NETWORK TRANSLATION per message to test for "fish". The guess listener checks: bot? → Map lookup? →
   bare-digits regex? — and only then touches the database.
12. ⚠️ **I claimed two OX payout bugs that DO NOT EXIST** — I stopped reading at the first win-check. `OX_out`
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
8. **Stealing: the tool is CONSUMED**, and success is a real chance per tool rather than his
   guaranteed-fail-then-guaranteed-succeed pair. Both are balance calls — see `app/data/steal.js`.
9. **Stealing has a 10-minute cooldown.** His had none, which made it grief-spam.
10. **Crime pays no exp**, so robbing cannot be a levelling strategy.
11. **No bet escrow.** Sessions are in-memory; escrow + a restart would take coins with no game to win them
   back. Nothing is deducted until a game ends, so a lost session costs nobody anything.

## ⏭ NEXT, in order — recommended sequence

1. **coinflip + dice** — both small, and they finish the "quick bet" set. Coinflip's rules are in
   `CsGamingBot.py` ~line 1240: **min 6 coins to play · bet ≥3 · bet ≤ HALF your money** (the default bet
   IS half) · head/tail accepted as `h`/`head`/`หัว` and `t`/`tail`/`ก้อย`/`หาง`.
   🔴 **UNANSWERED QUESTION FOR OTE, asked twice:** his coinflip has a **rigged branch above 100,000
   coins** that appends the losing side to the chance list, stacking the odds against rich players.
   Anti-inflation or a joke? ⇒ **Default plan: leave it OUT**, document it in the file header with his
   exact lines. A rig players cannot see erodes trust in an economy; if he wants it, it should be a
   *visible* rule.
2. **Blackjack** — the big one. Needs **ephemeral hands** so players cannot see each other's cards, emoji
   cards, and ace prompting. `player_hand`/`playing_bj` were module-level in the legacy, so it hosted one
   game bot-wide; use `ChannelSessions`.
3. **wordle** — `BN_bot/data/wordle/words.txt` + `daily_word.json` need importing as reference data.
4. **minesweeper** — self-contained generator, the oldest file in the tree (2020, pre-Discord).
5. **Admin commands** — `admin_ids` already exists; `/money adjust` is the obvious first one.
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
