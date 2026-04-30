import { providerResult } from "./common.js";

export function parseLmStudioModels(payload) {
  const models = Array.isArray(payload?.data) ? payload.data : [];

  return models.map((model) => ({
    id: String(model?.id || ""),
    object: String(model?.object || ""),
    ownedBy: String(model?.owned_by || model?.ownedBy || "")
  })).filter((model) => model.id);
}

export async function collectLmStudio(processes = []) {
  const processMatches = processes.filter((entry) => entry.isLmStudio);
  const url = "http://127.0.0.1:1234/v1/models";

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": "Space-Agent-Mission-Control"
      },
      signal: controller.signal
    });
    clearTimeout(timeout);
    const payload = await response.json();
    const models = parseLmStudioModels(payload);

    return providerResult("lm_studio", "available", {
      models,
      processCount: processMatches.length,
      processes: processMatches.slice(0, 12),
      url
    });
  } catch {
    return providerResult(
      "lm_studio",
      processMatches.length ? "degraded" : "unavailable",
      {
        models: [],
        processCount: processMatches.length,
        processes: processMatches.slice(0, 12),
        url
      },
      processMatches.length
        ? `LM Studio process found, but ${url} did not respond.`
        : "LM Studio was not detected on the default local endpoint."
    );
  }
}
