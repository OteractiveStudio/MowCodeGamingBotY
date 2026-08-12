/**
 * database/connection-config.js — the ONE helper that resolves database
 * connection settings, and THROWS rather than returning a half-filled object.
 *
 * Why it is a whole file: elsewhere, 56 scripts each carried their own copy of a
 * connection string. When the database was renamed they all still *connected* —
 * to real, months-stale data — and went green against the wrong database. A
 * helper that throws is the fix; a helper that returns `{}` is the bug.
 */

import { loadConfig } from "../lib/utility.js";

/** Postgres unquoted identifier. Also the guard on string-substituting a schema name into SQL. */
const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]*$/;

export function assertSafeIdentifier(value, what) {
    if (typeof value !== "string" || !SAFE_IDENTIFIER.test(value)) {
        throw new Error(
            `${what} is not a valid unquoted Postgres identifier: ${JSON.stringify(value)}`,
        );
    }
    return value;
}

/**
 * @returns {{username:string,password:string,database:string,host:string,port:number,dialect:string,schema:string,parentSchema:string}}
 * @throws if anything required is missing — never a partial object.
 */
export function resolveDatabaseConfig(config = loadConfig()) {
    const connection = config?.database?.connection;

    if (!connection || typeof connection !== "object") {
        throw new Error(
            "config.json is missing `database.connection`. Copy the shape from config.example.json.",
        );
    }

    const missing = ["username", "password", "database"].filter(
        (key) => !connection[key],
    );
    if (missing.length > 0) {
        throw new Error(
            `config.json \`database.connection\` is missing: ${missing.join(", ")}. ` +
            `These are secrets — they belong in config.json (gitignored), never in config.example.json.`,
        );
    }

    const schema = connection.schemas?.project;
    if (!schema) {
        throw new Error(
            "config.json is missing `database.connection.schemas.project` — the project's schema name.",
        );
    }
    assertSafeIdentifier(schema, "database.connection.schemas.project");

    const parentSchema = connection.schemas?.parent || "public";
    assertSafeIdentifier(parentSchema, "database.connection.schemas.parent");

    const port = Number(connection.port);
    if (!Number.isInteger(port) || port <= 0) {
        throw new Error(
            `config.json \`database.connection.port\` is not a port number: ${JSON.stringify(connection.port)}`,
        );
    }

    return {
        username: connection.username,
        password: connection.password,
        database: connection.database,
        host: connection.host || "127.0.0.1",
        port,
        dialect: connection.dialect || "postgres",
        schema,
        parentSchema,
    };
}

/** What is safe to print or log — never the password. */
export function describeDatabaseTarget(resolved) {
    return `${resolved.username}@${resolved.host}:${resolved.port}/${resolved.database} schema=${resolved.schema}`;
}
