import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const backend = new URL(process.argv[2] || 'http://localhost');
if (backend.protocol !== 'https:' || backend.username || backend.password ||
    backend.pathname !== '/' || backend.search || backend.hash) {
    throw new Error('Pass the HTTPS origin of your persistent Campora backend.');
}

// Deploy only this directory to Vercel. Campora's server and roster live on the backend.
const directory = new URL('./.vercel-edge/', import.meta.url);
mkdirSync(directory, { recursive: true });
const config = {
    $schema: 'https://openapi.vercel.sh/vercel.json',
    rewrites: [{ source: '/:path*', destination: backend.origin + '/:path*' }]
};
writeFileSync(new URL('vercel.json', directory), JSON.stringify(config, null, 2) + '\n');
console.log('Vercel deployment directory: ' + fileURLToPath(directory));
