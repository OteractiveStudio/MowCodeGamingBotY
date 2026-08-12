-- 005_wordle.sql — the word list wordle draws from.
--
-- ⭐ WHY THIS TABLE EXISTS AT ALL, which is the whole story of porting his wordle:
--
-- The legacy had `BN_bot/data/wordle/words.txt` and `daily_word.json`. **Both files are ZERO
-- BYTES**, created 2022-03-03 and never filled. They were an intention, not data. The actual
-- word source in `CsGamingBot.py:477-499` was TWO third-party HTTP APIs:
--
--     response_a = requests.get("https://zenquotes.io/api/random")     -- a random quote
--     ...
--     response_b = requests.get(f"https://api.datamuse.com/words?ml={a}")  -- "means like"
--
-- It pulled a random inspirational quote, split it into words, seeded a thesaurus lookup with
-- one of them, and picked a 4-6 letter lowercase word out of the result. Worse, `wordle_reset()`
-- was called at MODULE IMPORT (`:510`), so **starting the bot made two external HTTP calls**, and
-- `wordle_target_rand` recursed unboundedly — two more requests per level — whenever the filters
-- matched nothing.
--
-- A game word is not worth an external dependency, let alone one that can stop the bot booting.
-- So the list lives here, seeded from `database/seeds/wordle_words.js`, and the repo stands alone
-- exactly as it does for fish and items.
--
-- ⚠️ HIS WORD LENGTH IS 4-6, NOT 5. `wordle_reset()` called `wordle_target_rand(4, 6)`, and the
-- board is built from `len(target)`, so the grid width varies per game. That is his design and it
-- is kept — the CHECK below encodes it.

-- ── The dictionary ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS {{schema}}.mst_wordle_word (
    word                TEXT PRIMARY KEY,
    length              INTEGER NOT NULL,
    is_answer           BOOLEAN NOT NULL DEFAULT true,
    is_active           BOOLEAN NOT NULL DEFAULT true,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Lowercase ASCII letters only. His filter was `i.isalpha() and i.islower()`, which in
    -- Python accepts any Unicode letter — so a word with an accent or Thai script could become
    -- the target of an English word game. This is stricter on purpose.
    CONSTRAINT mst_wordle_word_shape
        CHECK (word ~ '^[a-z]+$'),

    -- ⚠️ HIS RANGE. wordle_target_rand(4, 6).
    CONSTRAINT mst_wordle_word_length_range
        CHECK (length BETWEEN 4 AND 6),

    -- The stored length must actually be the length, so a query can filter on it and trust it.
    CONSTRAINT mst_wordle_word_length_matches
        CHECK (length = char_length(word))
);

COMMENT ON TABLE  {{schema}}.mst_wordle_word IS 'Words wordle can choose as a target. Replaces the legacy zenquotes.io + datamuse.com calls.';
COMMENT ON COLUMN {{schema}}.mst_wordle_word.is_answer IS 'false = accepted as a guess but never chosen as the target. Nothing sets this yet; his version accepted ANY letters as a guess.';
COMMENT ON COLUMN {{schema}}.mst_wordle_word.is_active IS 'Retiring a word keeps finished games readable.';

-- Drawing a target is "a random active answer of a chosen length", so index exactly that.
CREATE INDEX IF NOT EXISTS mst_wordle_word_answer_idx
    ON {{schema}}.mst_wordle_word (length, is_answer, is_active);
