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
| `/ping` | Liveness — round-trip time, gateway latency, uptime |
| `/about` | What the bot is, and the credits |
| `/server` | This server's bot settings (language, music channel, manager role, known-since) |
| `/whoami` | What the bot has recorded about you, and how many players it knows |

That is genuinely all of it right now. Everything below is the original's feature set — **the thing being
ported** — and none of it is rebuilt yet.

### The game being ported

**Economy.** A custom-emoji currency (BezCoin). Check your balance, give coins to another player, admin
set/adjust. Balances are allowed to go **negative** — below −20 a player is flagged as "bad econ", which the
original used to gate things. Every coin earned also earns the same amount of **exp**.

**Progression.** Exp fills toward a cap of `level × 10 + crystals × 2`; hitting it levels you up and carries
the remainder over, cascading if you earn a lot at once. At **level 100** the level resets and you gain a
**magical crystal**, which raises your exp cap permanently and grew your inventory in the original.

**Fishing.** Buy rods from the market, cast, and pull a **tier-weighted** random catch — lower tiers are more
common, and the two most likely results are `Nothing` and `Trash`. A real catch is auto-sold for coins (and
therefore exp), and the rod is consumed. `fishing auto` spends every rod you own, capped at 30, in one
animated message. Nine fish in the original, priced 8–25, each defined by an actual image file — the bot
reconciled its fish list against the pictures on disk, in both directions.

**Inventory and market.** Items are held per player against an inventory-size limit. The market is organised
into categories — Quick menu ⚡, Pet 1️⃣, Tool 2️⃣ — holding things like a fishing rod (5), a knife, a cat
(500) and a dog (800), each with an emoji and a description. The original drove the whole buy flow with
**emoji reactions** rather than typed arguments.

**Games.** Guess-the-number with betting · OX / tic-tac-toe against a player or the bot · Blackjack dealt
with emoji cards, including ace prompting · coinflip · dice · Wordle with a daily word · a minesweeper
generator (the oldest file in the original, from 2020, written before any of it was a Discord bot).

**Per-server settings.** Prefix, language, a bound music channel, and a bot-manager role — the original had
multi-server settings and join-time provisioning from its very first version.

**Multilingual.** The original passed every user-facing string through translation and supported 64
languages, with a Thai original kept alongside the English one and a credited translator.

**Live ops from inside Discord.** Reload, unload and list cogs without restarting · a restart command that
counted down, swapped the avatar, left voice cleanly and posted "I'm back!" on its next boot · a data editor ·
a sandboxed file browser · rotating status · an avatar self-check that repaired itself with retries.

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

**The scaffold is real and tested. The game is not built yet.**

✅ Boots · ✅ connects to Discord and comes online · ✅ schema applied and verified · ✅ **45 tests passing**
against the real database, one command, real exit code.

❌ **No game yet.** No economy, fishing, inventory, market or games — `mst_player` is identity only, so
`/whoami` has no wallet to show. The commands that exist are `/ping`, `/about`, `/server`, `/whoami`.

The full ❌ list, and every decision behind the design, lives in [`AI_CarryOn.md`](AI_CarryOn.md).

## Running it

```bash
npm install
cp config.example.json config.json     # then fill it in — see below
npm run db:migrate                     # create the schema (idempotent, safe to re-run)
npm test                               # 45 checks, real exit code
npm run bot:register                   # publish slash commands to Discord
npm start                              # or: npm run dev  (node --watch)
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
  cogs/                     one directory per feature — see below
    system/                 /ping, /about
    guild/                  /server, and join/leave provisioning
    player/                 /whoami
  data/                     the only code that reads or writes rows
    player.js  guild.js

database/
  migrations/001_core.sql   the source of truth for the schema
  scripts/migrate.js        applies it as the app role, once each, with a checksum ledger
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

Some of what is asserted, as a flavour of the intent: 25 concurrent provisioning calls for the same player
produce exactly one row and exactly one winner · model columns and table columns match in *both* directions
· the CHECK constraints really do refuse bad data · the logger's off state is off · a guild that removes the
bot is marked, never deleted, so its settings survive a re-invite.

## Credits

The original was a team project — KU81 CS36:

**main idea** Art · **main programmer** Ote · **help co-writer** Mickey · **co-programmers** Tonnow, Jojo ·
**translator** Jo

The rewrite is mine. The bot they helped build is why there is anything to rewrite.
