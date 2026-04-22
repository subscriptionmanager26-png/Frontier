import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const PORT = Number(process.env.RELAY_PORT || 8787);
const DB_FILE = process.env.RELAY_DB_FILE || './relay-db.json';

/** @type {{ emissions: Array<{ taskId: string; userId: string; sequence_num: number; event_type: string; payload: any; delivered_at: string | null; created_at: string }> }} */
let db = { emissions: [] };

async function loadDb() {
  if (!existsSync(DB_FILE)) return;
  try {
    db = JSON.parse(await readFile(DB_FILE, 'utf8'));
  } catch {
    db = { emissions: [] };
  }
}

async function persistDb() {
  await writeFile(DB_FILE, JSON.stringify(db), 'utf8');
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function parseReqBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function resolveUserId(req) {
  return String(req.headers.authorization || 'anonymous');
}

function eventType(event) {
  const t = String(event?.type || '').toLowerCase();
  return t.includes('artifact') ? 'artifact' : 'status';
}

function sequenceOf(event) {
  const n = Number(event?.metadata?.sequenceNumber);
  return Number.isFinite(n) ? n : Date.now();
}

async function main() {
  await loadDb();
  createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'POST' && url.pathname === '/webhook/a2a') {
      try {
        const event = await parseReqBody(req);
        const taskId = String(event?.taskId || event?.id || '').trim();
        if (!taskId) return json(res, 400, { error: 'taskId is required' });
        const seq = sequenceOf(event);
        const exists = db.emissions.some((e) => e.taskId === taskId && e.sequence_num === seq);
        if (!exists) {
          db.emissions.push({
            taskId,
            userId: resolveUserId(req),
            sequence_num: seq,
            event_type: eventType(event),
            payload: event,
            delivered_at: null,
            created_at: new Date().toISOString(),
          });
          await persistDb();
        }
        return json(res, 202, { accepted: true });
      } catch (e) {
        return json(res, 400, { error: 'bad_request', message: String(e) });
      }
    }
    if (req.method === 'GET' && url.pathname === '/emissions') {
      const taskId = String(url.searchParams.get('taskId') || '').trim();
      const since = Number(url.searchParams.get('since') || '0');
      if (!taskId) return json(res, 400, { error: 'taskId is required' });
      const events = db.emissions
        .filter((e) => e.taskId === taskId && e.sequence_num > since)
        .sort((a, b) => a.sequence_num - b.sequence_num)
        .map((e) => e.payload);
      return json(res, 200, { events });
    }
    if (req.method === 'GET' && url.pathname === '/health') {
      return json(res, 200, { ok: true, emissions: db.emissions.length });
    }
    return json(res, 404, { error: 'not_found' });
  }).listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[relay] listening on http://localhost:${PORT}`);
  });
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('[relay] fatal', e);
  process.exit(1);
});

