// Desktop-mode config rules: port 0 only in desktop mode, loopback-only bind, same-origin CORS.
import { describe, it, expect } from 'vitest';
import { checkStartupSecurity, resolveAllowedOrigins, resolveListenConfig, DEFAULT_PORT } from '../config.js';

const DESKTOP = { APP_DESKTOP: '1', APP_HOST: '127.0.0.1', APP_PORT: '0' };

describe('resolveListenConfig port 0', () => {
  it('is accepted in desktop mode', () => {
    expect(resolveListenConfig(DESKTOP)).toEqual({ host: '127.0.0.1', port: 0 });
  });

  it('falls back to the default port outside desktop mode', () => {
    expect(resolveListenConfig({ APP_PORT: '0' }).port).toBe(DEFAULT_PORT);
    expect(resolveListenConfig({ APP_DESKTOP: '0', APP_PORT: '0' }).port).toBe(DEFAULT_PORT);
  });

  it('still rejects out-of-range ports in desktop mode', () => {
    expect(resolveListenConfig({ ...DESKTOP, APP_PORT: '65536' }).port).toBe(DEFAULT_PORT);
  });
});

describe('checkStartupSecurity in desktop mode', () => {
  it('passes for a loopback bind with no password configured', () => {
    expect(checkStartupSecurity(DESKTOP)).toEqual({ ok: true, errors: [], warnings: [] });
  });

  it('ignores APP_PASSWORD with a short AUTH_SECRET', () => {
    expect(checkStartupSecurity({ ...DESKTOP, APP_PASSWORD: 'x', AUTH_SECRET: 'short' }).ok).toBe(true);
  });

  it.each(['0.0.0.0', '192.168.1.5', '::'])('refuses a non-loopback host %s, even with the LAN override', (host) => {
    const res = checkStartupSecurity({ ...DESKTOP, APP_HOST: host, APP_ALLOW_INSECURE_LAN: '1' });
    expect(res.ok).toBe(false);
    expect(res.errors).toHaveLength(1);
  });
});

describe('resolveAllowedOrigins in desktop mode', () => {
  it('is empty (same-origin only), even when ALLOWED_ORIGINS is set', () => {
    expect(resolveAllowedOrigins(DESKTOP)).toEqual([]);
    expect(resolveAllowedOrigins({ ...DESKTOP, ALLOWED_ORIGINS: 'http://evil.example' })).toEqual([]);
  });
});
