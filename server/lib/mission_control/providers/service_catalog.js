const WINDOWS_PORTS = new Map([
  [135, {
    label: "Windows RPC",
    description: "Windows RPC endpoint mapper used by system services.",
    confidence: "medium"
  }],
  [445, {
    label: "Windows SMB",
    description: "Windows file and printer sharing listener owned by the system.",
    confidence: "medium"
  }],
  [2869, {
    label: "Windows UPnP",
    description: "Windows device discovery and UPnP event listener.",
    confidence: "medium"
  }],
  [5040, {
    label: "Windows CDP Service",
    description: "Connected Devices Platform service used by Windows device features.",
    confidence: "medium"
  }],
  [5357, {
    label: "Windows Web Services",
    description: "Windows web services device discovery listener.",
    confidence: "medium"
  }],
  [7680, {
    label: "Windows Delivery Optimization",
    description: "Windows update delivery optimization peer listener.",
    confidence: "medium"
  }]
]);

function lower(value) {
  return String(value || "").toLowerCase();
}

function normalizeHeaders(headers = {}) {
  const output = {};

  if (headers?.forEach) {
    headers.forEach((value, key) => {
      output[lower(key)] = String(value || "");
    });
    return output;
  }

  for (const [key, value] of Object.entries(headers || {})) {
    output[lower(key)] = String(value || "");
  }

  return output;
}

function result(label, description, confidence, source) {
  return {
    confidence,
    description,
    label,
    source
  };
}

export function identifyMissionControlService(entry = {}) {
  const port = Number(entry.port || entry.localPort || 0);
  const name = lower(entry.name || entry.processName || entry.process?.name);
  const commandLine = lower(entry.commandLine || entry.process?.commandLine);
  const title = lower(entry.title);
  const body = lower(entry.bodySnippet || entry.body);
  const headers = normalizeHeaders(entry.headers);
  const text = `${name} ${commandLine} ${title} ${body}`;

  if (headers["x-syncthing-id"] || headers["x-syncthing-version"] || (port === 8384 && text.includes("syncthing"))) {
    return result(
      "Syncthing",
      "Syncthing local web UI and synchronization API.",
      "high",
      headers["x-syncthing-id"] ? "http-header" : "process-port"
    );
  }

  if (body.includes("hermes gateway adapter") || title.includes("hermes gateway adapter") || port === 18789 || name.includes("hermes")) {
    return result(
      "Hermes Gateway Adapter",
      "Hermes local gateway adapter health endpoint.",
      body.includes("hermes gateway adapter") ? "high" : "medium",
      body.includes("hermes gateway adapter") ? "http-body" : "process-port"
    );
  }

  if (title.includes("codex request gateway") || body.includes("codex request gateway")) {
    return result(
      "Codex Request Gateway",
      "Local Codex request gateway endpoint.",
      "high",
      title.includes("codex request gateway") ? "http-title" : "http-body"
    );
  }

  if (port === 1234 || title.includes("lm studio") || body.includes("lm studio") || name.includes("lm studio")) {
    return result(
      "LM Studio",
      "LM Studio local OpenAI-compatible and native model server.",
      title.includes("lm studio") || body.includes("lm studio") || name.includes("lm studio") ? "high" : "medium",
      "known-port"
    );
  }

  if (commandLine.includes("vite") || title.includes("vite")) {
    return result(
      "Vite Dev Server",
      "Frontend development server, usually serving a local web app.",
      commandLine.includes("vite") ? "high" : "medium",
      commandLine.includes("vite") ? "command-line" : "http-title"
    );
  }

  if (commandLine.includes("uvicorn")) {
    return result("Uvicorn Python Server", "Python ASGI development server.", "high", "command-line");
  }

  if (commandLine.includes("streamlit")) {
    return result("Streamlit App", "Python Streamlit local app server.", "high", "command-line");
  }

  if (commandLine.includes("flask")) {
    return result("Flask App", "Python Flask local development server.", "high", "command-line");
  }

  if (name === "svchost.exe" || name === "svchost") {
    return result(
      "Windows Service Host",
      "Windows Service Host; hosts one or more Windows background services.",
      "medium",
      "process-name"
    );
  }

  if (name === "system") {
    return result(
      "Windows System",
      "Kernel-owned Windows networking and system services.",
      "medium",
      "process-name"
    );
  }

  if (WINDOWS_PORTS.has(port)) {
    const known = WINDOWS_PORTS.get(port);
    return result(known.label, known.description, known.confidence, "known-port");
  }

  if (name.includes("node")) {
    return result("Node.js App", "Node.js process listening on localhost.", "low", "process-name");
  }

  if (name.includes("python")) {
    return result("Python App", "Python process listening on localhost.", "low", "process-name");
  }

  if (entry.title) {
    return result(String(entry.title).slice(0, 160), "Local HTTP surface identified from its page title.", "medium", "http-title");
  }

  if (entry.name || entry.processName) {
    return result(String(entry.name || entry.processName).slice(0, 160), "Local listener identified from the owning process.", "low", "process-name");
  }

  return result(
    port ? `localhost:${port}` : "Local service",
    "Local listener with no known service signature.",
    "low",
    "fallback"
  );
}
