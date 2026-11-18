import * as webpush from 'web-push';

export async function createPush(db, origin) {
    await db.exec(`CREATE TABLE IF NOT EXISTS push_subscriptions (
        endpoint TEXT PRIMARY KEY, owner TEXT NOT NULL, session_token TEXT NOT NULL,
        subscription TEXT NOT NULL
    )`);
    const publicKey = process.env.CAMPORA_PUSH_PUBLIC_KEY;
    const privateKey = process.env.CAMPORA_PUSH_PRIVATE_KEY;
    const ready = Boolean(publicKey && privateKey);
    if (ready) webpush.setVapidDetails('mailto:ajalaphilip2007@gmail.com', publicKey, privateKey);
    function validSubscription(value) {
        try {
            const url = new URL(value.endpoint);
            return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
                ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'].includes(url.hostname) &&
                typeof value.keys?.p256dh === 'string' && /^[A-Za-z0-9_-]{87}=?$/.test(value.keys.p256dh) &&
                typeof value.keys?.auth === 'string' && /^[A-Za-z0-9_-]{22}={0,2}$/.test(value.keys.auth) && value.endpoint.length < 2048;
        } catch { return false; }
    }
    async function api(method, path, member, token, input) {
        if (path !== '/api/push') return undefined;
        if (method === 'GET') return { data: { publicKey: ready ? publicKey : null } };
        if (method !== 'POST') return { status: 405, error: 'Method not allowed.' };
        if (input?.action === 'disable') {
            await db.prepare('DELETE FROM push_subscriptions WHERE owner = ? AND session_token = ?').run(member.id, token);
            return { data: { ok: true } };
        }
        if (!ready) return { status: 503, error: 'Phone notifications are being set up. Please try again later.' };
        if (!validSubscription(input?.subscription)) return { status: 400, error: 'This browser could not register phone notifications.' };
        const sub = input.subscription;
        await db.prepare(`INSERT INTO push_subscriptions VALUES (?, ?, ?, ?)
            ON CONFLICT(endpoint) DO UPDATE SET owner=excluded.owner, session_token=excluded.session_token, subscription=excluded.subscription`)
            .run(sub.endpoint, member.id, token, JSON.stringify(sub));
        return { data: { ok: true } };
    }
    let running = false;
    async function deliver() {
        if (!ready || running) return;
        running = true;
        try {
            await db.request(async () => {
                await db.prepare('DELETE FROM pending_push WHERE id IN (SELECT id FROM activity_notifications WHERE created < ?)').run(Date.now() - 3600000);
                const jobs = await db.prepare(`SELECT n.* FROM pending_push p JOIN activity_notifications n ON n.id=p.id ORDER BY n.created LIMIT 40`).all();
                for (const job of jobs) {
                    const denied = await db.prepare(`SELECT 1 WHERE EXISTS (SELECT 1 FROM disabled_accounts WHERE id IN (?, ?))
                        OR EXISTS (SELECT 1 FROM people_preferences WHERE kind='block' AND
                        ((owner=? AND target=?) OR (owner=? AND target=?)))`).get(job.recipient, job.actor, job.recipient, job.actor, job.actor, job.recipient);
                    const subscriptions = denied ? [] : await db.prepare(`SELECT p.* FROM push_subscriptions p JOIN sessions s ON s.token=p.session_token
                        WHERE p.owner=? AND s.expires>?`).all(job.recipient, Date.now());
                    const postEvent = ['like','comment','repost'].includes(job.kind);
                    const exists = !postEvent || await db.prepare('SELECT id FROM posts WHERE id=? AND id NOT IN (SELECT id FROM hidden_posts)').get(job.target);
                    if (exists) for (const sub of subscriptions) {
                        try {
                            // Keep account details off the lock screen. The app resolves the event after sign-in.
                            await webpush.sendNotification(JSON.parse(sub.subscription), JSON.stringify({
                                title: 'Campora', body: 'You have new activity on Campora.', tag: job.id, url: '/?notifications=1'
                            }), { TTL: 3600, timeout: 5000 });
                        } catch (error) {
                            if ([404,410].includes(error.statusCode)) await db.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').run(sub.endpoint);
                            else console.error('Phone notification failed', error.statusCode || error.code || error.name);
                        }
                    }
                    await db.prepare('DELETE FROM pending_push WHERE id=?').run(job.id);
                }
                await db.prepare('DELETE FROM push_subscriptions WHERE session_token NOT IN (SELECT token FROM sessions WHERE expires>?)').run(Date.now());
            });
        } catch (error) { console.error('Phone notification delivery failed', error.code || error.name); }
        finally { running = false; }
    }
    const timer = setInterval(deliver, 10000);
    timer.unref();
    return { api, stop: () => clearInterval(timer) };
}
