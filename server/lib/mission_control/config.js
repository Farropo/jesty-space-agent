import {
  createHttpError,
  readAppFile,
  writeAppFile
} from "../customware/file_access.js";
import { normalizeLocalHttpUrl } from "./local_url.js";

export const MISSION_CONTROL_CONFIG_PATH = "~/conf/mission-control.json";
export const MISSION_CONTROL_AUDIT_PATH = "~/hist/mission-control.jsonl";

const APP_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/u;
const SAFE_STOP_MODES = new Set(["tracked", "external"]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && !Buffer.isBuffer(value);
}

function normalizeString(value, maxLength = 2048) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function normalizeStringArray(value, maxItems = 64, maxLength = 2048) {
  return (Array.isArray(value) ? value : [])
    .map((entry) => String(entry ?? "").trim())
    .filter(Boolean)
    .slice(0, maxItems)
    .map((entry) => entry.slice(0, maxLength));
}

function normalizeEnv(value) {
  if (!isPlainObject(value)) {
    return {};
  }

  const output = {};

  for (const [key, rawEntry] of Object.entries(value)) {
    const normalizedKey = String(key || "").trim();

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(normalizedKey)) {
      continue;
    }

    output[normalizedKey] = String(rawEntry ?? "").slice(0, 4096);
  }

  return output;
}

function normalizeAppConfig(entry = {}) {
  if (!isPlainObject(entry)) {
    throw createHttpError("Each app entry must be an object.", 400);
  }

  const id = normalizeString(entry.id, 64);
  if (!APP_ID_PATTERN.test(id)) {
    throw createHttpError(`Invalid app id: ${id || "(empty)"}`, 400);
  }

  const executable = normalizeString(entry.executable);
  if (!executable) {
    throw createHttpError(`App ${id} is missing an executable.`, 400);
  }

  const stopMode = SAFE_STOP_MODES.has(String(entry.stopMode || "").trim())
    ? String(entry.stopMode || "").trim()
    : "tracked";

  return {
    args: normalizeStringArray(entry.args),
    cwd: normalizeString(entry.cwd),
    env: normalizeEnv(entry.env),
    executable,
    healthUrl: normalizeLocalHttpUrl(entry.healthUrl),
    id,
    label: normalizeString(entry.label, 160) || id,
    stopMode,
    tags: normalizeStringArray(entry.tags, 16, 64)
  };
}

export function getDefaultMissionControlConfig() {
  return {
    apps: [],
    modelPreferences: {
      fallbackModels: [
        "openai/gpt-oss-120b:free",
        "nvidia/nemotron-3-super-120b-a12b:free"
      ],
      provider: "openrouter",
      selectedModel: "qwen/qwen3-next-80b-a3b-instruct:free"
    },
    refreshIntervalMs: 5000,
    schema: "mission-control/v1",
    ui: {
      hiddenProviders: []
    }
  };
}

export function normalizeMissionControlConfig(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const defaultConfig = getDefaultMissionControlConfig();
  const apps = (Array.isArray(source.apps) ? source.apps : [])
    .map((entry) => normalizeAppConfig(entry));
  const appIds = new Set();

  for (const app of apps) {
    if (appIds.has(app.id)) {
      throw createHttpError(`Duplicate app id: ${app.id}`, 400);
    }

    appIds.add(app.id);
  }

  const refreshIntervalMs = Math.max(
    1500,
    Math.min(60000, Math.floor(Number(source.refreshIntervalMs) || defaultConfig.refreshIntervalMs))
  );
  const modelPreferences = isPlainObject(source.modelPreferences) ? source.modelPreferences : {};
  const fallbackModels = normalizeStringArray(modelPreferences.fallbackModels, 8, 160);

  return {
    apps,
    modelPreferences: {
      fallbackModels: fallbackModels.length
        ? fallbackModels
        : defaultConfig.modelPreferences.fallbackModels,
      provider: normalizeString(modelPreferences.provider, 80) || defaultConfig.modelPreferences.provider,
      selectedModel:
        normalizeString(modelPreferences.selectedModel, 160) ||
        defaultConfig.modelPreferences.selectedModel
    },
    refreshIntervalMs,
    schema: "mission-control/v1",
    ui: {
      hiddenProviders: normalizeStringArray(source.ui?.hiddenProviders, 32, 80)
    }
  };
}

function createFileOptions(context, path, extra = {}) {
  return {
    path,
    projectRoot: context.projectRoot,
    runtimeParams: context.runtimeParams,
    username: context.user?.username,
    watchdog: context.watchdog,
    ...extra
  };
}

export function readMissionControlConfig(context) {
  try {
    const result = readAppFile(createFileOptions(context, MISSION_CONTROL_CONFIG_PATH));
    const parsed = JSON.parse(String(result.content || "{}"));

    return {
      config: normalizeMissionControlConfig(parsed),
      path: result.path,
      source: "user"
    };
  } catch (error) {
    if (Number(error.statusCode) === 404) {
      return {
        config: getDefaultMissionControlConfig(),
        path: MISSION_CONTROL_CONFIG_PATH,
        source: "default"
      };
    }

    if (error instanceof SyntaxError) {
      throw createHttpError("Mission Control config is not valid JSON.", 400);
    }

    throw error;
  }
}

export function writeMissionControlConfig(context, input) {
  const config = normalizeMissionControlConfig(input);
  const result = writeAppFile(createFileOptions(context, MISSION_CONTROL_CONFIG_PATH, {
    content: `${JSON.stringify(config, null, 2)}\n`,
    encoding: "utf8"
  }));

  return {
    config,
    path: result.path,
    source: "user"
  };
}

export function appendMissionControlAudit(context, entry = {}) {
  const auditEntry = {
    ...entry,
    at: new Date().toISOString(),
    actor: context.user?.username || "unknown"
  };

  return writeAppFile(createFileOptions(context, MISSION_CONTROL_AUDIT_PATH, {
    content: `${JSON.stringify(auditEntry)}\n`,
    encoding: "utf8",
    operation: "append"
  }));
}

export function summarizeMissionControlConfig(config = {}) {
  const normalized = normalizeMissionControlConfig(config);

  return {
    appCount: normalized.apps.length,
    apps: normalized.apps.map((app) => ({
      healthUrl: app.healthUrl,
      id: app.id,
      label: app.label,
      stopMode: app.stopMode,
      tags: app.tags
    })),
    refreshIntervalMs: normalized.refreshIntervalMs
  };
}
