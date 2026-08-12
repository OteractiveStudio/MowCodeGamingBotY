/**
 * Unit: the connection-config helper throws instead of half-answering.
 *
 * ⚠️ The incident this guards: 56 scripts each carried their own copy of a
 * connection string; when the database was renamed they all still *connected* —
 * to real, months-stale data — and went green against the wrong database. A
 * helper that returns a partial object is how that happens quietly.
 */

import assert from "node:assert/strict";

import {
    resolveDatabaseConfig,
    describeDatabaseTarget,
    assertSafeIdentifier,
} from "../../database/connection-config.js";
import { assertThrows } from "../lib/harness.mjs";

const good = {
    database: {
        connection: {
            username: "u",
            password: "p",
            database: "d",
            schemas: { parent: "public", project: "some_schema" },
            host: "127.0.0.1",
            port: 54322,
            dialect: "postgres",
        },
    },
};

function withConnection(overrides) {
    return {
        database: {
            connection: { ...good.database.connection, ...overrides },
        },
    };
}

export default [
    {
        label: "a complete config resolves, with the port coerced to a number",
        fn: () => {
            const resolved = resolveDatabaseConfig(good);
            assert.equal(resolved.schema, "some_schema");
            assert.equal(resolved.port, 54322);
            assert.equal(typeof resolved.port, "number");
        },
    },
    {
        label: "a missing database.connection throws, naming the file to fix",
        fn: async () => {
            await assertThrows(() => resolveDatabaseConfig({}), "database.connection");
        },
    },
    {
        label: "each missing credential is named in the error, not just the first",
        fn: async () => {
            const err = await assertThrows(
                () => resolveDatabaseConfig(withConnection({ username: "", password: "" })),
                "missing",
            );
            assert.match(err.message, /username/);
            assert.match(err.message, /password/);
        },
    },
    {
        label: "a missing project schema throws — it is never defaulted to public",
        fn: async () => {
            await assertThrows(
                () => resolveDatabaseConfig(withConnection({ schemas: { parent: "public" } })),
                "schemas.project",
            );
        },
    },
    {
        label: "a non-numeric port throws rather than silently becoming NaN",
        fn: async () => {
            await assertThrows(() => resolveDatabaseConfig(withConnection({ port: "abc" })), "port");
            await assertThrows(() => resolveDatabaseConfig(withConnection({ port: 0 })), "port");
        },
    },
    {
        label: "a schema name that is not a plain identifier is rejected",
        fn: async () => {
            // The schema name is string-substituted into SQL, so this is the guard
            // that stops config from becoming an injection vector.
            // An EMPTY schema is a different error — "missing", asserted above —
            // so it is deliberately not in this list.
            for (const bad of ['pub"lic', "a b", "1abc", "drop;table", "sch-ema"]) {
                await assertThrows(
                    () => resolveDatabaseConfig(withConnection({ schemas: { project: bad } })),
                    "identifier",
                );
            }
            assert.equal(assertSafeIdentifier("mowcodegamingbot_y", "x"), "mowcodegamingbot_y");
        },
    },
    {
        label: "describeDatabaseTarget never includes the password",
        fn: () => {
            const resolved = resolveDatabaseConfig(
                withConnection({ password: "hunter2-should-never-print" }),
            );
            const described = describeDatabaseTarget(resolved);
            assert.ok(
                !described.includes("hunter2-should-never-print"),
                `the password leaked into a printable string: ${described}`,
            );
            assert.match(described, /schema=some_schema/);
        },
    },
];
