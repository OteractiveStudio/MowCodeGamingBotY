/**
 * test/lib/harness.mjs — the smallest runner that can tell the truth.
 *
 * A test file default-exports an array of `{ label, fn }`. Failures are caught,
 * reported with their message, and counted; the runner never throws, so one
 * broken test cannot hide the rest.
 *
 * ⚠️ A green log line and a zero exit are not the same thing (STANDARDS §5).
 * Nothing here prints "PASS" that is not derived from a counter the caller reads.
 */

export async function runSuite(title, cases) {
    console.log(`\n── ${title} ${"─".repeat(Math.max(0, 64 - title.length))}`);

    let passed = 0;
    const failures = [];

    for (const { label, fn } of cases) {
        try {
            await fn();
            passed += 1;
            console.log(`  ✓ ${label}`);
        } catch (err) {
            failures.push({ label, error: err });
            console.log(`  ✗ ${label}`);
            console.log(`      ${err.message.split("\n").join("\n      ")}`);
        }
    }

    return { title, passed, failures };
}

/** Assert a function throws, and that the message says something useful. */
export async function assertThrows(fn, expectedFragment) {
    let threw = null;
    try {
        await fn();
    } catch (err) {
        threw = err;
    }

    if (!threw) {
        throw new Error(`expected a throw${expectedFragment ? ` mentioning "${expectedFragment}"` : ""}, but nothing was thrown`);
    }

    if (expectedFragment && !threw.message.includes(expectedFragment)) {
        throw new Error(
            `threw, but the message did not mention "${expectedFragment}": ${threw.message}`,
        );
    }

    return threw;
}
