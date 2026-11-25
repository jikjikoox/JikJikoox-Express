import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const distDir = path.join(__dirname, 'dist');
const indexHtmlPath = path.join(distDir, 'index.html');
const port = Number(process.env.PORT) || 3000;

const app = express();
app.disable('x-powered-by');

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.get('/healthz', (_req, res) => {
  res.status(200).json({ ok: true, service: 'jikjikoox-express' });
});

app.use(
  express.static(distDir, {
    index: 'index.html',
    setHeaders(res, filePath) {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache');
      } else {
        res.setHeader('Cache-Control', 'public, max-age=86400');
      }
    },
  })
);

app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    next();
    return;
  }
  if (!fs.existsSync(indexHtmlPath)) {
    res
      .status(503)
      .type('text/plain')
      .send('Build frontend introuvable (dist/index.html). Exécutez "npm run build".');
    return;
  }
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(indexHtmlPath);
});

app.listen(port, '0.0.0.0', () => {
  console.log(`JikJikoox Express listening on port ${port}`);
});
