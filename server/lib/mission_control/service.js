import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { createHttpError } from "../customware/file_access.js";
import {
  appendMissionControlAudit,
  readMissionControlConfig,
  summarizeMissionControlConfig
} from "./config.js";
import { assertLocalHttpUrl, normalizeLocalHttpUrl } from "./local_url.js";

const execFileAsync = promisify(execFile);
const POWERSHELL_TIMEOUT_MS = 8000;
const PROBE_TIMEOUT_MS = 1200;
const SQLITE_DISCOVERY_LIMIT = 80;
const SQLITE_INSPECT_LIMIT = 10;
const trackedChildren = new Map();
let operationCounter = 0;

function nowIso() {
  return new Date().toISOString();
}

function nextOperationId(prefix = "mission") {
  operationCounter += 1;
  return `${prefix}_${Date.now()}_${operationCounter}`;
}

function isWindows() {
  return process.platform === "win32";
}

function normalizeArray(value) {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function providerResult(name, status, data = {}, reason = "") {
  return {
    available: status === "available",
    data,
    name,
    reason: String(reason || ""),
    status
  };
}

function waitForImmediateSpawnFailure(child) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (error = null) => {
      if (settled) {
        return;
      }

      settled = true;
      resolve(error);
    };
    const timer = setTimeout(() => done(null), 100);

    child.once("error", (error) => {
      clearTimeout(timer);
      done(error);
    });
  });
}

async function runPowerShellJson(script, options = {}) {
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

function normalizePowerShellRows(value) {
  if (value && typeof value === "object" && value.__missionControlError) {
    throw new Error(value.__missionControlError);
  }

  return normalizeArray(value).filter(Boolean);
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function commandLooksLikeDevServer(commandLine = "") {
  const value = String(commandLine || "").toLowerCase();
  return (
    value.includes("vite") ||
    value.includes("uvicorn") ||
    value.includes("next") ||
    value.includes("astro") ||
    value.includes("flask") ||
    value.includes("django") ||
    value.includes("streamlit")
  );
}

function normalizeProcessRow(row = {}) {
  const commandLine = String(row.CommandLine || row.commandLine || "");
  const name = String(row.Name || row.name || "");

  return {
    commandLine,
    createdAt: String(row.CreationDate || row.createdAt || ""),
    executablePath: String(row.ExecutablePath || row.executablePath || ""),
    isCodex: /(^|\\|\/)(codex|codex\.exe)$/iu.test(name) || commandLine.toLowerCase().includes("codex"),
    isDevServer: commandLooksLikeDevServer(commandLine),
    isLmStudio: name.toLowerCase().includes("lm studio") || commandLine.toLowerCase().includes("lm studio"),
    name,
    parentPid: toNumber(row.ParentProcessId || row.parentPid),
    pid: toNumber(row.ProcessId || row.pid),
    workingSetBytes: toNumber(row.WorkingSetSize || row.workingSetBytes)
  };
}

async function collectProcesses() {
  if (!isWindows()) {
    return providerResult("processes", "degraded", {
      processes: []
    }, "Detailed process discovery is currently Windows-first.");
  }

  try {
    const rows = normalizePowerShellRows(await runPowerShellJson(
      "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine,WorkingSetSize,CreationDate",
      { maxBuffer: 16 * 1024 * 1024 }
    ));
    const processes = rows.map(normalizeProcessRow).filter((entry) => entry.pid > 0);

    return providerResult("processes", "available", {
      codex: processes.filter((entry) => entry.isCodex).slice(0, 20),
      devServers: processes.filter((entry) => entry.isDevServer).slice(0, 30),
      lmStudio: processes.filter((entry) => entry.isLmStudio).slice(0, 20),
      processes,
      total: processes.length
    });
  } catch (error) {
    return providerResult("processes", "unavailable", {
      processes: []
    }, error.message);
  }
}

function normalizePortRow(row = {}, processByPid = new Map()) {
  const pid = toNumber(row.OwningProcess || row.pid);
  const processInfo = processByPid.get(pid) || null;
  const address = String(row.LocalAddress || row.address || "");
  const port = toNumber(row.LocalPort || row.port);

  return {
    address,
    commandLine: processInfo?.commandLine || "",
    name: processInfo?.name || "",
    pid,
    port,
    process: processInfo,
    protocol: "tcp",
    state: String(row.State || row.state || "Listen")
  };
}

async function collectPorts(processes = []) {
  if (!isWindows()) {
    return providerResult("ports", "degraded", {
      listeners: []
    }, "Port ownership discovery is currently Windows-first.");
  }

  try {
    const processByPid = new Map(processes.map((entry) => [entry.pid, entry]));
    const rows = normalizePowerShellRows(await runPowerShellJson(
      "Get-NetTCPConnection -State Listen | Select-Object LocalAddress,LocalPort,OwningProcess,State",
      { maxBuffer: 8 * 1024 * 1024 }
    ));
    const listeners = rows
      .map((row) => normalizePortRow(row, processByPid))
      .filter((entry) => entry.port > 0)
      .sort((left, right) => left.port - right.port || left.pid - right.pid);

    return providerResult("ports", "available", {
      listeners,
      localhost: listeners.filter((entry) =>
        ["127.0.0.1", "::1", "0.0.0.0", "::"].includes(entry.address)
      )
    });
  } catch (error) {
    return providerResult("ports", "unavailable", {
      listeners: []
    }, error.message);
  }
}

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

async function collectLocalhostHttp(listeners = []) {
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

export function parseLmStudioModels(payload) {
  const models = Array.isArray(payload?.data) ? payload.data : [];

  return models.map((model) => ({
    id: String(model?.id || ""),
    object: String(model?.object || ""),
    ownedBy: String(model?.owned_by || model?.ownedBy || "")
  })).filter((model) => model.id);
}

async function collectLmStudio(processes = []) {
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
  } catch (error) {
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

async function collectSystem() {
  const cpus = os.cpus() || [];
  const loadAverage = os.loadavg();

  return providerResult("system", "available", {
    arch: os.arch(),
    cpuCount: cpus.length,
    cpuModel: cpus[0]?.model || "",
    freeMemoryBytes: os.freemem(),
    hostname: os.hostname(),
    loadAverage,
    platform: process.platform,
    release: os.release(),
    totalMemoryBytes: os.totalmem(),
    uptimeSeconds: os.uptime()
  });
}

async function collectDisks() {
  if (!isWindows()) {
    return providerResult("disks", "degraded", {
      disks: []
    }, "Disk capacity discovery is currently Windows-first.");
  }

  try {
    const rows = normalizePowerShellRows(await runPowerShellJson(
      "Get-CimInstance Win32_LogicalDisk -Filter \"DriveType=3\" | Select-Object DeviceID,VolumeName,Size,FreeSpace"
    ));
    const disks = rows.map((row) => ({
      freeBytes: toNumber(row.FreeSpace),
      id: String(row.DeviceID || ""),
      label: String(row.VolumeName || ""),
      sizeBytes: toNumber(row.Size)
    }));

    return providerResult("disks", "available", {
      disks
    });
  } catch (error) {
    return providerResult("disks", "unavailable", {
      disks: []
    }, error.message);
  }
}

async function collectWindowsServices() {
  if (!isWindows()) {
    return providerResult("windows_services", "degraded", {
      services: []
    }, "Windows services are only available on Windows.");
  }

  try {
    const rows = normalizePowerShellRows(await runPowerShellJson(
      "Get-Service | Sort-Object Status,Name | Select-Object -First 160 Name,DisplayName,Status,StartType"
    ));
    const services = rows.map((row) => ({
      displayName: String(row.DisplayName || ""),
      name: String(row.Name || ""),
      startType: String(row.StartType || ""),
      status: String(row.Status || "")
    }));

    return providerResult("windows_services", "available", {
      services
    });
  } catch (error) {
    return providerResult("windows_services", "unavailable", {
      services: []
    }, error.message);
  }
}

async function collectNetwork() {
  const interfaces = os.networkInterfaces();
  let stats = [];
  let status = "available";
  let reason = "";

  if (isWindows()) {
    try {
      stats = normalizePowerShellRows(await runPowerShellJson(
        "Get-NetAdapterStatistics | Select-Object Name,ReceivedBytes,SentBytes,ReceivedUnicastPackets,SentUnicastPackets"
      )).map((row) => ({
        name: String(row.Name || ""),
        receivedBytes: toNumber(row.ReceivedBytes),
        receivedPackets: toNumber(row.ReceivedUnicastPackets),
        sentBytes: toNumber(row.SentBytes),
        sentPackets: toNumber(row.SentUnicastPackets)
      }));
    } catch (error) {
      status = "degraded";
      reason = error.message;
    }
  }

  return providerResult("network", status, {
    interfaces,
    stats
  }, reason);
}

async function collectDocker() {
  try {
    const infoResult = await execFileAsync("docker", ["info", "--format", "{{json .}}"], {
      maxBuffer: 4 * 1024 * 1024,
      timeout: 2500,
      windowsHide: true
    });
    const info = JSON.parse(String(infoResult.stdout || "{}"));
    let containers = [];

    try {
      const psResult = await execFileAsync(
        "docker",
        ["ps", "-a", "--format", "{{json .}}"],
        {
          maxBuffer: 2 * 1024 * 1024,
          timeout: 2500,
          windowsHide: true
        }
      );
      containers = String(psResult.stdout || "")
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 80)
        .map((line) => JSON.parse(line));
    } catch {
      containers = [];
    }

    return providerResult("docker", "available", {
      containers,
      info: {
        containers: toNumber(info.Containers),
        dockerRootDir: String(info.DockerRootDir || ""),
        driver: String(info.Driver || ""),
        images: toNumber(info.Images),
        operatingSystem: String(info.OperatingSystem || ""),
        serverVersion: String(info.ServerVersion || "")
      }
    });
  } catch (error) {
    return providerResult("docker", "unavailable", {
      containers: [],
      info: null
    }, "Docker CLI or daemon is not available.");
  }
}

async function findSqliteFiles() {
  const roots = [];
  const repositoriesDir = path.resolve(os.homedir(), "..", "..", "repositories");

  roots.push(process.cwd());
  roots.push(path.join(os.homedir(), "Documents"));
  roots.push(repositoriesDir);

  const seenRoots = [...new Set(roots)];
  const sqliteFiles = [];
  const extensions = new Set([".db", ".sqlite", ".sqlite3"]);

  async function walk(dir, depth) {
    if (sqliteFiles.length >= SQLITE_DISCOVERY_LIMIT || depth > 5) {
      return;
    }

    let entries;

    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (sqliteFiles.length >= SQLITE_DISCOVERY_LIMIT) {
        return;
      }

      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "__pycache__") {
        continue;
      }

      const absolutePath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await walk(absolutePath, depth + 1);
        continue;
      }

      if (!entry.isFile() || !extensions.has(path.extname(entry.name).toLowerCase())) {
        continue;
      }

      try {
        const stat = await fs.stat(absolutePath);
        sqliteFiles.push({
          modifiedAt: stat.mtime.toISOString(),
          path: absolutePath,
          sizeBytes: stat.size
        });
      } catch {
        // Ignore disappearing files.
      }
    }
  }

  for (const root of seenRoots) {
    await walk(root, 0);
  }

  return sqliteFiles;
}

async function inspectSqliteFile(filePath) {
  const script = [
    "import json, sqlite3, sys",
    "p = sys.argv[1]",
    "out = {'tables': [], 'ok': False, 'error': ''}",
    "try:",
    "  con = sqlite3.connect('file:' + p + '?mode=ro', uri=True, timeout=1)",
    "  cur = con.execute(\"select name, type from sqlite_master where type in ('table','view') and name not like 'sqlite_%' order by name limit 50\")",
    "  for name, typ in cur.fetchall():",
    "    cols = []",
    "    try:",
    "      cols = [r[1] for r in con.execute('pragma table_info(' + json.dumps(name) + ')').fetchall()]",
    "    except Exception:",
    "      cols = []",
    "    out['tables'].append({'name': name, 'type': typ, 'columns': cols[:24]})",
    "  out['ok'] = True",
    "  con.close()",
    "except Exception as e:",
    "  out['error'] = str(e)",
    "print(json.dumps(out))"
  ].join("\n");

  for (const executable of ["python", "py"]) {
    try {
      const result = await execFileAsync(executable, ["-c", script, filePath], {
        maxBuffer: 512 * 1024,
        timeout: 1500,
        windowsHide: true
      });
      return JSON.parse(String(result.stdout || "{}"));
    } catch {
      // Try next Python launcher.
    }
  }

  return {
    error: "Python sqlite3 inspector is not available.",
    ok: false,
    tables: []
  };
}

async function collectSqlite() {
  try {
    const files = await findSqliteFiles();
    const inspected = [];

    for (const file of files.slice(0, SQLITE_INSPECT_LIMIT)) {
      inspected.push({
        ...file,
        inspection: await inspectSqliteFile(file.path)
      });
    }

    return providerResult("sqlite", "available", {
      files,
      inspected
    });
  } catch (error) {
    return providerResult("sqlite", "degraded", {
      files: [],
      inspected: []
    }, error.message);
  }
}

function matchProcessToApp(app, processes = []) {
  const executable = path.basename(String(app.executable || "")).toLowerCase();
  const healthUrl = normalizeLocalHttpUrl(app.healthUrl);

  return processes.find((processInfo) => {
    const processExecutable = path.basename(String(processInfo.executablePath || processInfo.name || "")).toLowerCase();
    const commandLine = String(processInfo.commandLine || "").toLowerCase();

    if (executable && processExecutable === executable) {
      return true;
    }

    if (healthUrl && commandLine.includes(new URL(healthUrl).port)) {
      return true;
    }

    return Boolean(executable && commandLine.includes(executable));
  }) || null;
}

function buildRegisteredApps(config, processes = [], probes = []) {
  return config.apps.map((app) => {
    const tracked = trackedChildren.get(app.id) || null;
    const matchedProcess = tracked?.pid
      ? processes.find((entry) => entry.pid === tracked.pid) || null
      : matchProcessToApp(app, processes);
    const health = app.healthUrl
      ? probes.find((entry) => entry.url === normalizeLocalHttpUrl(app.healthUrl)) || null
      : null;

    return {
      health,
      id: app.id,
      isRunning: Boolean(matchedProcess || (health && health.status > 0)),
      label: app.label,
      pid: tracked?.pid || matchedProcess?.pid || null,
      stopMode: app.stopMode,
      tags: app.tags,
      tracked: Boolean(tracked?.pid)
    };
  });
}

async function collectCodex(processes = []) {
  const codexProcesses = processes.filter((entry) => entry.isCodex);

  return providerResult(codexProcesses.length ? "codex" : "codex", codexProcesses.length ? "available" : "degraded", {
    appServer: codexProcesses.filter((entry) => entry.commandLine.toLowerCase().includes("app-server")),
    processes: codexProcesses.slice(0, 40),
    total: codexProcesses.length
  }, codexProcesses.length ? "" : "No Codex process was detected in the process list.");
}

export async function createMissionControlSnapshot(context) {
  const configResult = readMissionControlConfig(context);
  const system = await collectSystem();
  const [processesProvider, disks, services, network, docker, sqlite] = await Promise.all([
    collectProcesses(),
    collectDisks(),
    collectWindowsServices(),
    collectNetwork(),
    collectDocker(),
    collectSqlite()
  ]);
  const processes = processesProvider.data.processes || [];
  const ports = await collectPorts(processes);
  const listeners = ports.data.listeners || [];
  const [localhostHttp, lmStudio, codex] = await Promise.all([
    collectLocalhostHttp(listeners),
    collectLmStudio(processes),
    collectCodex(processes)
  ]);
  const probes = localhostHttp.data.probes || [];
  const registeredApps = buildRegisteredApps(configResult.config, processes, probes);
  const providers = {
    codex,
    disks,
    docker,
    lm_studio: lmStudio,
    localhost_http: localhostHttp,
    network,
    ports,
    processes: processesProvider,
    sqlite,
    system,
    windows_services: services
  };

  return {
    config: summarizeMissionControlConfig(configResult.config),
    generatedAt: nowIso(),
    platform: {
      arch: os.arch(),
      node: process.version,
      os: process.platform,
      release: os.release()
    },
    providers,
    registeredApps
  };
}

function findAppConfig(config, appId) {
  const id = String(appId || "").trim();
  const app = config.apps.find((entry) => entry.id === id);

  if (!app) {
    throw createHttpError(`Unknown Mission Control app: ${id || "(empty)"}`, 404);
  }

  return app;
}

function buildChildEnvironment(app) {
  return {
    ...process.env,
    ...app.env
  };
}

export async function startMissionControlApp(context, payload = {}) {
  const operationId = nextOperationId("start");
  const { config } = readMissionControlConfig(context);
  const app = findAppConfig(config, payload.appId);

  if (trackedChildren.has(app.id)) {
    const tracked = trackedChildren.get(app.id);

    return {
      appId: app.id,
      operationId,
      pid: tracked.pid,
      status: "already_running"
    };
  }

  let child;

  try {
    child = spawn(app.executable, app.args, {
      cwd: app.cwd || undefined,
      detached: false,
      env: buildChildEnvironment(app),
      shell: false,
      stdio: "ignore",
      windowsHide: true
    });
  } catch (error) {
    throw createHttpError(`Failed to start ${app.label}: ${error.message}`, 400, error);
  }

  const startupError = await waitForImmediateSpawnFailure(child);
  if (startupError || !child.pid) {
    throw createHttpError(
      `Failed to start ${app.label}: ${startupError?.message || "process did not report a pid"}`,
      400,
      startupError
    );
  }

  child.unref();
  trackedChildren.set(app.id, {
    child,
    executable: app.executable,
    pid: child.pid,
    startedAt: nowIso()
  });
  child.once("exit", () => {
    const tracked = trackedChildren.get(app.id);
    if (tracked?.pid === child.pid) {
      trackedChildren.delete(app.id);
    }
  });

  appendMissionControlAudit(context, {
    action: "app_start",
    appId: app.id,
    operationId,
    pid: child.pid
  });

  return {
    appId: app.id,
    operationId,
    pid: child.pid,
    status: "started"
  };
}

async function getProcessByPid(pid) {
  if (!isWindows()) {
    return null;
  }

  try {
    const rows = normalizePowerShellRows(await runPowerShellJson(
      `Get-CimInstance Win32_Process -Filter "ProcessId=${Math.floor(Number(pid) || 0)}" | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine,WorkingSetSize,CreationDate`
    ));
    return rows.length ? normalizeProcessRow(rows[0]) : null;
  } catch {
    return null;
  }
}

function verifyExternalStopTarget(app, processInfo) {
  if (!processInfo) {
    throw createHttpError("Target process was not found.", 404);
  }

  const expectedBase = path.basename(String(app.executable || "")).toLowerCase();
  const actualBase = path.basename(String(processInfo.executablePath || processInfo.name || "")).toLowerCase();
  const commandLine = String(processInfo.commandLine || "").toLowerCase();

  if (expectedBase && (actualBase === expectedBase || commandLine.includes(expectedBase))) {
    return;
  }

  throw createHttpError("Refusing to stop a process that does not match the registered app.", 409);
}

export async function stopMissionControlApp(context, payload = {}) {
  const operationId = nextOperationId("stop");
  const { config } = readMissionControlConfig(context);
  const app = findAppConfig(config, payload.appId);
  const tracked = trackedChildren.get(app.id);

  if (tracked?.child) {
    tracked.child.kill();
    trackedChildren.delete(app.id);
    appendMissionControlAudit(context, {
      action: "app_stop",
      appId: app.id,
      operationId,
      pid: tracked.pid,
      tracked: true
    });

    return {
      appId: app.id,
      operationId,
      pid: tracked.pid,
      status: "stopped"
    };
  }

  const pid = Math.floor(Number(payload.pid) || 0);
  if (!pid) {
    return {
      appId: app.id,
      operationId,
      pid: null,
      status: "not_tracked"
    };
  }

  if (app.stopMode !== "external" || payload.confirmed !== true) {
    throw createHttpError("External process stop requires stopMode=external and confirmed=true.", 409);
  }

  const processInfo = await getProcessByPid(pid);
  verifyExternalStopTarget(app, processInfo);
  process.kill(pid);
  appendMissionControlAudit(context, {
    action: "app_stop",
    appId: app.id,
    operationId,
    pid,
    tracked: false
  });

  return {
    appId: app.id,
    operationId,
    pid,
    status: "stopped"
  };
}

export async function restartMissionControlApp(context, payload = {}) {
  const operationId = nextOperationId("restart");
  const stopResult = await stopMissionControlApp(context, payload);
  const startResult = await startMissionControlApp(context, payload);

  appendMissionControlAudit(context, {
    action: "app_restart",
    appId: startResult.appId,
    operationId,
    startOperationId: startResult.operationId,
    stopOperationId: stopResult.operationId
  });

  return {
    appId: startResult.appId,
    operationId,
    start: startResult,
    status: "restarted",
    stop: stopResult
  };
}

export async function probeMissionControlUrl(payload = {}) {
  const url = assertLocalHttpUrl(payload.url, "Probe URL");
  return {
    probe: await probeLocalHttp(url, {
      timeoutMs: Math.max(250, Math.min(5000, Number(payload.timeoutMs) || PROBE_TIMEOUT_MS))
    })
  };
}
