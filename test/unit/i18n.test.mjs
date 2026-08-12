/**
 * Unit: the t() seam and the catalogues.
 *
 * ⚠️ The most valuable check here is the **stray key** one. A mistyped key in a translation file
 * is invisible at runtime — `t()` falls back to English and everything looks fine — so the typo
 * would sit there forever with that string silently never translated. Comparing key sets in both
 * directions is the only way to see it.
 */

import assert from "node:assert/strict";

import {
    DEFAULT_LANG,
    coverage,
    isSupportedLang,
    languageName,
    missingKeys,
    strayKeys,
    supportedLangs,
    t,
    translator,
} from "../../lib/i18n.js";
import { CATALOGUES } from "../../app/i18n/index.js";

export default [
    {
        label: "English is the default and every language is measured against it",
        fn: () => {
            assert.equal(DEFAULT_LANG, "en");
            assert.ok(supportedLangs().includes("en"));
            assert.ok(Object.keys(CATALOGUES[DEFAULT_LANG]).length > 40, "the reference catalogue is thin");
        },
    },
    {
        label: "🔑 NO CATALOGUE HAS A STRAY KEY — a typo in a translation is invisible otherwise",
        fn: () => {
            for (const lang of supportedLangs()) {
                const stray = strayKeys(lang);
                assert.deepEqual(
                    stray,
                    [],
                    `"${lang}" has ${stray.length} key(s) English does not: ${stray.join(", ")} — ` +
                    "either a typo, or a key that was renamed in en.js and not here",
                );
            }
        },
    },
    {
        label: "every catalogue value is a non-empty string",
        fn: () => {
            for (const lang of supportedLangs()) {
                for (const [key, value] of Object.entries(CATALOGUES[lang])) {
                    assert.equal(typeof value, "string", `${lang}.${key} is not a string`);
                    assert.ok(value.trim().length > 0, `${lang}.${key} is empty`);
                }
            }
        },
    },
    {
        label: "🔑 a translation uses the SAME placeholders as the English it replaces",
        fn: () => {
            // A dropped {count} renders as nothing and reads like a bug in the game; an invented
            // one renders as literal braces. Both are caught here rather than by a player.
            const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

            for (const lang of supportedLangs()) {
                if (lang === DEFAULT_LANG) continue;
                for (const [key, value] of Object.entries(CATALOGUES[lang])) {
                    const base = CATALOGUES[DEFAULT_LANG][key];
                    if (base === undefined) continue; // covered by the stray-key test
                    assert.deepEqual(
                        placeholders(value),
                        placeholders(base),
                        `${lang}.${key} placeholders differ from en.${key}`,
                    );
                }
            }
        },
    },
    {
        label: "t() resolves, then falls back to English, then to the key itself",
        fn: () => {
            assert.equal(t("about.uptime", "en"), "Uptime");
            assert.notEqual(t("about.uptime", "th"), "Uptime", "Thai should differ from English");

            // An unknown language falls back rather than throwing.
            assert.equal(t("about.uptime", "zz"), "Uptime");
            assert.equal(t("about.uptime", null), "Uptime");
            assert.equal(t("about.uptime", undefined), "Uptime");

            // An unknown key returns the key, so the failure is visible but not fatal.
            assert.equal(t("no.such.key"), "no.such.key");
            assert.equal(t("no.such.key", "th"), "no.such.key");
        },
    },
    {
        label: "🔑 a MISSING placeholder value stays visible rather than printing 'undefined'",
        fn: () => {
            // "undefined coins" reads like a real number and gets ignored; a literal {high} gets
            // reported.
            assert.equal(t("rand.range", "en", { low: 1, high: 10 }), "between 1 and 10");
            assert.equal(t("rand.range", "en", { low: 1 }), "between 1 and {high}");
            assert.equal(t("rand.range", "en", {}), "between {low} and {high}");
            assert.equal(t("rand.range", "en", null), "between {low} and {high}");
        },
    },
    {
        label: "a placeholder value of 0 or empty string still interpolates",
        fn: () => {
            // A falsy-but-present value is a real value. `params[key] || whole` would break this.
            assert.equal(t("rand.range", "en", { low: 0, high: 0 }), "between 0 and 0");
            assert.match(t("feedback.rate_limited", "en", { count: 0 }), /0 pieces/);
        },
    },
    {
        label: "translator() binds a language once",
        fn: () => {
            const s = translator("th");
            assert.equal(s("about.uptime"), t("about.uptime", "th"));
            assert.equal(s("rand.range", { low: 2, high: 4 }), t("rand.range", "th", { low: 2, high: 4 }));
        },
    },
    {
        label: "isSupportedLang is case-insensitive and rejects nonsense",
        fn: () => {
            assert.equal(isSupportedLang("en"), true);
            assert.equal(isSupportedLang("EN"), true);
            assert.equal(isSupportedLang("th"), true);
            assert.equal(isSupportedLang("zz"), false);
            assert.equal(isSupportedLang(""), false);
            assert.equal(isSupportedLang(null), false);
            assert.equal(isSupportedLang(42), false);
        },
    },
    {
        label: "⚠️ ONLY languages with real strings are offered — his 64 were machine-translated",
        fn: () => {
            // The deliberate trade: fewer languages, each of which the bot can actually speak.
            // Offering one it cannot means a player sets it and sees English with no explanation.
            for (const lang of supportedLangs()) {
                assert.ok(CATALOGUES[lang], `${lang} is advertised without a catalogue`);
                assert.ok(Object.keys(CATALOGUES[lang]).length > 0, `${lang}'s catalogue is empty`);
            }
            assert.ok(supportedLangs().length >= 2, "the seam is pointless with one language");
        },
    },
    {
        label: "coverage() reports a real percentage per language",
        fn: () => {
            const report = coverage();
            assert.equal(report.length, supportedLangs().length);

            const english = report.find((c) => c.lang === "en");
            assert.equal(english.percent, 100, "the reference language is 100% by definition");

            for (const entry of report) {
                assert.ok(entry.percent >= 0 && entry.percent <= 100, `${entry.lang}: ${entry.percent}%`);
                assert.equal(entry.translated + missingKeys(entry.lang).length, entry.total);
                assert.ok(entry.name.length > 0, `${entry.lang} has no display name`);
            }
        },
    },
    {
        label: "every supported language has a display name, and unknown codes echo back",
        fn: () => {
            for (const lang of supportedLangs()) {
                assert.notEqual(languageName(lang), lang, `${lang} has no human name`);
            }
            assert.equal(languageName("zz"), "zz");
        },
    },
    {
        label: "⭐ the credits are NOT in the catalogue — names must not be translated",
        fn: () => {
            // "Art" would become a common noun in half the languages on earth. The about embed
            // keeps the credit line literal and only translates the prose around it.
            const all = Object.values(CATALOGUES).flatMap((c) => Object.values(c)).join("\n");
            for (const name of ["Mickey", "Tonnow", "Jojo"]) {
                assert.ok(!all.includes(name), `"${name}" is in a catalogue and could be translated`);
            }
        },
    },
];
