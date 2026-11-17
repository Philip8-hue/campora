import { AsyncLocalStorage } from 'node:async_hooks';
import { DatabaseSync } from 'node:sqlite';

export async function openDatabase({ databasePath, databaseUrl }) {
    const transactionClient = new AsyncLocalStorage();
    if (!databaseUrl) {
        const sqlite = new DatabaseSync(databasePath ?? ':memory:');
        sqlite.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;');
        let tail = Promise.resolve();
        const request = work => {
            const queued = tail.then(work);
            tail = queued.catch(() => {});
            return queued;
        };
        return {
            postgres: false,
            exec: sql => sqlite.exec(sql),
            prepare: sql => {
                const stmt = sqlite.prepare(sql);
                return { get: (...args) => stmt.get(...args), all: (...args) => stmt.all(...args), run: (...args) => stmt.run(...args) };
            },
            transaction: work => transact(sql => sqlite.exec(sql), work, 'BEGIN IMMEDIATE'),
            request,
            close: () => tail.then(() => sqlite.close())
        };
    }

    const { Pool } = (await import('pg')).default;
    const url = new URL(databaseUrl);
    // Enforce certificate verification even if a copied URL supplies different SSL options.
    for (const option of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'ssl']) {
        url.searchParams.delete(option);
    }
    const pool = new Pool({
        connectionString: url.href,
        ssl: { rejectUnauthorized: true, ...(process.env.SUPABASE_CA_CERT ? { ca: process.env.SUPABASE_CA_CERT } : {}) },
        onConnect: client => client.query('SET search_path TO campora, pg_catalog'),
        max: 5,
        connectionTimeoutMillis: 5000
    });
    pool.on('error', error => console.error('Campora database connection failed', error.code || error.name));
    const exec = (sql, values) => (transactionClient.getStore() || pool).query(sql, values);
    const prepare = sql => {
        let index = 0;
        const query = sql.replace(/\?/g, () => '$' + ++index);
        return {
            get: async (...args) => (await exec(query, args)).rows[0],
            all: async (...args) => (await exec(query, args)).rows,
            run: async (...args) => ({ changes: (await exec(query, args)).rowCount })
        };
    };
    return {
        postgres: true,
        exec,
        prepare,
        async transaction(work) {
            const client = await pool.connect();
            try {
                return await transactionClient.run(client, () => transact(sql => client.query(sql), work));
            } finally {
                client.release();
            }
        },
        request: work => work(),
        close: () => pool.end()
    };
}

async function transact(exec, work, begin = 'BEGIN') {
    await exec(begin);
    try {
        const result = await work();
        await exec(result?.error ? 'ROLLBACK' : 'COMMIT');
        return result;
    } catch (error) {
        await exec('ROLLBACK');
        throw error;
    }
}
