# Campora

A student community for Anchor University.

## Try sign-in locally

Run `node server.mjs --preview` and open [Campora](http://localhost:3000/). Use any valid email, select **Create account**, and fill out the account form. For the [admin workspace](http://localhost:3000/admin), create an account with `admin@example.test` and enter the test code shown on the page. Preview runs on localhost and uses temporary data.

## Run with email authentication

Use Node.js 24 or newer and run `npm ci`. Regular users can currently create accounts without verifying their email. Production stores accounts, community data and uploaded media in Supabase PostgreSQL.

Set these environment variables, or put them in a local `.env` file:

| Variable | Value |
| --- | --- |
| `BREVO_API_KEY` | Brevo API key with transactional email access |
| `CAMPORA_EMAIL_FROM` | Sender email address configured in Brevo |
| `CAMPORA_ORIGIN` | Public HTTPS origin for deployment. Defaults to `http://localhost:3000` |
| `SUPABASE_DATABASE_URL` | Required. Supabase **Session pooler** connection string from the project’s Connect dialog |
| `SUPABASE_CA_CERT` | Optional. PEM certificate from Supabase if the host needs it to verify the database endpoint |
| `PORT` | Optional server port. Defaults to 3000 |
| `CAMPORA_HOST` | Optional bind address. Defaults to `127.0.0.1` |

Run `node --env-file-if-exists=.env server.mjs` and visit the configured origin. In production, forward the HTTPS origin to the Node server through your reverse proxy. Serve the app through this server so the feed and profile routes require a valid session.

Students sign in with their email and password. Moderator access and password recovery require email verification. Configure both Brevo variables to enable email codes. On startup, Campora creates its tables in the private `campora` schema. Credentials and the database connection string stay on the backend. The browser keeps the theme preference per account.

Reels display shared video posts. Stories expire after 24 hours.

Set `CAMPORA_MODERATORS` to a comma-separated list of email addresses authorized to administer Campora. These administrators can open **Admin workspace** from the menu or visit `/admin` to review reports, hide or restore posts, end broadcasts, and publish, edit or remove calendar events and opportunities. Listings are empty until published. Dates use the Lagos calendar day. Group rankings count memberships from signed-in community members.

Live video uses WebRTC over HTTPS or localhost with a camera and microphone. Each broadcast supports up to six viewers and ends if its host disconnects. Run a single server instance for live signaling. For viewers on different networks, configure `CAMPORA_ICE_SERVERS` as a JSON array of ICE server definitions with STUN and TURN. TURN credentials in this configuration are sent to signed-in students, so use credentials scoped to Campora. The app does not record broadcasts.

## Deploy with Vercel

Vercel serves the public HTTPS address and forwards requests to Campora's Node server. Run one Docker replica to keep WebRTC signaling available. PostgreSQL in Supabase persists the data across backend restarts. The backend requires no volume. [Vercel external rewrites](https://vercel.com/docs/routing/rewrites)

1. Create a Vercel project and choose its public hostname. The project's Vercel hostname can serve the site while you set up a separate sending domain.
2. Create a Supabase project. Under **Connect**, copy the **Session pooler** URI and substitute the database password. Save it as the backend’s private `SUPABASE_DATABASE_URL` variable. [Supabase connection options](https://supabase.com/docs/guides/database/connecting-to-postgres)
3. Register or use a domain you control for the sending address. Add Brevo's requested DNS records, verify the sender, and save `CAMPORA_EMAIL_FROM` and `BREVO_API_KEY` in the backend host's private variables. Personal email addresses can receive the signup code. [Brevo domain authentication](https://help.brevo.com/hc/en-us/articles/12163873383186-Authenticate-your-domain-with-Brevo-Brevo-code-DKIM-DMARC)
4. Deploy the included Dockerfile to one Railway replica and add an HTTPS public domain. Set `CAMPORA_ORIGIN` to the public **Vercel** origin and `CAMPORA_MODERATORS` to your administrator email addresses. For live video across networks, also set `CAMPORA_TURN_KEY_ID` and `CAMPORA_TURN_API_TOKEN`. [Cloudflare TURN setup](https://developers.cloudflare.com/realtime/turn/generate-credentials/)
5. Run `node prepare-vercel.mjs https://YOUR-BACKEND-HOST`. From the generated `.vercel-edge` directory, link the Vercel project with `npx vercel link` and deploy with `npx vercel --prod`. Check `/healthz` through the public Vercel address.

For the live signup test, create an account with your personal email at the public Vercel address, then sign out and sign back in with your password. To test Brevo, use the password reset flow or verify a new moderator account from `/admin`.
