import { assertLocalHttpUrl } from "../local_url.js";
import { PROBE_TIMEOUT_MS, providerResult } from "./common.js";
import { identifyMissionControlService } from "./service_catalog.js";

function extractHtmlTitle(text = "") {
  const match = String(text || "").match(/<title[^>]*>([\s\S]*?)<\/title>/iu);
  return match ? match[1].replace(/\s+/gu, " ").trim().slice(0, 160) : "";
}

function headersToObject(headers) {
  const output = {};

  headers.forEach((value, key) => {
    output[key.toLowerCase()] = String(value || "");
  });

  return output;
}

function isLocalListener(listener = {}) {
  return ["127.0.0.1", "0.0.0.0", "::1", "::"].includes(listener.address);
}

function enrichProbe(probe, listener = null) {
  return {
    ...probe,
    ...identifyMissionControlService({
      ...probe,
      commandLine: listener?.commandLine || "",
      name: listener?.name || "",
      process: listener?.process || null
    })
  };
}

function probeRank(entry = {}) {
  const knownLabels = [
    "Syncthing",
    "Hermes Gateway Adapter",
    "Codex Request Gateway",
    "LM Studio"
  ];
  const labelIndex = knownLabels.indexOf(entry.label);

  if (labelIndex >= 0) {
    return labelIndex;
  }

  if (entry.confidence === "high") {
    return 10;
  }

  if (entry.confidence === "medium") {
    return 20;
  }

  return 30;
}

export async function probeLocalHttp(url, options = {}) {
  const normalizedUrl = assertLocalHttpUrl(url, "Probe URL");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || PROBE_TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    const response = await fetch(normalizedUrl, {
      headers: {
        accept: "text/html,application/json;q=0.8,*/*;q=0.5",
        "user-agent": "Space-Agent-Mission-Control"
      },
      signal: controller.signal
    });
    const contentType = response.headers.get("content-type") || "";
    const headers = headersToObject(response.headers);
    let bodySnippet = "";
    let title = "";

    if (
      contentType.includes("text/html") ||
      contentType.includes("text/plain") ||
      contentType.includes("application/json")
    ) {
      const body = await response.text();
      const bounded = body.slice(0, 65536);
      title = extractHtmlTitle(bounded);
      bodySnippet = bounded.replace(/\s+/gu, " ").trim().slice(0, 512);
    }

    return {
      bodySnippet,
      contentType,
      durationMs: Date.now() - startedAt,
      headers,
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      title,
      url: normalizedUrl
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function collectLocalhostHttp(listeners = []) {
  const candidatePorts = new Set([1234, 3000, 3001, 5173, 8000, 8080, 8384, 8888, 18789]);
  const listenerByPort = new Map();

  for (const listener of listeners) {
    if (isLocalListener(listener) && Number.isInteger(listener.port)) {
      candidatePorts.add(listener.port);
      if (!listenerByPort.has(listener.port)) {
        listenerByPort.set(listener.port, listener);
      }
    }
  }

  const results = await Promise.all(
    [...candidatePorts]
      .filter((port) => Number.isInteger(port) && port > 0 && port <= 65535)
      .sort((left, right) => left - right)
      .slice(0, 48)
      .map(async (port) => {
        const url = `http://127.0.0.1:${port}/`;
        const listener = listenerByPort.get(port) || null;

        try {
          return enrichProbe({
            ...(await probeLocalHttp(url, { timeoutMs: 900 })),
            port
          }, listener);
        } catch (error) {
          return enrichProbe({
            durationMs: 0,
            error: String(error?.name === "AbortError" ? "timeout" : error?.message || error),
            ok: false,
            port,
            status: 0,
            title: "",
            url
          }, listener);
        }
      })
  );

  return providerResult("localhost_http", "available", {
    probes: results,
    reachable: results
      .filter((entry) => entry.status > 0)
      .sort((left, right) => probeRank(left) - probeRank(right) || left.port - right.port)
  });
}
