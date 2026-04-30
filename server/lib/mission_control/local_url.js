const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function normalizeLocalHostname(hostname) {
  const value = String(hostname || "").trim().toLowerCase();
  return value === "[::1]" ? "::1" : value;
}

export function isLocalHttpUrl(value) {
  try {
    const url = new URL(String(value || ""));
    const hostname = normalizeLocalHostname(url.hostname);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return false;
    }

    if (!LOCAL_HOSTS.has(hostname)) {
      return false;
    }

    if (url.port) {
      const port = Number(url.port);
      if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

export function normalizeLocalHttpUrl(value) {
  if (!isLocalHttpUrl(value)) {
    return "";
  }

  const url = new URL(String(value || ""));
  if (!url.pathname) {
    url.pathname = "/";
  }

  return url.toString();
}

export function assertLocalHttpUrl(value, label = "URL") {
  const normalized = normalizeLocalHttpUrl(value);

  if (!normalized) {
    const error = new Error(`${label} must be an http(s) localhost URL.`);
    error.statusCode = 400;
    throw error;
  }

  return normalized;
}
