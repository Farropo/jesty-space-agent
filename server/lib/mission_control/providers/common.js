import { execFile } from "node:child_process";
import { promisify } from "node:util";

export const POWERSHELL_TIMEOUT_MS = 8000;
export const PROBE_TIMEOUT_MS = 1200;
export const execFileAsync = promisify(execFile);

export function nowIso() {
  return new Date().toISOString();
}

export function isWindows() {
  return process.platform === "win32";
}

export function normalizeArray(value) {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

export function providerResult(name, status, data = {}, reason = "") {
  return {
    available: status === "available",
    data,
    name,
    reason: String(reason || ""),
    status
  };
}

export async function runPowerShellJson(script, options = {}) {
  if (!isWindows()) {
    return null;
  }

  try {
    const result = await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        `${script} | ConvertTo-Json -Compress -Depth ${options.depth || 6}`
      ],
      {
        maxBuffer: options.maxBuffer || 8 * 1024 * 1024,
        timeout: options.timeoutMs || POWERSHELL_TIMEOUT_MS,
        windowsHide: true
      }
    );
    const text = String(result.stdout || "").trim();

    if (!text) {
      return [];
    }

    return JSON.parse(text);
  } catch (error) {
    return {
      __missionControlError: String(error?.message || error)
    };
  }
}

export function normalizePowerShellRows(value) {
  if (value && typeof value === "object" && value.__missionControlError) {
    throw new Error(value.__missionControlError);
  }

  return normalizeArray(value).filter(Boolean);
}

export function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
