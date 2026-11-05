const SESSION_KEY = 'skybook.session';
const expiryListeners = new Set();

export class ApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function loadSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}

export const saveSession = (session) => localStorage.setItem(SESSION_KEY, JSON.stringify(session));
export const clearSession = () => localStorage.removeItem(SESSION_KEY);

export function onSessionExpired(listener) {
  expiryListeners.add(listener);
  return () => expiryListeners.delete(listener);
}

async function send(path, { method = 'GET', body, headers = {} }) {
  const token = loadSession()?.token;
  return fetch(`/api${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

export async function api(path, options = {}) {
  let response;
  try {
    response = await send(path, options);
  } catch {
    throw new ApiError(0, 'Không kết nối được máy chủ, vui lòng thử lại');
  }

  const payload = await response.json().catch(() => ({}));
  if (response.ok) return payload;

  if (response.status === 401 && !path.startsWith('/auth/')) {
    expiryListeners.forEach((listener) => listener());
  }
  if (response.status === 429) {
    throw new ApiError(429, 'Bạn thao tác quá nhanh, vui lòng thử lại sau');
  }
  if (response.status === 503) {
    throw new ApiError(503, payload.message ?? 'Dịch vụ tạm thời gián đoạn, vui lòng thử lại');
  }
  throw new ApiError(response.status, payload.message ?? 'Có lỗi xảy ra', payload.code);
}
