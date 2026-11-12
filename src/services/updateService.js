import { buildApiError } from '../utils/apiError';

const PROXY_URL = '/api';

/**
 * @typedef {{ status: 'current', current: string, latest: string, checkedAt: string }
 *   | { status: 'available', current: string, latest: string, url: string, publishedAt: string | null, checkedAt: string }
 *   | { status: 'unavailable', current: string, reason: string, checkedAt: string }} UpdateStatus
 */

export const updateService = {
  /** @returns {Promise<UpdateStatus>} */
  async check({ refresh = false } = {}) {
    const response = await fetch(`${PROXY_URL}/settings/updates/check${refresh ? '?refresh=1' : ''}`, {
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw buildApiError(response, body);
    return body.data;
  },
};
