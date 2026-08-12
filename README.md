# MowCodeGamingBoteY

**A Discord bot I wrote as a student, rebuilt properly.**

The original was Python + `discord.py`, written between 2021 and 2024 for a group of university servers — a
game bot with a coin economy, fishing, a market, and a pile of small games. It worked, people played it, and
it stored everything in JSON and line-indexed text files. This is that bot rewritten in **JavaScript on
discord.js**, with **PostgreSQL** where the text files used to be.

It is a **remake, not a port**. The old code is kept as a frozen reference and read for *intent* — what the
bot was supposed to do, and which instincts in it were worth keeping — not translated line by line.

```
Python / discord.py ≤1.7          →   JavaScript ESM / discord.js 14
prefix + on_message commands      →   slash commands
JSON + parallel .txt files        →   PostgreSQL via Sequelize
whole-file read-modify-write      →   one atomic statement per mutation
```

---

## What the bot does

### Working today

| Command | What it does |
|---|---|
| `/fishing cast` · `auto` · `rates` | Cast, or burn every rod you have (up to 30) **in one transaction** |
| `/market` | The market — full contents, direct buttons per section and item, Close |
| `/inventory` | What you are carrying, and your slots |
| `/money balance` · `give` · `history` | Coins, transfers, and **where every coin came from** |
| `/guess start` · `try` · `rules` | Guess the number — **type a bare number in chat**, 7 shared attempts |
| `/ox play` · `rules` | Noughts and crosses on a **3×3 button grid**, vs the bot or a duel |
| `/steal` · `/crime` | Rob someone, if you own the tools. `/crime` explains the odds |
| `/ping` · `/about` | Liveness, and the credits |

**The core loop works**: buy rods → fish → earn coins and exp → level up → buy more. On the original's rules,
below. Everything after that is still its feature set — **the thing being ported** — and not rebuilt yet.

### Built: economy and progression

**Coins.** A currency you earn, spend and give away. Balances are allowed to go **negative** — below −20 a
player is flagged "bad econ", which the original used to gate things, so a non-negative constraint would have
deleted a feature. Every coin earned also earns the same amount of **exp**, because the original's `money_add`
called `exp_add(money)`.

**Progression.** Exp fills toward a cap of `level × 10 + crystals × 2`; hitting it levels you up and carries
the remainder over, cascading through several levels if you earn a lot at once. At **level 100** the level
resets and you gain a **magical crystal**, which raises your exp cap permanently.

One quirk is **reproduced rather than fixed**: at level 0 with no crystals the cap is 0, so even a zero gain
levels you to 1. The original did that. Changing it would change the game, so it is asserted in a test
instead of quietly corrected.

**Every coin movement is logged** in the same transaction that moves it, which is why `/money history` exists
and why it can tell you if its own ledger fails to reconcile against your balance.

Two deliberate divergences from the original, each one line to reverse: a **transfer requires the sender to
afford it** (a negative balance should come from a penalty, not from generosity), and a **transfer grants no
exp** (otherwise two players passing the same coins back and forth is an infinite exp machine).

### Built: fishing

Cast a rod and pull a **tier-weighted** random catch. A fish's chance is `(10 − tier) / total`, so a *lower*
tier is *more* common — which is why the two likeliest results are `Nothing` (15.15%) and `Trash` (13.64%),
and why `AmogusTheFish` shows up 1.52% of the time and pays 100 coins for it. Nine fish, 66 total weight,
straight from the original's data. A real catch is auto-sold, which credits coins *and* the same exp.

`/fishing auto` burns every rod you own, capped at 30. In the original that was **120+ sequential whole-file
rewrites**; here the whole batch is one lock, one write, and one ledger row per catch.

The animation is **not** ported — the original edited one embed per second for up to 20 casts, which is 20
message edits per command for decoration. `deferReply` gives the same beat for one edit.

### Built: market and inventory

Buy from three categories with autocomplete. Every limit is the original's: **5** bags, **15** rods or **10**
of anything else per purchase; you can carry **15** rods or **10** of an item type; a *new* item type needs a
free slot, though topping up something you already hold does not. A 🎒 **Bag** raises your slot count, capped
at `1.2 × (crystals × 100 + level)` — which at level 1 is exactly 1, the slot every player starts with.

`fishingrod` increments your rod counter rather than becoming a carried item, and `bag` raises your slots;
neither is stored as inventory. Buying grants **no exp**, which is faithful — the original's market wrote
`money -= price` directly, bypassing the function that granted exp.

The whole purchase is one transaction: funds check, payment, ledger row, receipt and item effect land together
or not at all. The original checked funds, mutated a dict, then rewrote the file — so two purchases racing
could both pass the check and both succeed.

⚠️ **One place the original contradicts itself, kept rather than quietly reconciled:** its market caps you at
**15** rods, but its `fishing auto` is written to burn up to **30**. Both numbers are his, in different files,
and they cannot both be reachable through the market alone. Which one is wrong is a balance decision.

**Buttons replace the original's emoji-reaction buy flow**, which tracked mid-purchase players in a
module-level dict — so the bot could only really host one market session at a time, and a crash mid-flow left
you stuck in it. The menu is public and anyone may click it; a click that is not the shopper's gets a private
"this isn't yours", which is what the original's reaction handler did minus the reaction it had to remove
afterwards. The whole navigation state lives in the button ids, so **there is no session state to strand**.

### Built: three games

**Guess the number.** Bet 10–1000, **seven attempts shared by the whole channel**, five minutes. Solve it on
the first try for **×5** the bet, within three for **×2**, within five for **×1.5**, on the sixth for **×0.5**,
on the seventh for nothing but thanks. Everyone else who guessed pays `round(their guesses × bet ÷ 7)`, so
seven guesses costs a whole bet. Set the target yourself instead of the bot and you win the bet if nobody
cracks it — which is where the original had a bug: its message said the target-setter won while the code paid
the *last guesser*.

You **type a bare number in chat** to guess, exactly as the original did. That needs Discord's privileged
Message Content intent, and the handler is written against the original's worst habit: its `on_message` fired
a **network translation request on every message in every server** just to check for the word "fish". Here a
channel with no game costs one in-memory lookup.

**OX (noughts and crosses).** A real **3×3 grid of buttons**, labelled 1–9. The original printed a text grid
and you typed `11`–`33` for row and column — necessary then, pointless when you can click the square. Duel
someone for up to 1000, or play the bot for up to 40, where **winning pays half the bet and losing costs all
of it**. The bot plays at random *on purpose*: at those odds a competent bot would make betting a pure loss.

**Stealing.** The knife, gun, passkey, cat and dog were props in the original — the shop sold them, the
descriptions promised things, and no code ever read them. Now they work, and the mechanic is taken **from the
item descriptions themselves**:

| Item | The description says | So it is |
|---|---|---|
| 🔑 passkey | "steal someone's money" | a steal, 35% |
| 🔪 knife | "rob someone" | a rob, 50% |
| 🔫 gun | "rob someone" | a rob, 70% |
| 🐱 cat | "prevent you from being **stolen**" | defends steal only, −30% |
| 🐶 dog | "protect you from being **robbed or stolen**" | defends both, −50% |

A cat is no use against a knife, because that is what the original says. Succeed and take up to a third of
their coins; fail and post a third of yours as bail. The tool is consumed either way, and there is a
ten-minute cooldown — the original had none, which made it grief-spam.

### Still to port

**Blackjack** dealt with emoji cards, including ace prompting · **coinflip** · **dice** · **Wordle** with a
daily word · a **minesweeper** generator (the oldest file in the original, from 2020, written before any of it
was a Discord bot).

**Admin tools from inside Discord.** Reload/unload/list cogs without restarting · a restart command that
counted down, swapped the avatar, left voice cleanly and posted "I'm back!" on its next boot · a data editor ·
a sandboxed file browser · rotating status · an avatar self-check that repaired itself with retries.

**Multilingual.** The original passed every user-facing string through translation and supported 64 languages,
with a Thai original kept alongside the English one and a credited translator.

### Deliberately not in this project

**Music and soundboard.** The original grew a second bot for it — a curated Shibayan Records / TOHO catalogue
plus YouTube playback. That is its own project, not this one: voice doubles the dependency surface, and
YouTube playback carries its own questions. **TTS** is in the same bucket.

Which of the games and admin tools come back at all is still an open decision, not a promise.

## Why rewrite it at all

Not for the language. **For the writes.**

The old data layer looked like this — and every mutator in it worked the same way:

```python
def money_add(self, player_id, money):
    player_data = self.read_json(self.datafile["players"])      # read the WHOLE file
    player_data[str(player_id)]["inventory"]["money"] += money  # change one number
    self.write_json(self.datafile["players"], player_data)      # write the WHOLE file back
    return self.exp_add(player_id, money)                       # ...which does it all again
```

No lock, no transaction. One `+fishing auto` command burned up to 30 fishing rods in a loop, so a single
player fishing performed **120+ sequential whole-file rewrites** of `players_inv.json` while everyone else's
commands interleaved. Any two overlapping commands, and one of them silently lost. Balances were, strictly
speaking, guesses.

**Measured, on this schema** — 50 concurrent credits of 3 coins to the same player:

| | start | end | lost |
|---|---|---|---|
| the original's shape: read → modify → write | 200 | **203** | **147 of 150** |
| this data layer: `SELECT … FOR UPDATE` in one transaction | 200 | **350** | 0 |

Only **1 of 50** credits survived the old pattern. That number is not a hypothetical — it was run against
this database before the test that asserts it was written, because an assertion that cannot fail proves
nothing.

The older version was worse: **parallel line-indexed text files**, where line *N* of `data_username.txt`,
`data_economy.txt` and `data_fishing_rod.txt` were the same player, joined by line number.

```
data_username.txt      data_economy.txt     data_fishing_rod.txt
403536649222356992     5915                 -1
433223804710289409     41                   -1
564161814070558731     9908                 0
```

One insert in the wrong file and every player's money belonged to someone else — silently, with no error,
unrecoverably.

That is what a database fixes, and it is the actual point of this project.

## Status — honest version

**It is live and being played.** The bot runs in a real server on a real database.

✅ Economy, progression, fishing, market and inventory — all on the original's numbers · ✅ **three games**:
guess, OX and stealing · ✅ a ledger that reconciles · ✅ **199 tests** against the real database, one command,
real exit code.

**The economy starts from zero.** All 24 original players were imported, then deliberately removed: looking at
the real numbers side by side, the balances were not worth carrying forward — and the original's *own* 2024
rewrite had already reset 12 of those players to the starting 200 anyway. Everyone is provisioned fresh on
their first command. The game content — fish, items, market listings — is seeded from the repo and unaffected.

❌ **Still to port:** blackjack, coinflip, dice, wordle, minesweeper · admin commands (`data` editor, `file`
explorer, `restart`) · i18n · selling items back · prefix commands.

The full ❌ list, and every decision behind the design, lives in [`AI_CarryOn.md`](AI_CarryOn.md).

## Running it

```bash
npm install
cp config.example.json config.json     # then fill it in — see below
npm run db:migrate                     # create the schema (idempotent, safe to re-run)
npm run db:seed                        # load the fish, items and market (also idempotent)
npm test                               # 199 checks, real exit code
npm run bot:register                   # publish slash commands to Discord
node main.js                           # NOT npm start — see below
```

**`config.json` is gitignored** and holds the two secrets — the Discord bot token and the database password.
`config.example.json` is committed and documents the shape with those left empty. There is no `.env` here;
JSON config is the convention across my projects.

To get a token: create an application at <https://discord.com/developers/applications>, add a Bot, and put
its token in `discord.token` plus the application id in `discord.application_id`. Set `discord.dev_guild_id`
to a test server and command registration is **instant** instead of taking up to an hour to propagate
globally. Without a token, `npm start` fails fast and tells you exactly that.

**Database:** PostgreSQL, its own database and schema, with a role that is deliberately **not** a superuser.
The SQL migration is applied *as the app role*, so the app owns every object it uses.

## How it is put together

```
main.js                     composition root: config → logging → database → bot

app/
  bot/
    client.js               the discord.js client, and the intent decision
    loader.js               the cog loader
    dispatch.js             routes a slash command to its cog; logs whatever throws
    registry.js             publishes the command list to Discord
    index.js                assembles the above and logs in
  bot/respond.js            answers an interaction whether or not it was deferred
  bot/permissions.js        who counts as a bot admin (config, never a row)
  cogs/                     one directory per feature — see below
    economy/                /money balance | give | history
    fishing/                /fishing cast | auto | rates
    market/                 /market, /inventory
    guess/                  /guess start | try | rules   (+ typed guesses)
    ox/                     /ox play | rules
    steal/                  /steal, /crime
    guild/                  /server, and join/leave provisioning
    system/                 /ping, /about
  data/                     the only code that reads or writes rows
    economy.js              the cascade, the locking, and the ledger
    fishing.js  inventory.js  guess.js  ox.js  steal.js
    session-store.js        one game per channel, with a per-channel lock
    player.js  guild.js

database/
  migrations/               THE SOURCE OF TRUTH for the schema
    001_core.sql            log_message, mst_guild, mst_player
    002_game_core.sql       player state, items, market, fish, purchases, economy log
    003_timestamps_*.sql    created_at / updated_at on every table
    004_steal.sql           the steal cooldown
  scripts/migrate.js        applies them as the app role, once each, with a checksum ledger
  scripts/seed.js           loads the reference data
  seeds/reference_data.js   the fish, items and market, transcribed from the original
  models/                   Sequelize models that MIRROR the SQL
  connection-config.js      the one helper that resolves connection settings — and throws
  index.js                  initDB

lib/utility.js              config loading + logging
test/                       unit + checks against the real database
```

**This process is a Discord bot and nothing else** — no HTTP server. A dashboard or API, if it happens, will
be its own project reading the same schema.

### Cogs — kept from the original on purpose

The best structural idea in the old bot was a **cog per feature**: `fishing_cog`, `inventory_cog`,
`market_cog`, each owning its own commands *and* its own event listeners, loaded by name.

discord.js has no equivalent, and the common community pattern splits `commands/` from `events/` by *kind* —
which scatters one feature across two trees. So the loader here keeps the feature whole. Drop a directory
into `app/cogs/` and it loads:

```js
// app/cogs/economy/index.js
export default {
  name: "economy",                          // must match the directory name
  description: "money, balance, give",
  commands: [{ data: new SlashCommandBuilder()…, execute(interaction, ctx) {} }],
  events:   [{ name: Events.GuildCreate, handle(guild, ctx) {} }],
  async setup(ctx) {},                      // optional, runs once at load
}
```

One deliberate change: `ctx` — `{ client, db, config, log }` — is **injected**. The original did
`b = basic("fishing_cog")` at import time in every cog, so every module built its own data layer and touched
the filesystem just by being imported. Injection is why a cog here can be tested with no Discord connection
and no database.

The loader **refuses to boot** on a duplicate command name, or a cog whose `name` disagrees with its
directory. The original shipped `ox`, `Ox`, `oX`, `xo`, `XO` as five separate command functions, and defined
`get_server_prefix` twice with different behaviour — where the second silently won.

⚠️ **No runtime `cog reload`.** The original had one and it was genuinely useful, but ESM caches modules by
URL with no un-import, so a correct version needs cache-busting URLs and careful listener teardown.
`npm run dev` restarts on save instead. Left out rather than half-built.

### Logging — also kept, with the bug removed

One log file per run, using the original's exact `YYYYMMDD_HHMMSS` naming from its `debug_msg/` folder, and
every line carrying its level and the module that wrote it:

```
[2026-08-12T15:12:18.328Z] [WARNING] [main.js]: Discord bot is DISABLED — this process now does nothing
```

Console, file, and a `log_message` table, each switchable independently. Lines emitted before the database
is up are **buffered and flushed**, not dropped.

And this time the switch works. The original had:

```python
if not self.is_debug: return     # is_debug is a METHOD, never called — always truthy
```

so debug logging could never be turned off and the `debug` key in settings did nothing. Here
`logging.message.min_level` is read on every call, and a test asserts the **off** state — because a flag
nobody observes is not a feature.

### The database rules the code follows

- **The SQL migration is the source of truth.** Sequelize models mirror it, and `sync` runs with
  `{ alter: false }` so it can never quietly reshape a table — it cannot express a CHECK constraint, a
  partial index, or NOT NULL where those actually matter.
- **One name end to end.** The model file, the `define()` name, the `tableName` and the `db.` accessor are
  the same literal string — `db.mst_player`. A test fails if they drift.
- **Table prefixes carry the data class:** `mst_` what exists · `txn_` what happened · `log_` append-only.
- **No schema name is hardcoded anywhere.** The SQL uses a `{{schema}}` placeholder that the migration
  runner substitutes from config, after validating it is a plain identifier.
- **Migrations are checksummed.** Editing one after it has been applied is caught and reported, because the
  live schema would no longer match its own source of truth.

## Testing

```bash
npm test              # unit + checks against the real database
npm run test:unit     # unit only — no database, no network
```

One command, a real exit code, and it **fails fast on preconditions**: if `config.json` is missing or
Postgres will not answer, the suite reports *its own* failure and stops rather than blaming the product.
Checks clean up their fixtures **before and after** — cleaning only at the end is how a killed run poisons
the next one and gets the product blamed for it.

Some of what is asserted, as a flavour of the intent: **50 concurrent credits to one player lose nothing, and
the ledger still reconciles afterwards** · 20 concurrent fishing casts lose no rods and no coins · two racing
purchases cannot both spend the same coins · model columns and table columns match in *both* directions · the
CHECK constraints really do refuse bad data · 60,000 seeded fish draws land within 1.5 points of every stated
rate · the OX bot only ever picks an empty square, across the whole random range · a permission check with no
admin list configured means **nobody** is an admin, never everybody · the logger's off state is off.

Several tests exist because a specific line in the original was wrong, and each says so — the guess payout
that named one winner and paid another, the steal that crashed on a broke victim, the bail that paid you when
you were in debt. Those are the tests worth reading first.

The progression rules have their own unit tests with no database at all, including a sweep over levels 0–99,
0–9 crystals and gains up to 100,000 asserting the cascade always settles below its own cap. Those tests
encode **game balance**, so changing one is a design decision, not a refactor.

## Credits

The original was a team project — KU81 CS36:

**main idea** Art · **main programmer** Ote · **help co-writer** Mickey · **co-programmers** Tonnow, Jojo ·
**translator** Jo

The rewrite is mine. The bot they helped build is why there is anything to rewrite.
