const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { URL } = require('url');
const { DairyStore, getTodayIsoDate } = require('./src/store');
const { calculateEntryPricing, summarizeEntries } = require('./src/pricing');

const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const MAX_BYTES = 1024 * 1024; // 1 MB

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BYTES) {
        reject(new Error('Request body too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON request body.'));
      }
    });

    req.on('error', reject);
  });
}

async function serveStaticFile(reqPath, res) {
  const safePath = reqPath === '/' ? '/index.html' : reqPath;
  const resolved = path.resolve(PUBLIC_DIR, `.${safePath}`);

  if (!resolved.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    const stat = await fsp.stat(resolved);
    if (!stat.isFile()) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    const ext = path.extname(resolved).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const content = await fsp.readFile(resolved);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not Found');
  }
}

function createServer(store = new DairyStore()) {
  return http.createServer(async (req, res) => {
    try {
      const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const pathname = parsedUrl.pathname;
      const method = req.method.toUpperCase();

      if (!pathname.startsWith('/api/')) {
        if (method === 'GET' || method === 'HEAD') {
          await serveStaticFile(pathname, res);
        } else {
          sendJson(res, 405, { error: 'Method not allowed' });
        }
        return;
      }

      if (pathname === '/api/health' && method === 'GET') {
        sendJson(res, 200, { ok: true, today: getTodayIsoDate() });
        return;
      }

      if (pathname === '/api/farmers' && method === 'GET') {
        const farmers = await store.listFarmers();
        sendJson(res, 200, { farmers });
        return;
      }

      if (pathname === '/api/rate-card' && method === 'GET') {
        const rateCard = await store.getRateCard();
        sendJson(res, 200, rateCard);
        return;
      }

      if (pathname === '/api/rate-card' && method === 'PUT') {
        const body = await readJsonBody(req);
        const updated = await store.updateRateCard(body);
        sendJson(res, 200, updated);
        return;
      }

      if (pathname === '/api/rate-card/reset' && method === 'POST') {
        const reset = await store.resetRateCard();
        sendJson(res, 200, reset);
        return;
      }

      if (pathname === '/api/calculate' && method === 'POST') {
        const body = await readJsonBody(req);
        const rateCard = await store.getRateCard();
        const pricing = calculateEntryPricing(rateCard, body);
        sendJson(res, 200, pricing);
        return;
      }

      if (pathname === '/api/entries' && method === 'GET') {
        const date = parsedUrl.searchParams.get('date') || undefined;
        const farmerId = parsedUrl.searchParams.get('farmerId') || undefined;
        const from = parsedUrl.searchParams.get('from') || undefined;
        const to = parsedUrl.searchParams.get('to') || undefined;
        const entries = await store.listEntries({ date, farmerId, from, to });
        const summary = summarizeEntries(entries);
        sendJson(res, 200, { entries, summary });
        return;
      }

      if (pathname === '/api/entries' && method === 'POST') {
        const body = await readJsonBody(req);
        const created = await store.addEntry(body);
        sendJson(res, 201, { entry: created });
        return;
      }

      if (pathname.startsWith('/api/entries/') && method === 'DELETE') {
        const id = decodeURIComponent(pathname.slice('/api/entries/'.length));
        if (!id) {
          sendJson(res, 400, { error: 'Entry ID is required.' });
          return;
        }
        const deleted = await store.deleteEntry(id);
        if (!deleted) {
          sendJson(res, 404, { error: 'Entry not found.' });
          return;
        }
        sendJson(res, 200, { deleted: true, id });
        return;
      }

      if (pathname === '/api/summary' && method === 'GET') {
        const date = parsedUrl.searchParams.get('date') || getTodayIsoDate();
        const entries = await store.listEntries({ date });
        const summary = summarizeEntries(entries);
        sendJson(res, 200, { date, summary, entries });
        return;
      }

      if (pathname === '/api/payout-slip' && method === 'GET') {
        const entryId = parsedUrl.searchParams.get('entryId');
        const farmerId = parsedUrl.searchParams.get('farmerId');
        const from = parsedUrl.searchParams.get('from') || undefined;
        const to = parsedUrl.searchParams.get('to') || undefined;

        let items = [];
        if (entryId) {
          const single = await store.getEntryById(entryId);
          if (!single) {
            sendJson(res, 404, { error: 'Entry not found for payout slip.' });
            return;
          }
          items = [single];
        } else if (farmerId) {
          items = await store.listEntries({ farmerId, from, to });
          if (items.length === 0) {
            sendJson(res, 404, { error: 'No milk entries found for this farmer in the selected period.' });
            return;
          }
        } else {
          sendJson(res, 400, { error: 'Provide either entryId or farmerId to generate a payout slip.' });
          return;
        }

        const sortedItems = [...items].sort((a, b) => a.date.localeCompare(b.date));
        const summary = summarizeEntries(sortedItems);
        const first = sortedItems[0];
        const last = sortedItems[sortedItems.length - 1];

        sendJson(res, 200, {
          slipNumber: `SLIP-${Date.now().toString(36).toUpperCase()}`,
          generatedAt: new Date().toISOString(),
          farmerId: first.farmerId,
          farmerName: first.farmerName,
          periodFrom: from || first.date,
          periodTo: to || last.date,
          items: sortedItems,
          summary
        });
        return;
      }

      sendJson(res, 404, { error: 'API route not found.' });
    } catch (err) {
      const status = err.message && (
        err.message.includes('Invalid') ||
        err.message.includes('required') ||
        err.message.includes('must be') ||
        err.message.includes('cannot be empty')
      ) ? 400 : 500;
      sendJson(res, status, { error: err.message || 'Internal server error' });
    }
  });
}

if (require.main === module) {
  const PORT = Number(process.env.PORT) || 3000;
  const store = new DairyStore();
  const server = createServer(store);
  server.listen(PORT, () => {
    console.log(`Dairy Milk Collection server running at http://localhost:${PORT}`);
  });
}

module.exports = { createServer };
