import { API_BASE_URL } from '../constants';

/**
 * Generic fetch wrapper matching the web version's api() helper.
 * Returns { ok: boolean, data: object }
 */
export async function api(path, opts = {}) {
  try {
    const response = await fetch(`${API_BASE_URL}/${path}`, opts);
    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { error: 'Invalid server response' };
    }
    return { ok: response.ok, data };
  } catch (err) {
    return { ok: false, data: { error: err.message || 'Network error' } };
  }
}
