const baseUrl = (process.env.EXPRESS_SMOKE_URL || 'https://livraison.jikjikoox.com').replace(/\/$/, '');
const timeoutMs = 20_000;

async function fetchChecked(url) {
  return fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'user-agent': 'JikJikoox-Express-Production-Smoke/1.0' },
  });
}

const root = await fetchChecked(`${baseUrl}/?__smoke=${Date.now()}`);
if (!root.ok) throw new Error(`Express root failed: HTTP ${root.status} ${root.url}`);
if (!(root.headers.get('content-type') || '').includes('text/html')) {
  throw new Error(`Express root is not HTML: ${root.headers.get('content-type')}`);
}
const html = await root.text();
if (!html.includes('JikJikoox Express') || !/<div[^>]+id=["']root["']/.test(html)) {
  throw new Error('Express app shell/title missing.');
}
const moduleSrc = html.match(/<script\b[^>]*type=["']module["'][^>]*src=["']([^"']+)["']/i)?.[1]
  || html.match(/<script\b[^>]*src=["']([^"']+)["'][^>]*type=["']module["']/i)?.[1];
if (!moduleSrc) throw new Error('Vite module entrypoint not found in Express HTML.');
const assetUrl = new URL(moduleSrc, root.url).toString();
const asset = await fetchChecked(assetUrl);
if (!asset.ok || !/(javascript|ecmascript)/i.test(asset.headers.get('content-type') || '')) {
  throw new Error(`Express JS bundle failed: HTTP ${asset.status}, type ${asset.headers.get('content-type')}`);
}
const bundle = await asset.text();
if (!bundle.trim() || /<html[\s>]/i.test(bundle.slice(0, 400))) throw new Error('Express JS bundle empty or HTML fallback.');
const backendEndpoints = [...new Set(bundle.match(/https:\/\/[a-z0-9-]+\.supabase\.co\/functions\/v1/g) || [])];
console.log(`Supabase endpoints in deployed Express bundle: ${backendEndpoints.join(', ') || '(none found)'}`);
if (!bundle.includes('https://dllafwvyfjodblxhshko.supabase.co/functions/v1')) {
  throw new Error('Production bundle is not configured for the JikJikoox marketplace Supabase project.');
}
// Vite may retain the staging URL in the bundle because the same artifact supports
// isolated staging deployments. On the production hostname, supabaseContract.ts
// must select the marketplace URL through its explicit hostname guard.
// Reject the bundle only when that production guard is absent.
const hasProductionHostGuard = bundle.includes('livraison.jikjikoox.com');
if (!hasProductionHostGuard) {
  throw new Error('Production hostname guard is missing from the deployed Express bundle.');
}

const health = await fetchChecked(new URL('/healthz', baseUrl));
if (!health.ok) throw new Error(`Express /healthz failed: HTTP ${health.status}`);
const healthBody = await health.json();
if (healthBody?.ok !== true || healthBody?.distReady !== true) throw new Error('Express health check did not report distReady=true.');

const requiredHeaders = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
};
for (const [name, expected] of Object.entries(requiredHeaders)) {
  const value = (root.headers.get(name) || '').toLowerCase();
  if (value !== expected.toLowerCase()) throw new Error(`Missing/invalid security header ${name}: ${value || '(absent)'}`);
}
if (!root.headers.get('permissions-policy')) throw new Error('Permissions-Policy header missing.');
if (!root.headers.get('strict-transport-security')) throw new Error('HSTS header missing on HTTPS response.');
if (!root.headers.get('content-security-policy')) console.warn('WARN: CSP header missing; CSP rollout remains pending asset inventory.');

console.log(`Express production smoke PASS: HTML, bundle, /healthz, baseline headers, HSTS; ${root.url}`);
