/**
 * database/index.js — bring up Sequelize, mirror the migrated schema, hand back
 * one `db` object.
 *
 * 🔑 This is the seam the whole rewrite turns on. The legacy `MCGB_BasicClass`
 * drew it in the right place — cogs never opened a file, they called
 * `b.money_add()` — and everything behind the seam was read-whole-file →
 * mutate → write-whole-file with no lock. Cogs still never touch the store; what
 * changed is that behind here, a mutation is one atomic statement.
 */

import { Sequelize } from "sequelize";

import { loadConfig, log, logQuery, getQueryLogOptions } from "../lib/utility.js";
import {
    resolveDatabaseConfig,
    describeDatabaseTarget,
} from "./connection-config.js";
import initModels from "./models/index.js";

export async function initDB(config = loadConfig()) {
    const target = resolveDatabaseConfig(config);
    const queryLogging = getQueryLogOptions(config);

    const loggingFunction =
        queryLogging.logToFile || queryLogging.logToConsole
            ? (query, duration) => logQuery(query, duration)
            : false;

    const sequelize = new Sequelize(
        target.database,
        target.username,
        target.password,
        {
            host: target.host,
            port: target.port,
            dialect: target.dialect,
            benchmark: queryLogging.benchmark,
            logging: loggingFunction,
        },
    );

    await sequelize.authenticate();
    await log(`Database connected — ${describeDatabaseTarget(target)}`, import.meta.url);

    // ⚠️ We VERIFY the schema rather than creating it. Creating it here would let
    // the app start against a schema that has no tables, and then the first real
    // query is where you find out — with a confusing error. The migration owns
    // the schema; this just refuses to guess.
    const [schemaRow] = await sequelize.query(
        "SELECT 1 AS present FROM pg_namespace WHERE nspname = :schema",
        { replacements: { schema: target.schema }, type: Sequelize.QueryTypes.SELECT },
    );

    if (!schemaRow) {
        throw new Error(
            `Schema "${target.schema}" does not exist in ${target.database}. ` +
            `Run \`npm run db:migrate\` first — the SQL migration owns the schema, not sync().`,
        );
    }

    const { models, choices } = initModels(sequelize, {
        project: target.schema,
        parent: target.parentSchema,
    });

    const syncOptions = config.database?.sync || { alter: false, force: false };

    if (syncOptions.force) {
        await log(
            "⚠️ database.sync.force is TRUE — sync will DROP and recreate every table it knows about",
            "warning",
            import.meta.url,
        );
    }

    // { alter: false } always. sync() cannot express a CHECK constraint, a
    // partial index, or NOT NULL on the columns that matter, so it must never be
    // the thing that reshapes a table — the SQL migration is.
    await sequelize.sync({ ...syncOptions, alter: false });

    const db = {
        sequelize,
        schema: target.schema,
        ...models,
        choices,
    };

    return db;
}

export async function closeDB(db) {
    if (db?.sequelize) {
        await db.sequelize.close();
    }
}
