import { createCampusOperations } from './operations.mjs';
import { createServer } from 'node:http';
import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './database.mjs';
import { createCommunity } from './community.mjs';

const minute = 60_000;
const sessionLifetime = 7 * 24 * 60 * minute;
const emailPattern = /^[a-z0-9][a-z0-9._%+\-]*@[a-z0-9.-]+\.[a-z]{2,}$/;
const normalizeEmail = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
const digest = value => createHash('sha256').update(value).digest('hex');
const derivePassword = promisify(scrypt);
const passwordHash = (password, salt) => derivePassword(password, salt, 32, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 });
const asset = name => readFileSync(new URL('campora/' + name, import.meta.url));
const assets = new Map([
    ['/favicon.png', ['image/png', asset('favicon.png')]],
    ['/campora.css', ['text/css; charset=utf-8', asset('campora.css')]],
    ['/campus-design.css', ['text/css; charset=utf-8', asset('campus-design.css')]],
    ['/community-client.js', ['text/javascript; charset=utf-8', asset('community-client.js')]],
    ['/campus-operations.js', ['text/javascript; charset=utf-8', asset('campus-operations.js')]],
    ['/admin.js', ['text/javascript; charset=utf-8', asset('admin.js')]],
    ['/auth.js', ['text/javascript; charset=utf-8', asset('auth.js')]],
    ['/setup.js', ['text/javascript; charset=utf-8', asset('setup.js')]],
    ['/campora.js', ['text/javascript; charset=utf-8', asset('campora.js')]],
    ['/profile.js', ['text/javascript; charset=utf-8', asset('profile.js')]]
]);
const pages = new Map([
    ['/', asset('index.html')],
    ['/index.html', asset('index.html')],
    ['/profile.html', asset('profile.html')],
    ['/setup', asset('setup.html')],
    ['/admin', asset('admin.html')]
]);
const signinPage = asset('signin.html');

export function createBrevoSender(apiKey, from, send = fetch) {
    return async (email, code) => {
        const response = await send('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sender: { name: 'Campora', email: from },
                to: [{ email }],
                subject: 'Your Campora verification code',
                textContent: 'Your Campora verification code is ' + code + '. It expires in 10 minutes.'
            }),
            signal: AbortSignal.timeout(10_000)
        });
        if (!response.ok) throw new Error('Email delivery failed.');
    };
}

export function createCloudflareIceProvider(keyId, token, request = fetch) {
    return async () => {
        const response = await request(
            'https://rtc.live.cloudflare.com/v1/turn/keys/' + encodeURIComponent(keyId) + '/credentials/generate-ice-servers',
            {
                method: 'POST',
                headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
                body: JSON.stringify({ ttl: 3600 }),
                signal: AbortSignal.timeout(8000)
            }
        );
        if (!response.ok) throw new Error('TURN credentials unavailable.');
        const { iceServers } = await response.json();
        if (!Array.isArray(iceServers)) throw new Error('Invalid TURN response.');
        return iceServers.map(server => ({
            ...server,
            urls: [server.urls].flat().filter(url => !/:53(?:\?|$)/.test(url))
        })).filter(server => server.urls.length);
    };
}

export async function createCamporaServer({ databasePath, databaseUrl, origin, approvedStudent = () => true, sendCode, moderators = new Set(), iceServers = [], getIceServers, preview = false }) {
    const secure = new URL(origin).protocol === 'https:';
    const cookieName = secure ? '__Host-campora-session' : 'campora-session';
    const cookieOptions = 'Path=/; HttpOnly; SameSite=Lax' + (secure ? '; Secure' : '');
    const db = await openDatabase({ databasePath, databaseUrl });
    if (db.postgres) await db.exec('CREATE SCHEMA IF NOT EXISTS campora');
    await db.exec(`
        CREATE TABLE IF NOT EXISTS accounts (email TEXT PRIMARY KEY, id TEXT UNIQUE NOT NULL);
        CREATE TABLE IF NOT EXISTS unverified_accounts (email TEXT PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS passwords (email TEXT PRIMARY KEY, salt TEXT NOT NULL, hash TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS challenges (
            email TEXT PRIMARY KEY, mode TEXT NOT NULL, proof TEXT NOT NULL,
            expires BIGINT NOT NULL, attempts INTEGER NOT NULL, sent BIGINT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, email TEXT NOT NULL, expires BIGINT NOT NULL);
        CREATE TABLE IF NOT EXISTS limits (address TEXT PRIMARY KEY, until BIGINT NOT NULL, count INTEGER NOT NULL);
    `);
    const operations = await createCampusOperations(db, getIceServers ? [] : iceServers, approvedStudent);
    const community = await createCommunity(db, approvedStudent);
    const profileReady = db.prepare('SELECT 1 FROM profiles WHERE id = ? AND username IS NOT NULL');
    const challenge = db.prepare('SELECT * FROM challenges WHERE email = ?');
    const removeChallenge = db.prepare('DELETE FROM challenges WHERE email = ? AND proof = ?');
    const session = db.prepare(`SELECT sessions.email, accounts.id,
        NOT EXISTS (SELECT 1 FROM unverified_accounts WHERE unverified_accounts.email = sessions.email) AS verified
        FROM sessions JOIN accounts USING (email) WHERE token = ? AND expires > ?`);
    const unverifiedAccount = db.prepare('SELECT 1 FROM unverified_accounts WHERE email = ?');
    const credential = db.prepare('SELECT salt, hash FROM passwords WHERE email = ?');
    const accountByEmail = db.prepare('SELECT id FROM accounts WHERE email = ?');
    const dummySalt = randomBytes(16).toString('hex');
    const dummyHash = randomBytes(32);

    function reply(res, status, body, type = 'text/plain; charset=utf-8') {
        res.writeHead(status, { 'Content-Type': type });
        res.end(body);
    }

    function json(res, status, data) {
        reply(res, status, JSON.stringify(data), 'application/json; charset=utf-8');
    }

    async function handle(req, res) {
        const url = new URL(req.url, origin);
        const path = url.pathname;
        function signInDestination(next) {
            if (next === '/admin' && member?.moderator) return '/admin';
            return typeof next === 'string' && /^\/\?post=[a-f0-9-]{36}$/.test(next) ? next : '/';
        }
        const now = Date.now();
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('Referrer-Policy', 'same-origin');

        const token = req.headers.cookie?.match(new RegExp('(?:^|; *)' + cookieName + '=([a-f0-9]{64})(?:;|$)'))?.[1];
        const tokenHash = token && digest(token);
        const member = tokenHash && await session.get(tokenHash, now);
        if (member) member.moderator = Boolean(member.verified && moderators.has(member.email));
        const signedIn = member && approvedStudent(member.email);

        if (req.method === 'GET' && path === '/healthz') {
            await db.prepare('SELECT id FROM accounts LIMIT 1').get();
            return json(res, 200, { ok: true });
        }

        if (path.startsWith('/api/')) {
            if (!signedIn) return json(res, 401, { error: 'Log in to continue.' });
            if (req.method === 'GET' && path === '/api/ice') {
                try {
                    return json(res, 200, getIceServers ? await getIceServers(member.id) : iceServers);
                } catch {
                    return json(res, 503, { error: 'Live video connection setup is unavailable. Try again shortly.' });
                }
            }
            let input;
            if (req.method === 'POST') {
                if (req.headers.origin !== origin) return json(res, 403, { error: 'Open Campora directly and try again.' });
                const chunks = [];
                let size = 0;
                const maximum = ['/api/profile', '/api/feed', '/api/stories'].includes(path) ? 7_100_000 : path === '/api/broadcast' ? 140_000 : 8192;
                for await (const chunk of req) {
                    size += chunk.length;
                    if (size > maximum) return json(res, 413, { error: 'This upload is too large.' });
                    chunks.push(chunk);
                }
                try { input = JSON.parse(Buffer.concat(chunks)); }
                catch { return json(res, 400, { error: 'Invalid request.' }); }
            }
            const result = (await operations(req.method, path, url.searchParams, member, input)) ??
                (await community(req.method, path, url.searchParams, member, input));
            if (result.media) {
                res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
                const { data, type } = result.media;
                res.setHeader('Accept-Ranges', 'bytes');
                if (req.headers.range) {
                    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
                    const start = range?.[1] ? Number(range[1]) : Math.max(0, data.length - Number(range?.[2]));
                    const end = range?.[1] && range[2] ? Math.min(Number(range[2]), data.length - 1) : data.length - 1;
                    if (!range || !Number.isSafeInteger(start) || start > end) {
                        res.setHeader('Content-Range', 'bytes */' + data.length);
                        return reply(res, 416, 'Invalid byte range.');
                    }
                    res.setHeader('Content-Range', 'bytes ' + start + '-' + end + '/' + data.length);
                    res.setHeader('Content-Length', end - start + 1);
                    return reply(res, 206, data.subarray(start, end + 1), type);
                }
                res.setHeader('Content-Length', data.length);
                return reply(res, 200, data, type);
            }
            return json(res, result.status || 200, result.error ? { error: result.error } : result.data);
        }

        if (req.method === 'GET') {
            if (assets.has(path)) {
                const [type, content] = assets.get(path);
                return reply(res, 200, content, type);
            }
            if (path === '/signin' || pages.has(path)) {
                if ((path === '/signin') === Boolean(signedIn)) {
                    res.writeHead(303, { Location: signedIn ? signInDestination(url.searchParams.get('next')) : '/signin' + (path === '/admin' || /^\?post=[a-f0-9-]{36}$/.test(url.search) ? '?next=' + encodeURIComponent(path === '/admin' ? '/admin' : '/' + url.search) : '') });
                    return res.end();
                }
                if (path === '/admin' && !member.moderator) {
                    return reply(res, 403, 'This workspace requires a Campora moderator account.');
                }
                if (signedIn && path !== '/admin') {
                    const ready = await profileReady.get(member.id);
                    if (path === '/setup' && ready) {
                        res.writeHead(303, { Location: signInDestination(url.searchParams.get('next')) });
                        return res.end();
                    }
                    if (path !== '/setup' && !ready) {
                        const next = signInDestination('/' + url.search);
                        res.writeHead(303, { Location: '/setup' + (next === '/' ? '' : '?next=' + encodeURIComponent(next)) });
                        return res.end();
                    }
                }
                return reply(res, 200, signedIn ? pages.get(path) : signinPage, 'text/html; charset=utf-8');
            }
            if (path === '/auth/session') {
                return json(res, signedIn ? 200 : 401, { signedIn: Boolean(signedIn) });
            }
            if (path === '/session.js' && signedIn) {
                return reply(res, 200, 'window.camporaAccountId = ' + JSON.stringify(member.id) + '; window.camporaModerator = ' + member.moderator + ';', 'text/javascript; charset=utf-8');
            }
            return reply(res, 404, 'Page not found.');
        }

        if (req.method !== 'POST' || !['/auth/login', '/auth/signup', '/auth/request', '/auth/verify', '/auth/logout'].includes(path)) {
            return reply(res, 404, 'Page not found.');
        }
        if (req.headers.origin !== origin) return json(res, 403, { error: 'Open Campora directly and try again.' });

        if (path === '/auth/logout') {
            if (tokenHash) await db.prepare('DELETE FROM sessions WHERE token = ?').run(tokenHash);
            res.writeHead(303, { Location: '/signin', 'Set-Cookie': cookieName + '=; Max-Age=0; ' + cookieOptions });
            return res.end();
        }

        await db.prepare('DELETE FROM limits WHERE until <= ?').run(now);
        const limit = await db.prepare(`
            INSERT INTO limits VALUES (?, ?, 1)
            ON CONFLICT(address) DO UPDATE SET count = limits.count + 1 RETURNING count
        `).get(req.socket.remoteAddress, now + 10 * minute);
        if (limit.count > 60) return json(res, 429, { error: 'Too many attempts. Try again in 10 minutes.' });

        let body = '';
        const authBodyLimit = ['/auth/verify', '/auth/signup'].includes(path) ? 7_100_000 : 2048;
        req.setEncoding('utf8');
        for await (const chunk of req) {
            body += chunk;
            if (body.length > authBodyLimit) return json(res, 413, { error: 'Request is too large.' });
        }
        let input;
        try { input = JSON.parse(body); } catch { return json(res, 400, { error: 'Invalid request.' }); }

        const email = normalizeEmail(input?.email);
        if (email.length > 254 || !emailPattern.test(email)) {
            return json(res, 400, { error: 'Enter a valid email address.' });
        }

        const password = input?.password;
        const validPassword = typeof password === 'string' && password.length <= 128 && password.length >= 15;
        async function createSession() {
            const newToken = randomBytes(32).toString('hex');
            if (tokenHash) await db.prepare('DELETE FROM sessions WHERE token = ?').run(tokenHash);
            await db.prepare('DELETE FROM sessions WHERE expires <= ?').run(now);
            await db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(digest(newToken), email, now + sessionLifetime);
            return newToken;
        }
        async function finishSignIn(token) {
            const destination = input.next === '/admin' && moderators.has(email) && !await unverifiedAccount.get(email)
                ? '/admin' : signInDestination(input.next === '/admin' ? null : input.next);
            res.setHeader('Set-Cookie', cookieName + '=' + token + '; Max-Age=' + sessionLifetime / 1000 + '; ' + cookieOptions);
            return json(res, 200, { ok: true, destination });
        }

        if (path === '/auth/login') {
            const loginLimit = await db.prepare(`
                INSERT INTO limits VALUES (?, ?, 1)
                ON CONFLICT(address) DO UPDATE SET count = limits.count + 1 RETURNING count
            `).get('password:' + email, now + 10 * minute);
            if (loginLimit.count > 10) return json(res, 429, { error: 'Too many attempts. Try again in 10 minutes or reset your password.' });
            const saved = await credential.get(email);
            if (validPassword) {
                const actual = await passwordHash(password, saved?.salt ?? dummySalt);
                const matches = timingSafeEqual(actual, saved ? Buffer.from(saved.hash, 'hex') : dummyHash);
                if (matches && saved && approvedStudent(email)) {
                    const newToken = await db.transaction(async () => {
                        const current = await db.prepare('SELECT hash FROM passwords WHERE email = ?' + (db.postgres ? ' FOR UPDATE' : '')).get(email);
                        if (current?.hash !== saved.hash) return null;
                        await db.prepare('DELETE FROM limits WHERE address = ?').run('password:' + email);
                        return createSession();
                    });
                    if (newToken) return finishSignIn(newToken);
                }
            }
            return json(res, 401, { error: 'Email or password is incorrect. Use Set or reset password if you need a password.' });
        }

        const directSignup = path === '/auth/signup';
        const mode = directSignup ? 'signup' : input.mode ?? 'password';
        if (mode !== 'signup' && mode !== 'password') return json(res, 400, { error: 'Invalid request.' });
        if (directSignup && !approvedStudent(email)) return json(res, 403, { error: 'This email cannot be used to create an account.' });
        if (directSignup && moderators.has(email)) {
            return json(res, 403, { error: 'This address requires verification. Open the admin sign-in page to create its account.' });
        }
        if (path === '/auth/request') {
            if (!sendCode) return json(res, 503, { error: 'Email codes are currently unavailable. Contact Campora support if you need account access.' });
            if (!approvedStudent(email)) {
                return json(res, 200, { ok: true });
            }
            const code = String(randomInt(100_000_000)).padStart(8, '0');
            const salt = randomBytes(24).toString('hex');
            const proof = salt + ':' + digest(salt + code);
            await db.prepare('DELETE FROM challenges WHERE expires <= ?').run(now);
            const sent = await db.prepare(`
                INSERT INTO challenges VALUES (?, ?, ?, ?, 0, ?)
                ON CONFLICT(email) DO UPDATE SET mode=excluded.mode, proof=excluded.proof,
                    expires=excluded.expires, attempts=0, sent=excluded.sent
                WHERE challenges.sent <= ?
            `).run(email, mode, proof, now + 10 * minute, now, now - minute);
            if (!sent.changes) return json(res, 429, { error: 'Wait one minute before requesting another code.' });
            try {
                await sendCode(email, code);
            } catch {
                await removeChallenge.run(email, proof);
                return json(res, 503, { error: 'Email delivery is unavailable. Try again shortly.' });
            }
            return json(res, 200, preview ? { ok: true, previewCode: code } : { ok: true });
        }

        const pending = directSignup ? null : await challenge.get(email);
        const code = input?.code;
        if (!validPassword) return json(res, 400, { error: 'Use a password between 15 and 128 characters.' });
        if (!directSignup && (!approvedStudent(email) || !pending || pending.mode !== mode || pending.expires <= now ||
            pending.attempts >= 5 || typeof code !== 'string' || !/^\d{8}$/.test(code))) {
            return json(res, 400, { error: 'That code is invalid or expired. Request a new code and try again.' });
        }
        if (pending) {
            const [salt, expected] = pending.proof.split(':');
            if (!timingSafeEqual(Buffer.from(digest(salt + code), 'hex'), Buffer.from(expected, 'hex'))) {
                await db.prepare('UPDATE challenges SET attempts = attempts + 1 WHERE email = ? AND proof = ?').run(email, pending.proof);
                return json(res, 400, { error: 'That code is invalid or expired. Check it or request a new code.' });
            }
        }

        const newSalt = randomBytes(16).toString('hex');
        const hash = (await passwordHash(password, newSalt)).toString('hex');
        let result;
        try {
            result = await db.transaction(async () => {
                if (pending) {
                    const consumed = await db.prepare('DELETE FROM challenges WHERE email = ? AND proof = ? AND expires > ? AND attempts < 5').run(email, pending.proof, Date.now());
                    if (!consumed.changes) return { status: 400, error: 'That code is invalid or expired. Request a new code.' };
                }
                const existingAccount = await accountByEmail.get(email);
                if (mode === 'signup') {
                    if (existingAccount) return { status: 409, error: 'This email already has an account. Sign in or use Set or reset password.' };
                    if (typeof input.profile?.username !== 'string' || typeof input.profile?.name !== 'string') {
                        return { status: 400, error: 'Enter a display name and username.' };
                    }
                    const id = randomBytes(16).toString('hex');
                    const inserted = await db.prepare('INSERT INTO accounts VALUES (?, ?) ON CONFLICT(email) DO NOTHING').run(email, id);
                    if (!inserted.changes) return { status: 409, error: 'This email already has an account. Sign in or use Set or reset password.' };
                    if (directSignup) await db.prepare('INSERT INTO unverified_accounts VALUES (?)').run(email);
                    const profile = await community('POST', '/api/profile', url.searchParams, { id, email }, input.profile);
                    if (profile.error) return profile;
                } else if (!existingAccount) {
                    return { status: 400, error: 'There is no account for this email. Use Create account to sign up.' };
                }
                await db.prepare('INSERT INTO passwords VALUES (?, ?, ?) ON CONFLICT(email) DO UPDATE SET salt=excluded.salt, hash=excluded.hash').run(email, newSalt, hash);
                if (pending) await db.prepare('DELETE FROM unverified_accounts WHERE email = ?').run(email);
                await db.prepare('DELETE FROM sessions WHERE email = ?').run(email);
                await db.prepare('DELETE FROM limits WHERE address = ?').run('password:' + email);
                return { token: await createSession() };
            });
        } catch (error) {
            if (error.code === '23505' && error.constraint === 'profiles_username') {
                return json(res, 409, { error: 'That username is taken. Use Edit account details to choose another one.' });
            }
            throw error;
        }
        return result.error ? json(res, result.status, { error: result.error }) : finishSignIn(result.token);
    }

    const server = createServer((req, res) => {
        db.request(() => handle(req, res)).catch(error => {
            console.error('Campora request failed', error.code || error.name);
            if (!res.headersSent) json(res, 500, { error: 'Campora could not complete the request. Try again.' });
            else res.end();
        });
    });
    server.on('close', () => db.close().catch(error => console.error('Campora database close failed', error.code || error.name)));
    return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const port = Number(process.env.PORT || 3000);
    if (process.argv[2] === '--preview') {
        const origin = 'http://localhost:' + port;
        (await createCamporaServer({
            databasePath: ':memory:',
            origin,
            preview: true,
            moderators: new Set(['admin@example.test']),
            sendCode: async (email, code) => console.log('Local preview code for ' + email + ': ' + code)
        })).listen(port, 'localhost', () => console.log('Campora preview at ' + origin + '/signin. Use any email for the main site or admin@example.test for administration.'));
    } else {
    const origin = new URL(process.env.CAMPORA_ORIGIN || 'http://localhost:' + port).origin;
    const apiKey = process.env.BREVO_API_KEY;
    const from = process.env.CAMPORA_EMAIL_FROM;
    if (Boolean(apiKey) !== Boolean(from)) {
        throw new Error('Set both BREVO_API_KEY and CAMPORA_EMAIL_FROM to enable email codes.');
    }
    if (!origin.startsWith('https://') && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) {
        throw new Error('Use an HTTPS CAMPORA_ORIGIN for deployment.');
    }
    const databaseUrl = process.env.SUPABASE_DATABASE_URL;
    if (!databaseUrl) throw new Error('Configure SUPABASE_DATABASE_URL. Production requires Supabase storage.');
    const turnKey = process.env.CAMPORA_TURN_KEY_ID;
    const turnToken = process.env.CAMPORA_TURN_API_TOKEN;
    if (Boolean(turnKey) !== Boolean(turnToken)) throw new Error('Set both Cloudflare TURN variables.');
    (await createCamporaServer({
        databaseUrl,
        origin,
        moderators: new Set((process.env.CAMPORA_MODERATORS || '').split(',').map(normalizeEmail).filter(Boolean)),
        iceServers: JSON.parse(process.env.CAMPORA_ICE_SERVERS || '[]'),
        getIceServers: turnKey ? createCloudflareIceProvider(turnKey, turnToken) : undefined,
        sendCode: apiKey ? createBrevoSender(apiKey, from) : undefined
    })).listen(port, process.env.CAMPORA_HOST || '127.0.0.1', () => console.log('Campora listening at ' + origin));
    }
}
