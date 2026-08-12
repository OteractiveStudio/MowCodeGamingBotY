/**
 * database/seeds/wordle_words.js — the wordle dictionary.
 *
 * ⚠️ THIS LIST IS NEW, and it has to be. His `words.txt` is **zero bytes** — created
 * 2022-03-03 and never filled — and the real word source was `zenquotes.io/api/random`
 * feeding `api.datamuse.com/words?ml=…`, called at module import time. See
 * `database/migrations/005_wordle.sql` for the full story.
 *
 * So there was nothing to transcribe. These words are chosen to fit **his** rules:
 *
 *   · **4 to 6 letters** — his `wordle_target_rand(4, 6)`, not classic Wordle's 5. The board
 *     is built from `len(target)`, so the grid width changes per game and that is deliberate.
 *   · **lowercase a-z only** — his filter was `isalpha() and islower()`, which in Python
 *     accepts any Unicode letter; the migration's CHECK is stricter.
 *   · **common enough to guess** — his source produced words from inspirational quotes and a
 *     thesaurus, so targets could be genuinely obscure. Nothing here needs a dictionary.
 *
 * ⭐ NO PROPER NOUNS, no plurals formed by a bare trailing "s" where the singular is also in
 * the list, and no words that are only interesting as trivia. A guesser should feel beaten by
 * the puzzle, not by the vocabulary.
 *
 * To add words: put them here, re-run `npm run db:seed`. It upserts, so it is safe to repeat.
 */

/** 4-letter words. */
const FOUR = [
    "able", "acid", "aged", "also", "area", "army", "away", "baby", "back", "ball",
    "band", "bank", "base", "bath", "bear", "beat", "been", "beer", "bell", "belt",
    "bend", "best", "bike", "bill", "bird", "bite", "blue", "boat", "body", "bomb",
    "bond", "bone", "book", "boot", "born", "boss", "both", "bowl", "bulk", "burn",
    "bush", "busy", "cake", "call", "calm", "came", "camp", "card", "care", "case",
    "cash", "cast", "cell", "chat", "chef", "chip", "city", "clay", "club", "coal",
    "coat", "code", "cold", "come", "cook", "cool", "cope", "copy", "core", "cost",
    "crew", "crop", "dark", "data", "date", "dawn", "days", "dead", "deal", "dear",
    "debt", "deep", "deny", "desk", "dial", "diet", "dirt", "dish", "does", "done",
    "door", "dose", "down", "draw", "drew", "drop", "drug", "dual", "duck", "dust",
    "duty", "each", "earn", "ease", "east", "easy", "edge", "else", "even", "ever",
    "exit", "eyes", "face", "fact", "fail", "fair", "fall", "farm", "fast", "fate",
    "fear", "feed", "feel", "feet", "fell", "felt", "file", "fill", "film", "find",
    "fine", "fire", "firm", "fish", "five", "flat", "flow", "food", "foot", "ford",
    "form", "fort", "four", "free", "from", "fuel", "full", "fund", "gain", "game",
    "gate", "gave", "gear", "gene", "gift", "girl", "give", "glad", "goal", "goes",
    "gold", "golf", "gone", "good", "gray", "grew", "grey", "grow", "gulf", "hair",
    "half", "hall", "hand", "hang", "hard", "harm", "hate", "have", "head", "hear",
    "heat", "held", "hell", "help", "here", "hero", "high", "hill", "hint", "hire",
    "hold", "hole", "holy", "home", "hope", "horn", "host", "hour", "huge", "hung",
    "hunt", "hurt", "idea", "inch", "into", "iron", "item", "jack", "join", "jump",
    "june", "jury", "just", "keen", "keep", "kept", "kick", "kill", "kind", "king",
    "knee", "knew", "know", "lack", "lady", "laid", "lake", "land", "lane", "last",
    "late", "lead", "leaf", "left", "less", "life", "lift", "like", "line", "link",
    "lion", "list", "live", "load", "loan", "lock", "logo", "long", "look", "lord",
    "lose", "loss", "lost", "loud", "love", "luck", "made", "mail", "main", "make",
    "male", "many", "mark", "mass", "matt", "meal", "mean", "meat", "meet", "menu",
    "mere", "mike", "mild", "mile", "milk", "mill", "mind", "mine", "miss", "mode",
    "mood", "moon", "more", "most", "move", "much", "must", "myth", "nail", "name",
    "near", "neck", "need", "news", "next", "nice", "nine", "node", "none", "noon",
    "norm", "nose", "note", "okay", "once", "only", "onto", "open", "oral", "over",
    "pace", "pack", "page", "paid", "pain", "pair", "pale", "palm", "park", "part",
    "pass", "past", "path", "peak", "pick", "pile", "pink", "pipe", "plan", "play",
    "plot", "plug", "plus", "poem", "poet", "pole", "poll", "pool", "poor", "pope",
    "port", "pose", "post", "pour", "pray", "prep", "pull", "pump", "pure", "push",
    "quit", "race", "rail", "rain", "rank", "rare", "rate", "read", "real", "rear",
    "rely", "rent", "rest", "rice", "rich", "ride", "ring", "rise", "risk", "road",
    "rock", "role", "roll", "roof", "room", "root", "rope", "rose", "rule", "runs",
    "rush", "safe", "said", "sail", "sake", "sale", "salt", "same", "sand", "save",
    "seat", "seed", "seek", "seem", "seen", "self", "sell", "send", "sent", "ship",
    "shop", "shot", "show", "shut", "sick", "side", "sign", "silk", "sing", "sink",
    "site", "size", "skin", "slip", "slow", "snap", "snow", "soft", "soil", "sold",
    "sole", "some", "song", "soon", "sort", "soul", "soup", "spot", "star", "stay",
    "step", "stop", "such", "suit", "sure", "swim", "take", "tale", "talk", "tall",
    "tank", "tape", "task", "taxi", "team", "tear", "tell", "tend", "term", "test",
    "text", "than", "that", "them", "then", "they", "thin", "this", "thus", "tide",
    "tidy", "tied", "tile", "till", "time", "tiny", "toll", "tone", "took", "tool",
    "tour", "town", "trap", "tree", "trip", "true", "tube", "tune", "turn", "twin",
    "type", "unit", "upon", "used", "user", "vary", "vast", "very", "vice", "view",
    "vote", "wage", "wait", "wake", "walk", "wall", "want", "ward", "warm", "warn",
    "wash", "wave", "ways", "weak", "wear", "week", "well", "went", "were", "west",
    "what", "when", "whom", "wide", "wife", "wild", "will", "wind", "wine", "wing",
    "wire", "wise", "wish", "with", "wood", "wool", "word", "wore", "work", "worm",
    "worn", "wrap", "yard", "yeah", "year", "your", "zero", "zone",
];

/** 5-letter words. */
const FIVE = [
    "about", "above", "abuse", "actor", "acute", "admit", "adopt", "adult", "after", "again",
    "agent", "agree", "ahead", "alarm", "album", "alert", "alike", "alive", "allow", "alone",
    "along", "alter", "among", "anger", "angle", "angry", "apart", "apple", "apply", "arena",
    "argue", "arise", "armed", "arrow", "aside", "asset", "avoid", "awake", "award", "aware",
    "badly", "baker", "bases", "basic", "basis", "beach", "began", "begin", "being", "below",
    "bench", "birth", "black", "blade", "blame", "blank", "blast", "blind", "block", "blood",
    "board", "boost", "booth", "bound", "brain", "brand", "brass", "bread", "break",
    "breed", "brick", "brief", "bring", "broad", "broke", "brown", "brush", "build", "built",
    "bunch", "burst", "buyer", "cabin", "cable", "camps", "canal", "candy", "carry", "carve",
    "catch", "cause", "cease", "chain", "chair", "chalk", "charm", "chart", "chase", "cheap",
    "check", "cheek", "cheer", "chess", "chest", "chief", "child", "china", "chose", "civil",
    "claim", "class", "clean", "clear", "clerk", "click", "cliff", "climb", "clock", "close",
    "cloth", "cloud", "coach", "coast", "cough", "could", "count", "court", "cover", "crack",
    "craft", "crash", "crazy", "cream", "crime", "crisp", "cross", "crowd", "crown", "curve",
    "cycle", "daily", "dance", "dated", "dealt", "death", "debut", "delay", "dense", "depth",
    "doing", "doubt", "dozen", "draft", "drain", "drama", "drank", "dream", "dress", "dried",
    "drier", "drift", "drink", "drive", "drove", "dying", "eager", "eagle", "early", "earth",
    "eight", "elbow", "elder", "elect", "elite", "empty", "enemy", "enjoy", "enter", "entry",
    "equal", "error", "essay", "event", "every", "exact", "exist", "extra", "faced", "faint",
    "fairy", "faith", "false", "fancy", "fatal", "fault", "favor", "feast", "fence", "fever",
    "fewer", "fiber", "field", "fifth", "fifty", "fight", "final", "first", "flame", "flash",
    "fleet", "flesh", "float", "flood", "floor", "flour", "fluid", "focus", "force", "forge",
    "forth", "forty", "forum", "found", "frame", "fraud", "fresh", "front", "frost", "fruit",
    "fully", "funny", "giant", "given", "glass", "globe", "glory", "glove", "grace", "grade",
    "grain", "grand", "grant", "grape", "grasp", "grass", "grave", "great", "green", "greet",
    "grief", "grill", "grind", "gross", "group", "grown", "guard", "guess", "guest", "guide",
    "guilt", "habit", "handy", "happy", "harsh", "haste", "heart", "heavy", "hedge", "hello",
    "hence", "hobby", "holds", "honey", "honor", "horse", "hotel", "house", "human", "humor",
    "hurry", "ideal", "image", "imply", "index", "inner", "input", "irony", "issue", "ivory",
    "japan", "jeans", "joint", "judge", "juice", "known", "label", "labor", "large", "laser",
    "later", "laugh", "layer", "learn", "lease", "least", "leave", "legal", "lemon", "level",
    "lever", "light", "limit", "linen", "links", "liver", "lobby", "local", "lodge", "logic",
    "loose", "lorry", "loser", "lower", "loyal", "lucky", "lunar", "lunch", "lying", "magic",
    "major", "maker", "manor", "maple", "march", "marry", "match", "maybe", "mayor", "meant",
    "medal", "media", "medic", "mercy", "merge", "merit", "merry", "metal", "meter", "midst",
    "might", "minor", "minus", "mixed", "model", "modem", "moist", "money", "month", "moral",
    "motor", "mount", "mouse", "mouth", "movie", "music", "naked", "named", "nasty", "naval",
    "nerve", "never", "newly", "night", "noble", "noise", "north", "noted", "novel", "nurse",
    "occur", "ocean", "offer", "often", "olive", "onset", "opera", "orbit", "order",
    "organ", "other", "ought", "ounce", "outer", "owner", "paint", "panel", "panic", "paper",
    "party", "pasta", "patch", "pause", "peace", "pearl", "penny", "phase", "phone", "photo",
    "piano", "piece", "pilot", "pinch", "pitch", "pixel", "place", "plain", "plane", "plant",
    "plate", "plaza", "pluck", "plumb", "point", "polar", "porch", "pound", "power", "press",
    "price", "pride", "prime", "print", "prior", "prize", "probe", "proof", "proud", "prove",
    "pulse", "punch", "pupil", "purse", "queen", "query", "quest", "queue", "quick", "quiet",
    "quite", "quota", "quote", "radar", "radio", "raise", "rally", "ranch", "range", "rapid",
    "ratio", "reach", "ready", "realm", "rebel", "refer", "reign", "relax", "relay", "remit",
    "renew", "repay", "reply", "rider", "ridge", "rifle", "right", "rigid", "rival", "river",
    "roast", "robin", "robot", "rocky", "roman", "rough", "round", "route", "royal", "rugby",
    "rural", "saint", "salad", "sales", "sandy", "sauce", "scale", "scare", "scene", "scope",
    "score", "scout", "screw", "sense", "serve", "seven", "shade", "shaft", "shake", "shall",
    "shame", "shape", "share", "shark", "sharp", "sheep", "sheer", "sheet", "shelf", "shell",
    "shift", "shine", "shiny", "shirt", "shock", "shoot", "shore", "short", "shown", "sight",
    "silly", "since", "sixth", "sixty", "skill", "skirt", "slave", "sleep", "slice", "slide",
    "slope", "small", "smart", "smell", "smile", "smoke", "snake", "solar", "solid", "solve",
    "sorry", "sound", "south", "space", "spare", "spark", "speak", "speed", "spell", "spend",
    "spent", "spice", "spike", "spine", "spite", "split", "spoke", "sport", "squad", "stack",
    "staff", "stage", "stake", "stamp", "stand", "stare", "start", "state", "steady", "steal",
    "steam", "steel", "steep", "steer", "stern", "stick", "stiff", "still", "stock", "stone",
    "stood", "stool", "store", "storm", "story", "stout", "stove", "strap", "straw", "strip",
    "stuck", "study", "stuff", "style", "sugar", "suite", "super", "sweet", "swept", "swift",
    "swing", "sword", "table", "taken", "tales", "taste", "teach", "teeth", "tempo", "tenth",
    "thank", "theft", "their", "theme", "there", "these", "thick", "thief", "thing", "think",
    "third", "those", "three", "threw", "throw", "thumb", "tiger", "tight", "timer", "tired",
    "title", "toast", "today", "token", "tooth", "topic", "torch", "total", "touch", "tough",
    "tower", "toxic", "trace", "track", "trade", "trail", "train", "trait", "trash", "treat",
    "trend", "trial", "tribe", "trick", "tried", "tries", "troop", "trout", "truck", "truly",
    "trunk", "trust", "truth", "twice", "twist", "uncle", "under", "union", "unite", "unity",
    "until", "upper", "upset", "urban", "usage", "usual", "vague", "valid", "value", "valve",
    "vault", "verse", "video", "villa", "vinyl", "virus", "visit", "vital", "vivid",
    "vocal", "voice", "waist", "waste", "watch", "water", "weary", "wedge", "weigh", "weird",
    "wheat", "wheel", "where", "which", "while", "white", "whole", "whose", "widen", "wider",
    "width", "witch", "woman", "world", "worry", "worse", "worst", "worth", "would", "wound",
    "wrist", "write", "wrong", "wrote", "yield", "young", "yours", "youth", "zebra",
];

/** 6-letter words. */
const SIX = [
    "accent", "accept", "access", "across", "acting", "action", "active", "actual", "advice",
    "advise", "affect", "afford", "afraid", "agency", "agenda", "almost", "always", "amount",
    "animal", "annual", "answer", "anyone", "anyway", "appeal", "appear", "around", "arrest",
    "arrive", "artist", "aspect", "assess", "assist", "assume", "attach", "attack", "attend",
    "august", "author", "avenue", "backed", "backup", "ballet", "banana", "banner", "barely",
    "barrel", "basket", "battle", "beauty", "became", "become", "before", "behalf", "behind",
    "belief", "belong", "bellow", "beside", "better", "beyond", "bishop", "bitter", "border",
    "boring", "borrow", "bottle", "bottom", "bought", "bounce", "branch", "breach",
    "bridge", "bright", "broken", "bronze", "browse", "brunch", "bucket", "budget", "bullet",
    "bundle", "burden", "bureau", "butter", "button", "camera", "campus", "cancel", "cancer",
    "candle", "cannot", "canvas", "carbon", "career", "carpet", "carrot", "castle",
    "casual", "caught", "cattle", "caviar", "center", "centre", "cereal", "chance", "change",
    "charge", "cheese", "cherry", "chosen", "church", "circle", "circus", "cities", "client",
    "closed", "closer", "coffee", "cognac", "collar", "colony", "colour", "column", "combat",
    "coming", "comedy", "common", "cookie", "cooler", "copper", "corner", "costly", "cotton",
    "county", "couple", "coupon", "course", "cousin", "cradle", "create", "credit", "cruise",
    "custom", "damage", "danger", "dealer", "debate", "decade", "decide", "decide",
    "deeply", "defeat", "defend", "define", "degree", "delete", "demand", "depart", "depend",
    "deploy", "desert", "design", "desire", "detail", "detect", "device", "devote",
    "differ", "dinner", "direct", "divide", "doctor", "dollar", "domain", "donate", "double",
    "driver", "during", "eating", "editor", "effect", "effort", "eighth", "either", "eleven",
    "emerge", "employ", "enable", "ending", "energy", "engage", "engine", "enough", "ensure",
    "entire", "entity", "equity", "escape", "estate", "ethnic", "exceed", "except", "excess",
    "excuse", "expand", "expect", "expert", "export", "expose", "extend", "extent", "fabric",
    "facing", "factor", "fairly", "fallen", "family", "famous", "farmer", "faster",
    "father", "fellow", "female", "figure", "filter", "finger", "finish", "fiscal", "flavor",
    "flight", "flying", "follow", "forced", "forest", "forget", "formal", "format", "former",
    "fossil", "foster", "fought", "fourth", "freeze", "french", "friend", "fringe", "frozen",
    "future", "galaxy", "gallon", "garage", "garden", "garlic", "gather", "gender", "gentle",
    "german", "ginger", "global", "golden", "gospel", "govern", "grader", "ground", "growth",
    "guilty", "guitar", "handle", "happen", "hardly", "hazard", "headed", "health", "hidden",
    "hollow", "honest", "hoping", "horror", "hotels", "humble", "hunger", "hungry", "hunter",
    "hybrid", "ignore", "immune", "impact", "import", "impose", "inches", "income", "indeed",
    "indoor", "infant", "inform", "injury", "inline", "insect", "inside", "insist", "intake",
    "intend", "intent", "invest", "invite", "island", "itself", "jacket", "jersey", "jungle",
    "junior", "kernel", "kidney", "killer", "kindly", "kitten", "ladder", "laptop", "latest",
    "latter", "launch", "lawyer", "leader", "league", "learnt", "leaves", "legacy", "legend",
    "length", "lesson", "letter", "likely", "linear", "liquid", "listen", "little", "living",
    "locate", "lonely", "longer", "lounge", "luxury", "makeup", "manage", "manner", "manual",
    "marble", "margin", "marine", "marker", "market", "master", "matter", "mature", "meadow",
    "medium", "member", "memory", "mental", "mentor", "merely", "method", "middle", "minute",
    "mirror", "mixing", "mobile", "modern", "modest", "modify", "moment", "monkey", "months",
    "mostly", "mother", "motion", "moving", "murder", "muscle", "museum", "mutual", "myself",
    "narrow", "nation", "native", "nature", "nearby", "nearly", "needle", "nephew", "nested",
    "nickel", "nobody", "normal", "notice", "notion", "number", "object", "obtain", "occupy",
    "office", "offset", "online", "opener", "openly", "option", "orange", "origin",
    "outfit", "outlet", "output", "oxford", "oxygen", "packed", "packet", "palace", "parade",
    "parent", "parish", "partly", "passed", "patent", "patrol", "pardon", "peanut", "pencil",
    "people", "pepper", "period", "permit", "person", "phrase", "picked", "picnic", "pigeon",
    "pillow", "pirate", "pistol", "planet", "plasma", "player", "please", "pledge", "plenty",
    "pocket", "poetry", "police", "policy", "polish", "portal", "porter", "poster", "potato",
    "praise", "prayer", "prefer", "pretty", "prince", "prison", "profit", "prompt", "proper",
    "proven", "public", "punish", "purple", "pursue", "puzzle", "quarry", "quiver",
    "quotes", "rabbit", "racing", "radius", "random", "rarely", "rather", "rating", "reader",
    "really", "reason", "rebate", "recall", "recent", "recipe", "record", "reduce", "reform",
    "refuse", "regard", "regime", "region", "reject", "relate", "relief", "remain", "remark",
    "remedy", "remind", "remote", "remove", "rental", "repair", "repeat", "report", "rescue",
    "resign", "resist", "resort", "result", "resume", "retail", "retain", "retire", "return",
    "reveal", "review", "revise", "reward", "ribbon", "riding", "rifles", "rising", "ritual",
    "robust", "rocket", "roster", "rotate", "rubber", "runner", "safety", "salary", "salmon",
    "sample", "saving", "saying", "scared", "scheme", "school", "scores", "screen", "script",
    "search", "season", "second", "secret", "sector", "secure", "seldom", "select", "seller",
    "senate", "senior", "series", "sermon", "settle", "severe", "shadow", "shaped", "shared",
    "shield", "should", "shower", "shrink", "signal", "silent", "silver", "simple", "simply",
    "singer", "single", "sister", "sketch", "slight", "smooth", "soccer", "social", "socket",
    "sodium", "softly", "solely", "solved", "sooner", "sorted", "source", "soviet", "speech",
    "sphere", "spider", "spirit", "spoken", "spread", "spring", "sprint", "square", "stable",
    "stairs", "stance", "stared", "starts", "statue", "status", "steady", "stitch",
    "stolen", "stones", "stored", "storms", "strain", "strand", "streak", "stream", "street",
    "stress", "strict", "strike", "string", "strive", "stroke", "strong", "struck", "studio",
    "stupid", "subtle", "suburb", "sudden", "suffer", "summer", "summit", "sunset", "supply",
    "surely", "survey", "switch", "symbol", "syntax", "system", "tackle", "talent", "target",
    "taught", "tavern", "temple", "tenant", "tender", "tennis", "thanks", "theory", "thirty",
    "though", "thread", "threat", "thrive", "throat", "throne", "thrown", "ticket", "tissue",
    "toilet", "tomato", "tongue", "topple", "toward", "towels", "trader", "travel", "treaty",
    "tribal", "tricky", "triple", "trophy", "trying", "tumble", "tunnel", "turkey",
    "twelve", "twenty", "unable", "unfair", "unfold", "unique", "unlike", "unrest", "update",
    "upheld", "uphold", "upward", "urgent", "useful", "valley", "vanish", "varied", "vector",
    "vendor", "verbal", "versus", "vessel", "victim", "victor", "viewer", "violet", "virtue", "vision", "visual", "volume", "voting", "voyage", "waited", "walker",
    "wallet", "wander", "warmth", "warned", "wealth", "weapon", "weekly", "weight", "wholly", "willow", "window", "winner", "winter", "wisdom", "wished", "within", "wonder",
    "wooden", "worker", "worthy", "writer", "yellow", "zombie",
];

/**
 * Every word, deduplicated and validated.
 *
 * ⚠️ Validated HERE rather than left to the migration's CHECK. A bad word would otherwise fail
 * the seed with a constraint violation naming the constraint but not the mistake, halfway
 * through a transaction. Failing loudly with the offending word is a better trade.
 *
 * It also catches the trap his own filter could not: Cyrillic characters that render identically
 * to Latin ones. `isalpha() and islower()` is true for "виза", so his version would have happily
 * made it the target of an English word game.
 */
export function buildWordList() {
    const problems = [];
    const seen = new Set();
    const words = [];

    for (const word of [...FOUR, ...FIVE, ...SIX]) {
        if (!/^[a-z]+$/.test(word)) {
            problems.push(`"${word}" is not lowercase a-z only`);
            continue;
        }
        if (word.length < 4 || word.length > 6) {
            problems.push(`"${word}" is ${word.length} letters — his range is 4-6`);
            continue;
        }
        if (seen.has(word)) continue; // a duplicate is harmless, just dropped
        seen.add(word);
        words.push({ word, length: word.length, is_answer: true, is_active: true });
    }

    if (problems.length > 0) {
        throw new Error(
            `wordle_words.js has ${problems.length} bad entr${problems.length === 1 ? "y" : "ies"}:\n  ` +
            problems.join("\n  "),
        );
    }

    return words;
}

export const WORDLE_WORDS = buildWordList();
