import { API_BASE_URL } from '../constants';

const TIMEOUT_MS = 15000;

export async function api(path, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE_URL}/${path}`, {
      ...opts,
      signal: controller.signal,
    });
    clearTimeout(timer);
    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { error: 'Invalid server response' };
    }
    return { ok: response.ok, data };
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      return { ok: false, data: { error: 'Connection timed out. Please check your internet connection.' } };
    }
    return { ok: false, data: { error: err.message || 'Network error. Please check your internet connection.' } };
  }
}
