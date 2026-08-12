/**
 * app/data/steal.js — robbing and stealing, and the items that finally matter.
 *
 * ⚠️ THE LEGACY `steal` NEVER LOOKED AT THE INVENTORY. Its five thematic items — `knife`, `gun`,
 * `passkey` and the two pets that exist to defend against them — were props: the shop sold them,
 * the descriptions promised things, and no code ever read them. Fixing that is the whole point of
 * this module, and the mechanic below is taken from **his own item text**, which turns out to
 * specify it precisely:
 *
 *   passkey  "You can use this item to steal someone's money."      → a STEAL
 *   knife    "You can use this item to rob someone."                → a ROB
 *   gun      "You can use this item to rob someone."                → a ROB
 *   cat      "Cat can make noise and prevent you from being STOLEN." → defends STEAL only
 *   dog      "Dog can protect you from being ROBBED or STOLEN."     → defends BOTH
 *
 * The cat/dog split is his, word for word. It was never implemented.
 *
 * What his code did (`CsGamingBot.py:1620`): the first `steal` ALWAYS failed and charged a third of
 * your money as bail, adding you to a module-level `robber` list; the second always succeeded and
 * took a random amount up to a third of the target's money.
 *
 * ⚠️ Four things wrong with that, all fixed here:
 *   1. `random.randrange(m)` **raises ValueError when m <= 0**, so stealing from anyone with 0 or
 *      less crashed the command.
 *   2. With a NEGATIVE balance, `money // 3` is negative and `money_add(-negative)` **pays you**.
 *      Being broke was profitable.
 *   3. `robber` was module-level and unpersisted: bot-wide, and reset on restart.
 *   4. `steal_money = random.randrange(m)` in the failure branch was computed and thrown away.
 *
 * ⚠️ And two deliberate design changes, which are Ote's to overrule:
 *   · A guaranteed-fail-then-guaranteed-succeed pair is a tax, not a gamble. It is now a real
 *     chance that depends on the tool, which is what makes the price ladder mean something.
 *   · **The tool is consumed.** Otherwise one 600-coin passkey steals forever and the market stops
 *     being a money sink.
 */

/** Kept from his numbers: a third of the victim's money, and a third of yours as bail. */
export const STEAL_RULES = {
    /** Most you can take, as a share of the victim's balance. His `money_check(target) // 3`. */
    MAX_SHARE: 1 / 3,
    /** Bail on a failed attempt, as a share of YOUR balance. His `money_check(author) // 3`. */
    BAIL_SHARE: 1 / 3,
    /** A victim below this is not worth robbing, and stealing 0 is a non-event. */
    MIN_VICTIM_MONEY: 3,
    /** No cooldown existed, which made it grief-spam. */
    COOLDOWN_MS: 10 * 60 * 1000,
    /** A well-defended target is nearly safe, never perfectly safe. */
    MIN_CHANCE: 0.05,
};

/**
 * The tools, priced as he priced them — 600 / 1000 / 3000 — so the ladder buys a better chance.
 * That the prices already form a hierarchy is what suggested this mapping.
 */
export const STEAL_TOOLS = {
    passkey: { kind: "steal", chance: 0.35, verb: "picked the lock on" },
    knife: { kind: "rob", chance: 0.5, verb: "held up" },
    gun: { kind: "rob", chance: 0.7, verb: "robbed at gunpoint" },
};

/** The pets, defending exactly what his descriptions say they defend. */
export const STEAL_DEFENCES = {
    cat: { against: ["steal"], reduction: 0.3, note: "the cat made a racket" },
    dog: { against: ["steal", "rob"], reduction: 0.5, note: "the dog saw them coming" },
};

export function toolFor(itemKey) {
    return STEAL_TOOLS[String(itemKey).toLowerCase()] ?? null;
}

/** Which of the victim's items apply to this kind of attempt. */
export function defencesAgainst(kind, victimItems) {
    return Object.entries(STEAL_DEFENCES)
        .filter(([itemKey, defence]) => defence.against.includes(kind) && victimItems.includes(itemKey))
        .map(([itemKey, defence]) => ({ itemKey, ...defence }));
}

/**
 * The chance this attempt succeeds, and what stood in the way. PURE.
 *
 * Both pets against a passkey take 0.35 − 0.8 below zero, so it clamps: a determined thief always
 * has a sliver, and a defended player is nearly — not perfectly — safe. That floor is a balance
 * decision, not a law.
 */
export function successChance(tool, defences) {
    const reduction = defences.reduce((sum, defence) => sum + defence.reduction, 0);
    return Math.max(STEAL_RULES.MIN_CHANCE, tool.chance - reduction);
}

/** The most that can be taken from a balance — his `// 3`, floored, never negative. */
export function maxTakeable(victimMoney) {
    return Math.max(0, Math.floor(victimMoney * STEAL_RULES.MAX_SHARE));
}

/**
 * How much is actually taken: 1 up to the third, inclusive.
 *
 * ⚠️ His `random.randrange(m)` gave `0 … m-1`, so a "successful" steal could take **nothing** and
 * still consume the attempt. At least 1 when there is anything to take.
 */
export function amountStolen(victimMoney, random = Math.random) {
    const pool = maxTakeable(victimMoney);
    if (pool <= 0) return 0;
    return 1 + Math.floor(random() * pool);
}

/**
 * Bail for a failed attempt: a third of the thief's money, floored, **never negative**.
 * His version paid you when you were in debt.
 */
export function bailFor(thiefMoney) {
    if (thiefMoney <= 0) return 0;
    return Math.floor(thiefMoney * STEAL_RULES.BAIL_SHARE);
}

export function cooldownRemaining(lastStealAt, now = Date.now()) {
    if (!lastStealAt) return 0;
    const elapsed = now - new Date(lastStealAt).getTime();
    return Math.max(0, STEAL_RULES.COOLDOWN_MS - elapsed);
}

/** Why an attempt cannot be made. Returns null when it can. */
export function validateSteal({
    thiefId,
    victimId,
    victimIsBot,
    tool,
    heldQuantity,
    thiefMoney,
    victimMoney,
    lastStealAt,
    now = Date.now(),
}) {
    if (String(thiefId) === String(victimId)) {
        return { code: "SELF", message: "you cannot steal from yourself" };
    }
    if (victimIsBot) {
        return { code: "BOT_VICTIM", message: "bots keep their coins in a vault" };
    }
    if (!tool) {
        return {
            code: "NO_TOOL",
            message: "you need a passkey, a knife or a gun — buy one from the market",
        };
    }
    if (!heldQuantity || heldQuantity < 1) {
        return { code: "TOOL_NOT_HELD", message: "you do not have that item" };
    }

    const remaining = cooldownRemaining(lastStealAt, now);
    if (remaining > 0) {
        return {
            code: "COOLDOWN",
            message: `lie low for another ${Math.ceil(remaining / 60000)} minute(s)`,
            remainingMs: remaining,
        };
    }

    if (victimMoney < STEAL_RULES.MIN_VICTIM_MONEY) {
        return {
            code: "VICTIM_TOO_POOR",
            message: `they only have ${victimMoney} — there is nothing worth taking`,
        };
    }
    // Not a hard block: you can attempt broke, you just cannot pay bail, and bailFor() floors at 0.
    void thiefMoney;

    return null;
}

/**
 * Resolve an attempt into money movements. PURE — the caller applies them in one transaction.
 *
 * @returns {{succeeded:boolean, amount:number, chance:number, defences:Array,
 *            movements:Array<{discordId:string, amount:number, reason:string, note:string}>}}
 */
export function resolveSteal({
    thiefId,
    victimId,
    tool,
    victimItems = [],
    thiefMoney,
    victimMoney,
    random = Math.random,
}) {
    const defences = defencesAgainst(tool.kind, victimItems);
    const chance = successChance(tool, defences);
    const succeeded = random() < chance;

    if (!succeeded) {
        const bail = bailFor(thiefMoney);
        return {
            succeeded: false,
            amount: 0,
            chance,
            defences,
            movements:
                bail > 0
                    ? [
                          {
                              discordId: String(thiefId),
                              amount: -bail,
                              reason: "steal_loss",
                              note: `caught trying to rob someone — bail of ${bail}`,
                          },
                      ]
                    : [],
        };
    }

    const amount = amountStolen(victimMoney, random);
    if (amount <= 0) {
        return { succeeded: true, amount: 0, chance, defences, movements: [] };
    }

    return {
        succeeded: true,
        amount,
        chance,
        defences,
        movements: [
            {
                discordId: String(victimId),
                amount: -amount,
                reason: "steal_loss",
                note: "robbed",
            },
            {
                discordId: String(thiefId),
                amount,
                reason: "steal_gain",
                note: "took it from someone",
            },
        ],
    };
}
