// Test helper (not a test): a configurable stand-in for the preview child, driven by argv[2] (the manager builds the
// child's environment from scratch, so it cannot carry the mode). Unless the mode says otherwise it does what the real
// child does first: applies the app-track migrations to APP_DATA_DIR/app.db (the real runner), then writes to the file.
// Modes: ok (listen, print APP_READY with the real port), apply-die (apply, then exit 1 before ready), eaddrinuse (exit 1
// with the port-in-use text on stderr, touches nothing), ready-str-port, ready-big-port, ready-garbage (print a bad ready
// line and stay up). Every mode ends when stdin ends.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { openDb } from '../../../db/index.js';
import { loadAppMigrations, migrateApp } from '../../../db/migrate.js';

const mode = process.argv[2] || 'ok';
process.stdin.resume();
process.stdin.on('end', () => process.exit(0));

function applyMigrations() {
  const filename = path.join(process.env.APP_DATA_DIR, 'app.db');
  fs.mkdirSync(process.env.APP_DATA_DIR, { recursive: true });
  const db = openDb({ filename, migrate: false });
  migrateApp(db, { migrations: loadAppMigrations({ mode: 'runtime', dir: process.env.APP_SPEC_MIGRATIONS_DIR, compiled: null }), filename });
  // A header write, like the real child's first writes: it fails on a read-only database file.
  db.exec('PRAGMA user_version = 1');
  db.close();
}

if (mode === 'eaddrinuse') {
  process.stderr.write('Error: listen EADDRINUSE: address already in use 127.0.0.1:4321\n');
  process.exit(1);
}
if (mode.startsWith('ready-')) {
  const payload = { 'ready-str-port': 'APP_READY {"port":"x"}', 'ready-big-port': 'APP_READY {"port":70000}', 'ready-garbage': 'APP_READY nonsense' }[mode];
  console.log(payload);
} else {
  applyMigrations();
  if (mode === 'apply-die') process.exit(1);
  const server = http.createServer((req, res) => res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}'));
  server.listen(0, '127.0.0.1', () => console.log(`APP_READY ${JSON.stringify({ port: server.address().port })}`));
}
