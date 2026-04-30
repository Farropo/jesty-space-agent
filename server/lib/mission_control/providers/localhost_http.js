import { assertLocalHttpUrl } from "../local_url.js";
import { PROBE_TIMEOUT_MS, providerResult } from "./common.js";

function extractHtmlTitle(text = "") {
  const match = String(text || "").match(/<title[^>]*>([\s\S]*?)<\/title>/iu);
  return match ? match[1].replace(/\s+/gu, " ").trim().slice(0, 160) : "";
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
    let title = "";

    if (contentType.includes("text/html")) {
      const body = await response.text();
      title = extractHtmlTitle(body.slice(0, 65536));
    }

    return {
      contentType,
      durationMs: Date.now() - startedAt,
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
  const candidatePorts = new Set([1234, 3000, 3001, 5173, 8000, 8080, 8384, 8888]);

  for (const listener of listeners) {
    const name = String(listener.name || "").toLowerCase();
    const commandLine = String(listener.commandLine || "").toLowerCase();

    if (
      ["127.0.0.1", "0.0.0.0", "::1", "::"].includes(listener.address) &&
      (name.includes("node") ||
        name.includes("python") ||
        name.includes("lm studio") ||
        commandLine.includes("vite") ||
        commandLine.includes("uvicorn"))
    ) {
      candidatePorts.add(listener.port);
    }
  }

  const results = await Promise.all(
    [...candidatePorts]
      .filter((port) => Number.isInteger(port) && port > 0 && port <= 65535)
      .slice(0, 24)
      .map(async (port) => {
        const url = `http://127.0.0.1:${port}/`;

        try {
          return {
            ...(await probeLocalHttp(url, { timeoutMs: 900 })),
            port
          };
        } catch (error) {
          return {
            durationMs: 0,
            error: String(error?.name === "AbortError" ? "timeout" : error?.message || error),
            ok: false,
            port,
            status: 0,
            title: "",
            url
          };
        }
      })
  );

  return providerResult("localhost_http", "available", {
    probes: results,
    reachable: results.filter((entry) => entry.status > 0)
  });
}
