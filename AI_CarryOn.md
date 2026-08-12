# AI_CarryOn.md — MowCodeGamingBoteY

> Short handoff for **this project only**. Long history goes in `AI_ProgressTracking.md` (append-only);
> cross-project state is in `../AI_CarryOn.md`; the legacy digest is
> `../Reference/docs/ANALYSIS_LEGACY_MYBOT.md`.
>
> **Standard this project follows:** `../Reference/docs/STANDARDS_OTE_WAY_OF_WORKING.md` — **in this tree**.
> **Human entry point:** `README.md`.

## ▶▶ START HERE

**The bot is LIVE in Ote's server, the game loop works, and SEVEN games are playable.**
16 cogs · **22 commands** · 13 tables · **375 tests** · 35 commits on `main`.
⛔ **`mst_player` is EMPTY — the economy was deliberately started over on 2026-08-13.** See DECIDED.

🔑 **RUN IT WITH `run_windows.bat`** (or `node main.js`), **NEVER `npm start`** — see TRAPS #9. npm runs the
bot as a child process, so stopping npm orphans it. `main.js` records its own pid in `logs/bot.pid`, which is
how the run script tells our bot apart from any other Node process on the machine; `stop_windows.bat` reads it.

**Repo:** `github.com/OteractiveStudio/MowCodeGamingBotY` (⚠️ repo name drops the `e` — flagged, harmless).

```bash
npm install
cp config.example.json config.json    # token + DB password go here; gitignored
npm run db:migrate                    # 001-006 — idempotent
npm run db:seed                       # fish, items, market, 2004 wordle words — idempotent
npm test                              # 375 checks, real exit code
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
| ✅ **Database** | `discord_app` on `127.0.0.1:54322`, schema **`mowcodegamingbot_y`**, applied as the app role (not a superuser). **13 tables.** |
| ✅ **Economy** | Coins, exp, level, crystals. Cascade is pure + unit-tested. Every mutation writes `log_economy` **in the same transaction**. 🔑 Measured: legacy read-modify-write lost **147 of 150** coins under 50 concurrent credits; this loses **0**. |
| ✅ **Fishing** | Weighted draw (`10 - tier`), 9 fish, 66 total weight. `auto` = 30 rods in **ONE transaction**. **His animation is restored**, with his own `rod_left < 21` throttle. |
| ✅ **Market** | **Public click-through**: full contents visible, direct buttons per section and item, quantity buttons, modal for a custom amount, **Close** button. Owner-gated — anyone may click, non-owners get a private rejection. |
| ✅ **Games (7)** | `/guess` — **type a bare number in chat**, his original UX. The Guess button and its modal were REMOVED at his request; `/guess try` survives as the guaranteed path. Cancel = **starter or a config bot admin**. `/ox` — 3×3 **button grid** labelled 1–9, vs bot or duel, give-up settles as a loss. |
| ✅ **Coinflip + dice** | `/coinflip` — call a side for 3..half your money (default = half; min 6 to play, a **derived** limit). `/dice` — 2..1000, default 10; even/odd/high/low 1:1, **exact face ×3 as profit** (so 4× in hand); high is `>3`; **his 5-frame animation restored**. ⭐ Both take the call as **TYPED FREE TEXT with his alias table** (`h`/`head`/`หัว`, `e`/`even`/`คู่`, bare `1`-`6`), NOT a dropdown — *"plain chat better ux"*. Autocomplete hints, does not gate. |
| ✅ **Blackjack** | `/blackjack` + `/bj` (his `bj`/`Bj`/`BJ` trio collapsed — slash names are lowercase). Buttons replace typed `h`/`s`/`dd`/`sd`/`in`. **Hands are PUBLIC** — ⚠️ an earlier carry-on note claimed it needed ephemeral hands "so players cannot see each other's cards"; **that was wrong**, his blackjack is one player vs the dealer, so only the hole card hides. 🔑 **His version had 10 real defects — see `app/data/blackjack.js`'s header, all FIXED and numbered.** Measured after the fix: **4.73% naturals** (theory 4.83%) and a **−0.92% house edge** over 20,000 simulated hands, which his 13-card deck made impossible. |
| ✅ **Wordle** | `/wordle start` · `board` · `rules`. **Type guesses in chat**, anyone in the channel may play. 🔑 **His wordle was NEVER a working Discord command** — the monolith has the helpers and a full help entry but no `@client.command()`; `woodle2.py` is a `while True: input()` console prototype. So this was finishing it, not porting it. ⭐ His rules kept: **4-6 letters (NOT 5)**, 6 attempts, 🟩/🟨/🟥, his **A-M / N-Z keyboard tracker**, wrong length costs no attempt, **guesses need not be real words**, answer revealed on a loss, and **no bet** (his had none). 🔑 **His word source was `zenquotes.io` → `api.datamuse.com`, called at MODULE IMPORT** — so booting the bot made two HTTP calls and recursed unboundedly on no match. `words.txt` was meant to fix that and is **ZERO BYTES**. Now `mst_wordle_word`, **2,004 words** seeded from the repo. |
| ⚖️ **The high-roller brake is PORTED** | Above `bot.high_roller_threshold` (default **100000**, `>` so it starts at 100,001) the coin appends **the opposite of the player's own call** — win odds 1/2 → **1/3**, EV **−bet/3**. Biased against the *player*, not a side; re-read every flip so **1-2 max-bet losses switch it off** (a soft ceiling). ⭐ Ote: *"yeah it was my an anti-inflation thing"*. **VISIBLE** (own embed field, before the result) and **LOGGED** at `warning` + ledger `ref` suffix `:highroller`, both at his request. Set the config key to `null` to disable. |
| ✅ **Stealing** | `/steal` + `/crime`. **The five prop items finally work**, and the mechanic came from his own item text: passkey=steal 35% · knife=rob 50% · gun=rob 70% · cat defends steal −30% · dog defends both −50%. Tool is **consumed** either way; 10-min cooldown on `last_steal_at`; up to a third of theirs, a third of yours as bail. Crime pays **no exp**. |
| ✅ **Bot admins** | `config.bot.admin_ids` — his legacy `admin_list` ids, moved out of player rows (where `reset_player` could wipe them) into config. `app/bot/permissions.js`, tested to never default open. |
| ✅ **MESSAGE CONTENT intent is ENABLED** on the legacy application | Verified by a successful login with it requested (`wired 4 event binding(s)`). ⚠️ Requesting it without the portal toggle makes **login itself fail**; `app/bot/index.js` catches that, rebuilds without it, and says which switch to flip. Flag: `discord.message_content_intent`. |
| ⛔ **Legacy players — IMPORTED, THEN DELETED** | **The economy started over on 2026-08-13.** All 24 imported players and their history were removed; see DECIDED. `mst_player` is **empty**. Everyone is provisioned fresh at 200 coins on their next command. **Do not re-import** — `import-legacy-players.mjs` now refuses. |
| ✅ **Admin tools** | `/admin money · player · reset · fish · stats · cogs`. ⭐ **ONE gate** at the top of `execute()`, not per-branch — his `data` re-tested `is_admin` in every branch and his **`file` command forgot entirely**, so anyone in any of 12 servers could list and download files off the host. 🔑 **`log_economy.actor_id` is finally written** — unused since migration 002 — so an `admin_adjust` names *who* did it. ⚠️ `/admin money` grants **NO exp by default** (his `money_add` always did, so a 10,000 top-up would have handed out ~13 levels); opt in with `grant_exp:true`. Reset is button-confirmed with the target in the customId, so there is **no pending-confirmation state to strand**, and admin is **re-checked on the click** because a customId is client-supplied. |
| ✅ **Feedback** | `/feedback msg:…` → `log_feedback`, at Ote's request: *"record feedbacks to a pg table, so user adn feedback our new system"*. **Ephemeral** (`defer: "ephemeral"`) because feedback is often *about* other players. Rate-limited **5 per hour**, counted from real rows so a restart does not reset it. 🔑 **NO foreign key to `mst_player` — deliberately.** Every other player table cascades, which would have meant the 2026-08-13 player wipe **deleted all feedback**; a `username_at_time` snapshot keeps a row readable after its author's row is gone. Read it with `/admin feedback [status] [limit]`, which has a **Mark all as read** button (idempotent, scoped to `status='new'` in SQL). |
| ✅ **i18n — CATALOGUES, not machine translation** | `lib/i18n.js` + `app/i18n/{en,th}.js`, **63 keys each, both 100%**. `/server set language`, `/server show` reports per-language coverage. 🔑 **His mechanism is NOT rebuilt**: `translate_msg_out` machine-translated *every string at send time* — a network call per string in front of the 3-second window, non-deterministic so nothing is testable, and it mangles markdown/mentions/emoji (his own text has a stray Thai word inside an English sentence). Cost: his advertised 64 languages. ⚠️ **COVERAGE IS PARTIAL** — `/help`, `/rand`, `/trans`, `/server`, `/ping`, `/about`, `/feedback`, prefix redirect. **The games are NOT converted** (several hundred strings). `missingKeys()`/`strayKeys()` measure it; a test forbids stray keys. |
| ✅ **`/help` · `/rand` · `/trans`** | `/help` is **built from the live cog registry**, so it cannot drift the way his hardcoded help had (it advertised wordle when no wordle command existed). `/rand` keeps his credit to **มิกกี้**; ⚠️ FIXED — his refused equal bounds as "invalid format" when `rand 5 5` is a question with one answer. `/trans` keeps the live translation because *asking* for one is worth a round trip — guarded with a timeout, shape checks at every level, no new dependency, and a config switch. |
| ✅ **Prefix commands — ANSWERED: they still work, but they REDIRECT** | They need the Message Content intent (this bot has it). Not rebuilt, because it would need an Interaction adapter per handler and a modal cannot open from a message at all. Instead `<prefix>fishing` → *"that is `/fishing` now"*, including renamed ones (`inv`, `stats`, `bj`, `cf`, `xo`, `data`, `cheat`, `wordleplus`). **`mst_guild.prefix` is finally read**, and settable. |
| ✅ **Rotating status + avatar self-check** | His 14-line cycle, at **60s not 7s** — 7s is 12,342 presence updates/day against a ~5-per-20s limit. Clamped to a 15s floor, `null` disables. ⚠️ Avatar compared by Discord's **hash, not bytes** (Discord re-encodes uploads, so his byte compare would have re-uploaded every boot) and attempted **ONCE, never retried** (limit is ~2/hour, and his looped). Off unless `bot.avatar_file` is set. |
| ✅ **`/admin restart` + a REAL supervisor** | His `os.system("python MCGB_Launcher.py")` **blocked the dying parent on its own replacement**. Now: exit **42** = "start me again", and `run_windows.bat`/`run_linux.sh` are the supervisor loop. `MCGB_SUPERVISED=1` is exported by them and **the command refuses without it** — a restart button that kills the bot for good is worse than none. His countdown, presence change and "I'm back! :D" all kept (notice file, cleared when read). |
| ✅ **TTS** | `/tts join · say · stop · leave` + reads the bound channel aloud, his shape. Stack needs **no native builds**: `@discordjs/voice` + `@noble/ciphers`, ffmpeg emitting **ogg/opus directly** (no `@discordjs/opus`, no JS PCM re-encode), `ffmpeg-static` bundled. 🔑 **6 defects fixed** — see `app/data/tts.js`. ⚠️ **AUDIBILITY IS UNVERIFIED**: endpoint→mp3→Ogg/Opus→Ready→Idle-driven queue all checked against the real services, but sound coming out needs a human in a channel. The cog logs the voice dependency report on load. |
| ✅ **Drift check** | On boot, compares the published command list to the code and names what differs. Verified live. |

## ❌ What does NOT exist

- ❌ **minesweeper.** ⏭ **SKIPPED at Ote's instruction** — *"then skip minesweeper to Admin commands"*. Everything else
  is built: `guess`, `ox`, `steal`, `coinflip`, `dice`, `blackjack`, `wordle`.
- ✅ ~~Admin COMMANDS~~ **— now built.** `/admin money · player · reset · fish · stats · cogs`, all behind ONE
  gate. ❌ Still absent **on purpose**: a **file explorer** (his had *no admin check at all* — see below),
  **`reset all`** (use `DevTools/maintenance/reset-players.mjs`, which backs up first), **cog reload** (ESM
  caches by URL and cannot be invalidated, so a "reload" would import nothing and claim success), and
  **`restart`** (no supervisor exists yet).
- ❌ **Selling items back.** Buying only — the legacy had no sell either.
- ✅ ~~i18n~~ **— the seam exists**; coverage is partial and the games are unconverted. See above.
- ✅ ~~Prefix commands~~ **— answered and redirected**, not rebuilt. See above.
- ✅ ~~Autocomplete is UNUSED~~ **— no longer true.** `/coinflip` and `/dice` both declare it, because Ote
  wanted the call **typed, not picked** (*"plain chat better ux"*). It had been dead since `/buy` was deleted.
- ✅ ~~No supervisor~~ **— the run scripts are one.** Exit 42 = restart; anything else stops.
- ❌ **Music.** `play`/`q`/`skip`/`pause`/`resume`/`dc` — three separate implementations in the legacy,
  still out of scope. The voice stack now exists, so this is smaller than it was.
- ❌ **`activity`** (Discord voice-channel activities), **`server list`** (every guild the bot is in),
  **selling items back**, **minesweeper** (skipped on his instruction).

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
| ⚖️ **KEEP the high-roller brake** | 2026-08-13, asked a third time with the mechanic spelled out: *"It doesn't stop you winning. It makes you win less often" oh, then that fine for me."* then *"yeah it was my an anti-inflation thing, so"*. ⇒ **PORTED**, with his two conditions: *"but visible, yeah"* and *"but make it log when this system fired"*. ⚠️ The earlier plan to leave it out is SUPERSEDED — do not remove it. |
| ⭐ **Typed calls, not dropdowns** | *"plain chat better ux"* on `/coinflip`'s side and `/dice`'s call ⇒ free-text options with his full alias table, autocomplete as hints only. Third time he has rejected a picker: market dropdown → buttons, guess modal → typed chat, and now these. **Assume typed over picked unless he says otherwise.** |
| **Tokens not leaked** | *"the token is not leaked. that old code never been anywhere from my old pc"* ⇒ valid but unexposed; resetting is optional hygiene. |
| ⛔ **START THE ECONOMY OVER** | 2026-08-13, after seeing both legacy saves side by side: *"ok, as i see the real data. i think i would be to start over. no need to port them no more"* ⇒ **all 24 players + their ledgers, items and purchases DELETED**; game content kept. He chose *"wipe players, keep reference data"* over keeping them or a full re-seed. **This closes the legacy-player-import thread for good.** Backup at `DevTools/backups/players_before_reset_20260812_180845.json` (outside the repo — real ids and balances). Ran `DevTools/maintenance/reset-players.mjs --yes`. |

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
14. 🔑 **`flags: Ephemeral` PASSED TO `respond()` IS SILENTLY DROPPED.** `dispatch.js` defers every
   chat-input command **publicly** before the handler runs, and `editReply()` cannot change ephemerality
   afterwards — so `respond(i, { flags: MessageFlags.Ephemeral })` produces a **PUBLIC** reply. Every such call
   in the tree today is on a *rejection* where public is merely untidy, but `/admin` would have leaked player
   inspections into the channel. ⇒ **A command that must answer privately declares `defer: "ephemeral"`** on the
   command object (`app/cogs/admin/index.js` is the first and only user). To then post something public from an
   ephemeral command, use `interaction.channel.send()` — **NOT `followUp()`, which inherits the privacy**.
   Caught by a test asserting the refusal was ephemeral; it was not.
13. 📌 **THERE ARE TWO LEGACY SAVES, FROM DIFFERENT ERAS — and the older one is not a backup.**
   `BN_bot/data/files/players_inv.json` (24 players, final, 2024) is the authoritative one and the only one
   ever imported. But `Reference/repos/MyBot_Legacy/data_username.txt` + `data_economy.txt` +
   `data_fishing_rod.txt` (**28 players**, last written 2022-09-06) are the **CsGamingBot-era** store —
   parallel line-indexed text files, one line per user, balance at the same index. **14 of its ids appear in
   no other save.** ⚠️ **They are not two versions of the same data.** Of the 14 players in both, **12 were
   reset to ~200** by the JSON — `Kibou` went **54,217 → 200**. So **Ote's own 2023 rewrite already started
   the economy over**, which is exactly what he chose again on 2026-08-13. That older economy also carries
   **negative balances** (−1,077 and −228) and **negative rod counts** (−1), artefacts of the unguarded
   arithmetic this project replaced. ⇒ Treat the text save as an archive. Do not resurrect it.

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

1. ✅ **DONE — coinflip + dice.** Kept here because the *rules* are still the reference:
   **Coinflip** ([`CsGamingBot.py:1237-1292`](../Reference/repos/MyBot_Legacy/Gaming%20Bot/CsGamingBot.py)):
   min **6** coins to play · bet **≥3** · bet **≤ HALF** your money (the default bet IS half, so for a rich
   player the default and the ceiling are the same number) · `h`/`head`/`หัว` and `t`/`tail`/`ก้อย`/`หาง` ·
   win pays **+bet**, lose **−bet**, no rake.
   **Dice** (`:1295-1384`): min **2** coins · bet **2–1000** and ≤ your money, default **10** ·
   guess even/odd/high/low pays **1:1**, guessing the exact **number pays ×3** · `randing_dice` animates 5
   frames 0.3s apart then reveals. ⚠️ Its exact-number branch pays `int(bet) * 3` as **profit on top of the
   stake**, and high/low is `>3` so 4-5-6 are high — no push on any face.
   ⚖️ **RESOLVED — the brake is IN, at his confirmation that it was anti-inflation.** Above **100,001** coins (`> 100000`) his code appends *the
   opposite of your own guess* to the chance list, cutting your win odds **1/2 → 1/3** (EV **−bet/3**). It is
   biased against *you*, recomputed per flip, not toward a side. It re-reads your balance every invocation,
   so **one or two max-bet losses switch it back off** — a soft ceiling, not a grinder, and the only house
   edge in an otherwise perfectly fair game. 📌 **It never once executed in the legacy:** richest balance in
   the final save was **1,401**, and **54,217** in the older CsGamingBot text save — 54% of the threshold at
   best. So it ships as a working brake for an economy that has not needed it yet, and the new one *could*
   reach 100k (`AmogusTheFish` pays 100 a catch, uncapped). ⚠️ My earlier recommendation was to leave it out;
   **he overruled it and he was right** — it is his own anti-inflation design. What survives of that
   objection is the pair of conditions he attached: it is **visible** and it is **logged**, so it reads as a
   rule rather than as bad luck. Implementation is in `app/data/coinflip.js` + `app/cogs/coinflip/index.js`,
   measured over 60,000 flips in `test/unit/coinflip-rules.test.mjs`.
2. ✅ **DONE — blackjack.** ⚠️ And the note that used to sit here was WRONG twice over: it said "needs
   ephemeral hands so players cannot see each other's cards", but his blackjack is **one player against the
   dealer** — there are no other players' cards, only the dealer's hole card, so the table is public like
   everything else. **His version had 10 real defects**, all fixed and individually numbered in
   `app/data/blackjack.js`'s header. The three that mattered most: the **deck was 13 cards with no suits**
   (a pair was impossible and the shoe ran dry mid-hand), `randrange(0, len-1)` **could not draw the last
   card and raised ValueError at one card left**, and the **ace was always 1**, so his "blackjack" was a hand
   worth 11 that he paid ×1.5 for. Also: no bust check while hitting, a fallback that returned a string where
   callers indexed `[1]`, insurance that charged −1.5× and let the main bet stay live, and module-level state
   that meant one hand bot-wide with no timeout. 🔑 Verified by simulation after the fix: **4.73% naturals**
   against a theoretical 4.83%, and a **−0.92% house edge** over 20,000 hands. ⭐ **KEPT deliberately:** 20 to
   sit down / min bet 10 / max bet half, natural ×1.5 truncated, surrender half, double ±2×, and
   **`DEALER_STANDS_ON: 16`** — real blackjack stands on 17, so it is very likely a misremembering, but it is
   a house-edge change and it is his to make. One constant.
3. ✅ **DONE — wordle.** ⚠️ And the note that used to sit here was WRONG: it said `words.txt` and
   `daily_word.json` "need importing as reference data". **Both files are ZERO BYTES**, created
   2022-03-03 and never filled — there was nothing to import. His actual word source was
   `zenquotes.io/api/random` feeding `api.datamuse.com/words?ml=…`, called at **module import
   time**, so starting the bot made two external HTTP requests and `wordle_target_rand` recursed
   unboundedly whenever the filters matched nothing. A **new 2,004-word list** now ships in
   `database/seeds/wordle_words.js` → `mst_wordle_word` (migration 005). ⏭ **The daily word was
   never implemented** either — `daily_word.json` is empty and his code picks a fresh random word
   per game — so there was nothing to port there and it stays unbuilt.
4. ⏭ **SKIPPED — minesweeper.** Ote, 2026-08-13: *"then skip minesweeper to Admin commands"*.
   Still there if wanted: a self-contained generator, the oldest file in the tree (2020, written
   before any of it was a Discord bot).
5. ✅ **DONE — admin commands.** `/admin money · player · reset · fish · stats · cogs`.
   ⭐ **Three of his admin features are deliberately NOT ported**, each documented in
   `app/cogs/admin/index.js`'s header so nobody rebuilds one thinking it was missed:
   ❌ **the file explorer** — it had **no admin check at all**, `if arg in "..."` matched the empty string so a
   bare argument walked the path upward, `file_location` was a **class attribute mutated in place** (one user's
   `cd` moved everyone's directory across every server), and its "is this a real directory" guard listed the
   OLD path. "Read arbitrary host files into a chat message" is not worth rebuilding.
   ❌ **`reset all`** — `reset-players.mjs` does it with a dry run and a backup.
   ❌ **cog reload** — ESM caches by URL with no invalidation, so it would import nothing and report success.
   ⏭ **Still open:** his `restart` (counted down, swapped the avatar, left voice cleanly, posted "I'm back!" on
   the next boot) needs a **supervisor**, which is still an open decision — see `main.js`'s header.
   ⏭ **`/server` admin half** — his `server list` (every guild the bot is in) is not ported yet.

## 🧰 DevTools (workspace root, outside this repo, ungitted)

| Script | |
|---|---|
| `use-legacy-token.mjs` | copies the legacy token file → `config.json`, prints only a fingerprint |
| ⛔ `import-legacy-players.mjs` | **RETIRED 2026-08-13 — it now refuses.** Superseded by the start-over decision. Two live defects if it is ever revived: `--overwrite` **downgrades** players who are ahead of their legacy row, and its `provision` row carries `money_delta = whole balance`, which **breaks the chain** `explainBalance()` verifies. A restore must be a `correction` with the true delta. |
| ⛔ `reset-players.mjs` | **the start-over tool.** Deletes every player, state, item, purchase and ledger row; keeps fish/items/market/guild/migrations. Dry-run by default, backs up to `DevTools/backups/` first, verifies every table before *and* after so a dead cascade cannot look like success. `--wipe-message-log` also clears `log_message`. |
| `pg-purge-test-rows.mjs` | removes reserved 9xx… test ids after a killed run, dry-run by default |
| `pg-clean-temp.mjs` | drops stranded `pg_temp_*` schemas (copied from the `AI_LLMv2` workspace — **fix bugs in both copies**) |
| `check-legacy-tokens.mjs` | are the old tokens still valid (they are) |
| `bot-online-smoke.mjs` | bring the bot online for N seconds via the real `startBot()` |
| `prove-atomicity.mjs` | the 147-of-150-lost measurement |
