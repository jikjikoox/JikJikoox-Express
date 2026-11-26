import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const distDir = path.resolve(__dirname, 'dist');
const indexHtmlPath = path.join(distDir, 'index.html');
const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT) || 3000;

const COMPRESSIBLE_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'application/javascript; charset=utf-8'],
  ['.mjs', 'application/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.xml', 'application/xml; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
]);

const BINARY_TYPES = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
  ['.ico', 'image/x-icon'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.ttf', 'font/ttf'],
]);

const MAX_CACHEABLE_BYTES = 10 * 1024 * 1024;
const compressedCache = new Map();

function getCacheControlForFile(filePath) {
  const rel = path.relative(distDir, filePath).split(path.sep).join('/');
  if (rel.endsWith('.html')) {
    return 'no-cache';
  }
  if (/^assets\/[^/]+-[A-Za-z0-9_-]{6,}\.(js|mjs|css|woff2?)$/.test(rel)) {
    return 'public, max-age=31536000, immutable';
  }
  if (rel === 'robots.txt' || rel === 'sitemap.xml' || rel === 'llms.txt') {
    return 'public, max-age=3600';
  }
  return 'public, max-age=604800';
}

function getCompressedEntry(filePath, contentType) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size > MAX_CACHEABLE_BYTES) {
    return null;
  }

  const cached = compressedCache.get(filePath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached;
  }

  const raw = fs.readFileSync(filePath);
  const br = zlib.brotliCompressSync(raw, {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 },
  });
  const gzip = zlib.gzipSync(raw, { level: 6 });

  const entry = {
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    contentType,
    cacheControl: getCacheControlForFile(filePath),
    raw,
    br,
    gzip,
  };
  compressedCache.set(filePath, entry);
  return entry;
}

function sendCompressedEntry(req, res, entry) {
  const acceptEncoding = String(req.headers['accept-encoding'] || '');
  res.setHeader('Content-Type', entry.contentType);
  res.setHeader('Cache-Control', entry.cacheControl);
  res.setHeader('Vary', 'Accept-Encoding');

  let payload = entry.raw;
  if (acceptEncoding.includes('br')) {
    res.setHeader('Content-Encoding', 'br');
    payload = entry.br;
  } else if (acceptEncoding.includes('gzip')) {
    res.setHeader('Content-Encoding', 'gzip');
    payload = entry.gzip;
  }

  res.setHeader('Content-Length', String(payload.length));
  if (req.method === 'HEAD') {
    res.status(200).end();
    return;
  }
  res.status(200).send(payload);
}

async function sendBinaryFile(req, res, filePath, contentType) {
  const stat = await fs.promises.stat(filePath);
  if (!stat.isFile() || stat.size > MAX_CACHEABLE_BYTES) {
    return false;
  }

  const buffer = await fs.promises.readFile(filePath);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', getCacheControlForFile(filePath));
  res.setHeader('Content-Length', String(buffer.length));
  if (req.method === 'HEAD') {
    res.status(200).end();
    return true;
  }
  res.status(200).send(buffer);
  return true;
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  // GPS and QR scanner are needed by courier app; permissions are limited to this origin.
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(self)');
  next();
});

app.get('/healthz', (_req, res) => {
  const distReady = fs.existsSync(indexHtmlPath);
  res.status(distReady ? 200 : 503).json({
    ok: distReady,
    service: 'jikjikoox-express',
    distReady,
  });
});

// Direct Buffer-based static file handler (avoids Express 5 send/stream 503 issues on Hostinger LiteSpeed)
app.use(async (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    next();
    return;
  }

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(req.path);
  } catch {
    res.status(400).type('text/plain; charset=utf-8').send('Bad Request');
    return;
  }

  const relPath = decodedPath.replace(/^\/+/, '') || 'index.html';
  const resolvedPath = path.resolve(distDir, relPath);
  if (resolvedPath !== distDir && !resolvedPath.startsWith(distDir + path.sep)) {
    next();
    return;
  }

  if (!fs.existsSync(resolvedPath)) {
    next();
    return;
  }

  const ext = path.extname(relPath).toLowerCase();
  const compressibleType = COMPRESSIBLE_TYPES.get(ext);
  if (compressibleType) {
    try {
      const entry = getCompressedEntry(resolvedPath, compressibleType);
      if (entry) {
        sendCompressedEntry(req, res, entry);
        return;
      }
    } catch (err) {
      next(err);
      return;
    }
  }

  const binaryType = BINARY_TYPES.get(ext);
  if (binaryType) {
    try {
      const sent = await sendBinaryFile(req, res, resolvedPath, binaryType);
      if (sent) {
        return;
      }
    } catch (err) {
      next(err);
      return;
    }
  }

  next();
});

// SPA fallback for client routes (Buffer-based response, never uses res.sendFile stream)
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(404).json({ error: 'Not Found' });
    return;
  }
  if (req.path.startsWith('/api/')) {
    res.status(404).json({ error: 'Not Found' });
    return;
  }
  if (!fs.existsSync(indexHtmlPath)) {
    res
      .status(503)
      .type('text/plain; charset=utf-8')
      .send('Application build unavailable.');
    return;
  }

  try {
    const entry = getCompressedEntry(indexHtmlPath, 'text/html; charset=utf-8');
    if (entry) {
      sendCompressedEntry(req, res, entry);
      return;
    }
    const rawHtml = fs.readFileSync(indexHtmlPath);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Content-Length', String(rawHtml.length));
    if (req.method === 'HEAD') {
      res.status(200).end();
      return;
    }
    res.status(200).send(rawHtml);
  } catch (err) {
    next(err);
  }
});

// Safe production error handler (no stack-trace leakage)
app.use((err, _req, res, _next) => {
  console.error('[JikJikoox Express] Unhandled server error:', err?.message || err);
  if (res.headersSent) {
    return;
  }
  res.status(500).type('text/plain; charset=utf-8').send('Internal Server Error');
});

const server = app.listen(port, host, () => {
  console.log(
    `JikJikoox Express listening on http://${host}:${port} (distReady=${fs.existsSync(indexHtmlPath)})`
  );
});

server.on('error', (err) => {
  console.error('[JikJikoox Express] Server listen error:', err?.message || err);
  process.exitCode = 1;
});

function shutdown(signal) {
  console.log(`[JikJikoox Express] Received ${signal}, shutting down gracefully...`);
  server.close(() => {
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default app;
