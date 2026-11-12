// Child process for processGuards.test.js: a plain http server with the real log and guard modules installed.
// Env: GUARD_DATA_DIR (log folder), GUARD_TX=1 (getDb reports an open transaction). Prints `READY <port>`.
import http from 'node:http';
import { configureLog, requestContext, tail } from '../../log.js';
import { installProcessGuards } from '../../processGuards.js';

configureLog({ dataDir: process.env.GUARD_DATA_DIR, role: 'studio' });
const middleware = requestContext();
const server = http.createServer((req, res) => {
  middleware(req, res, () => {
    if (req.url === '/ping') {
      res.end('pong');
    } else if (req.url === '/throw') {
      setTimeout(() => {
        throw new Error('boom');
      }, 5);
    } else if (req.url === '/reject') {
      Promise.reject(new Error('rejected'));
      setTimeout(() => {
        if (!res.writableEnded) res.end('after');
      }, 50);
    } else if (req.url === '/log') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(tail({ limit: 50 })));
    }
    // any other path (for example /hang) stays open on purpose
  });
});

installProcessGuards({
  role: 'studio',
  getDb: () => ({ isTransaction: process.env.GUARD_TX === '1' }),
  stop: () =>
    new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    }),
});
server.listen(0, '127.0.0.1', () => {
  process.stdout.write(`READY ${server.address().port}\n`);
});
