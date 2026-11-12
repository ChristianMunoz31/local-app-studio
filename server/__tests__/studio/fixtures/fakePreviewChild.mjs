// Test helper (not a test): a stand-in for the preview child. Reads one stdin line (exit 2 unless 64 hex), derives the
// desktop cookie, listens on 127.0.0.1:0, prints APP_READY, and exits when stdin ends.
// The mode is argv[2] (the manager builds the child's environment from scratch, so it cannot carry the mode); argv[3]
// is a file that receives the secret line. Modes: no-ready (never prints), crash (exits 3 right away), crash-later
// (exits 3 shortly after ready), migration-failed (exits 4 right away, the preview child's migration failure code).
// records modes (sample seeding): argv[4] is a file that gets one JSON line per request ({ method, url, body }); argv[5] is
// a comma list of table ids. The child answers GET /api/data with those tables and POST /api/data/:table with 201 and a new
// id. `records` counts rows as they are posted, `records-rows` always reports 2 rows per table, `records-slow` waits 300 ms
// before each POST answer.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import readline from 'node:readline';

const mode = process.argv[2] || '';
const recordsMode = mode.startsWith('records');
const logFile = process.argv[4];
const tableIds = (process.argv[5] || '').split(',').filter(Boolean);
const posted = new Map();
let nextId = 1;
const rl = readline.createInterface({ input: process.stdin });
let started = false;
rl.on('line', (line) => {
  if (started) return;
  started = true;
  if (!/^[0-9a-f]{64}$/.test(line)) process.exit(2);
  if (process.argv[3]) fs.writeFileSync(process.argv[3], line);
  if (mode === 'crash') process.exit(3);
  if (mode === 'migration-failed') process.exit(4);
  const cookie = crypto.createHmac('sha256', Buffer.from(line, 'hex')).update('desktop-cookie-v1').digest('base64url');
  const server = http.createServer((req, res) => {
    if (req.headers.cookie !== `app_desktop=${cookie}`) {
      res.writeHead(401, { 'content-type': 'application/json' }).end('{"error":"desktop_auth_required"}');
      return;
    }
    const route = req.url.split('?')[0];
    if (route === '/api/data/slow') return;
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (recordsMode) {
        const text = Buffer.concat(chunks).toString('utf8');
        if (logFile) fs.appendFileSync(logFile, `${JSON.stringify({ method: req.method, url: req.url, body: text === '' ? null : JSON.parse(text) })}
`);
        if (req.method === 'GET' && route === '/api/data') {
          const tables = tableIds.map((id) => ({ id, label: id, rowCount: mode === 'records-rows' ? 2 : (posted.get(id) ?? 0) }));
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: { tables } }));
          return;
        }
        const m = /^\/api\/data\/([a-z0-9_]+)$/.exec(route);
        if (req.method === 'POST' && m) {
          const answer = () => {
            posted.set(m[1], (posted.get(m[1]) ?? 0) + 1);
            res.writeHead(201, { 'content-type': 'application/json' }).end(JSON.stringify({ data: { id: `${m[1]}-${nextId++}` } }));
          };
          if (mode === 'records-slow') setTimeout(answer, 300);
          else answer();
          return;
        }
      }
      if (route === '/api/data/echo') {
        const body = Buffer.concat(chunks).toString('utf8');
        res
          .writeHead(201, { 'content-type': 'application/json', 'set-cookie': 'x=1', 'content-security-policy': "default-src 'none'" })
          .end(JSON.stringify({ method: req.method, url: req.url, headers: req.headers, body }));
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"not_found"}');
    });
  });
  server.listen(0, '127.0.0.1', () => {
    if (mode !== 'no-ready') console.log(`APP_READY ${JSON.stringify({ port: server.address().port })}`);
    if (mode === 'crash-later') setTimeout(() => process.exit(3), 300);
  });
});
rl.on('close', () => process.exit(0));
