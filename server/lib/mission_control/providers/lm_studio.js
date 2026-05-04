import os from "node:os";
import path from "node:path";

import { createHttpError } from "../../customware/file_access.js";
import {
  execFileAsync,
  providerResult,
  toNumber
} from "./common.js";

const LM_STUDIO_PORT = 1234;
const LM_STUDIO_BASE_URL = `http://127.0.0.1:${LM_STUDIO_PORT}`;
const LM_STUDIO_NATIVE_MODELS_URL = `${LM_STUDIO_BASE_URL}/api/v1/models`;
const LM_STUDIO_COMPAT_MODELS_URL = `${LM_STUDIO_BASE_URL}/v1/models`;
const LM_STUDIO_LOAD_URL = `${LM_STUDIO_BASE_URL}/api/v1/models/load`;

function normalizeString(value, maxLength = 512) {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizeModelInstances(value) {
  return (Array.isArray(value) ? value : [])
    .map((entry) => ({
      id: normalizeString(entry?.id || entry?.instance_id || entry?.instanceId, 240),
      config: entry?.config && typeof entry.config === "object" ? entry.config : {}
    }))
    .filter((entry) => entry.id);
}

function normalizeQuantization(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  return {
    bitsPerWeight: toNumber(value.bits_per_weight || value.bits, null),
    name: normalizeString(value.name, 80)
  };
}

function parseNativeLmStudioModels(payload) {
  const models = Array.isArray(payload?.models) ? payload.models : [];

  return models
    .map((model) => {
      const id = normalizeString(model?.key || model?.modelKey || model?.id, 240);
      const loadedInstances = normalizeModelInstances(model?.loaded_instances || model?.loadedInstances);

      return {
        architecture: normalizeString(model?.architecture, 80),
        displayName: normalizeString(model?.display_name || model?.displayName || id, 240),
        format: normalizeString(model?.format, 40),
        id,
        key: id,
        loadable: Boolean(id),
        loaded: loadedInstances.length > 0,
        loadedInstances,
        maxContextLength: toNumber(model?.max_context_length || model?.maxContextLength, 0),
        object: "model",
        ownedBy: normalizeString(model?.publisher, 120),
        paramsString: normalizeString(model?.params_string || model?.paramsString, 80),
        publisher: normalizeString(model?.publisher, 120),
        quantization: normalizeQuantization(model?.quantization),
        selectedVariant: normalizeString(model?.selected_variant || model?.selectedVariant, 240),
        sizeBytes: toNumber(model?.size_bytes || model?.sizeBytes, 0),
        source: "native",
        type: normalizeString(model?.type, 40),
        variants: (Array.isArray(model?.variants) ? model.variants : [])
          .map((entry) => normalizeString(entry, 240))
          .filter(Boolean)
      };
    })
    .filter((model) => model.id);
}

function parseOpenAiCompatibleModels(payload) {
  const models = Array.isArray(payload?.data) ? payload.data : [];

  return models
    .map((model) => {
      const id = normalizeString(model?.id, 240);

      return {
        displayName: id,
        id,
        key: id,
        loadable: false,
        loaded: true,
        loadedInstances: id ? [{ id, config: {} }] : [],
        object: normalizeString(model?.object, 80),
        ownedBy: normalizeString(model?.owned_by || model?.ownedBy, 120),
        source: "openai-compatible",
        type: "model"
      };
    })
    .filter((model) => model.id);
}

export function parseLmStudioModels(payload) {
  if (Array.isArray(payload?.models)) {
    return parseNativeLmStudioModels(payload);
  }

  return parseOpenAiCompatibleModels(payload);
}

async function fetchJson(url, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 1500);

  try {
    const response = await fetchImpl(url, {
      body: options.body ? JSON.stringify(options.body) : undefined,
      headers: {
        accept: "application/json",
        ...(options.body ? { "content-type": "application/json" } : {}),
        "user-agent": "Space-Agent-Mission-Control"
      },
      method: options.method || "GET",
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message = normalizeString(payload?.error || payload?.message || response.statusText || `HTTP ${response.status}`, 240);
      throw new Error(message);
    }

    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function lmsCandidates() {
  const executableName = process.platform === "win32" ? "lms.exe" : "lms";
  return [
    path.join(os.homedir(), ".lmstudio", "bin", executableName),
    executableName,
    "lms"
  ].filter((entry, index, entries) => entry && entries.indexOf(entry) === index);
}

async function runLmsCommand(args, options = {}) {
  const runner = options.runner || execFileAsync;
  const candidates = options.lmsPath ? [options.lmsPath] : lmsCandidates();
  const errors = [];

  for (const candidate of candidates) {
    try {
      const result = await runner(candidate, args, {
        maxBuffer: 1024 * 1024,
        timeout: options.timeoutMs || 20000,
        windowsHide: true
      });

      return {
        command: candidate,
        stderr: normalizeString(result.stderr, 2000),
        stdout: normalizeString(result.stdout, 2000)
      };
    } catch (error) {
      if (error?.code === "ENOENT") {
        errors.push(error.message);
        continue;
      }

      throw createHttpError(`LM Studio CLI failed: ${error.message}`, 502, error);
    }
  }

  throw createHttpError("LM Studio CLI `lms` was not found.", 404, new Error(errors.join("; ")));
}

async function isNativeServerAvailable(options = {}) {
  try {
    await fetchJson(LM_STUDIO_NATIVE_MODELS_URL, {
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs || 1200
    });
    return true;
  } catch {
    return false;
  }
}

async function waitForNativeServer(options = {}) {
  const deadline = Date.now() + (options.timeoutMs || 6000);

  while (Date.now() < deadline) {
    if (await isNativeServerAvailable(options)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }

  return false;
}

export async function startLmStudioServer(options = {}) {
  if (await isNativeServerAvailable(options)) {
    return {
      port: LM_STUDIO_PORT,
      status: "already_running"
    };
  }

  const command = await runLmsCommand(["server", "start", "--port", String(LM_STUDIO_PORT)], options);
  const available = await waitForNativeServer(options);

  return {
    command: path.basename(command.command),
    port: LM_STUDIO_PORT,
    status: available ? "started" : "started_pending",
    stderr: command.stderr,
    stdout: command.stdout
  };
}

export async function loadLmStudioModel(modelId, options = {}) {
  const model = normalizeString(modelId, 240);

  if (!model) {
    throw createHttpError("LM Studio model id is required.", 400);
  }

  if (!(await isNativeServerAvailable(options))) {
    throw createHttpError("LM Studio server is not running on port 1234.", 409);
  }

  const result = await fetchJson(LM_STUDIO_LOAD_URL, {
    body: {
      echo_load_config: true,
      model
    },
    fetchImpl: options.fetchImpl,
    method: "POST",
    timeoutMs: options.timeoutMs || 180000
  });

  return {
    modelId: model,
    result,
    status: normalizeString(result?.status, 80) || "loaded"
  };
}

export async function collectLmStudio(processes = []) {
  const processMatches = processes.filter((entry) => entry.isLmStudio);

  try {
    const payload = await fetchJson(LM_STUDIO_NATIVE_MODELS_URL);
    const models = parseLmStudioModels(payload);

    return providerResult("lm_studio", "available", {
      endpoint: "native",
      loadUrl: LM_STUDIO_LOAD_URL,
      models,
      processCount: processMatches.length,
      processes: processMatches.slice(0, 12),
      supportsLoad: true,
      url: LM_STUDIO_NATIVE_MODELS_URL
    });
  } catch (nativeError) {
    try {
      const payload = await fetchJson(LM_STUDIO_COMPAT_MODELS_URL);
      const models = parseLmStudioModels(payload);

      return providerResult("lm_studio", "available", {
        endpoint: "openai-compatible",
        loadUrl: LM_STUDIO_LOAD_URL,
        models,
        processCount: processMatches.length,
        processes: processMatches.slice(0, 12),
        supportsLoad: false,
        url: LM_STUDIO_COMPAT_MODELS_URL
      });
    } catch {
      return providerResult(
        "lm_studio",
        processMatches.length ? "degraded" : "unavailable",
        {
          endpoint: "native",
          loadUrl: LM_STUDIO_LOAD_URL,
          models: [],
          processCount: processMatches.length,
          processes: processMatches.slice(0, 12),
          supportsLoad: true,
          url: LM_STUDIO_NATIVE_MODELS_URL
        },
        processMatches.length
          ? `LM Studio process found, but ${LM_STUDIO_NATIVE_MODELS_URL} did not respond.`
          : `LM Studio was not detected on ${LM_STUDIO_NATIVE_MODELS_URL}.`
      );
    }
  }
}
