// The preview child's launch secret and the cookie its desktop gate accepts. Same derivation as
// server/desktop/auth.js, kept separate on purpose: that module holds the parent's own gate state.
import crypto from 'node:crypto';

/** @returns {Buffer} 32 random bytes */
export const newSecret = () => crypto.randomBytes(32);

/** @param {Buffer} secret @returns {string} base64url(HMAC-SHA256(secret, 'desktop-cookie-v1')) */
export const cookieFor = (secret) => crypto.createHmac('sha256', secret).update('desktop-cookie-v1').digest('base64url');
