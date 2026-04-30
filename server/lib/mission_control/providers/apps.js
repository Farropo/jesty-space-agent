import { spawn } from "node:child_process";
import path from "node:path";

import { createHttpError } from "../../customware/file_access.js";
import {
  appendMissionControlAudit,
  readMissionControlConfig
} from "../config.js";
import { normalizeLocalHttpUrl } from "../local_url.js";
import { nowIso } from "./common.js";
import {
  getProcessByPid,
  processMatchesExecutable
} from "./processes.js";

const trackedChildren = new Map();
let operationCounter = 0;

function nextOperationId(prefix = "mission") {
  operationCounter += 1;
  return `${prefix}_${Date.now()}_${operationCounter}`;
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

export function buildRegisteredApps(config, processes = [], probes = []) {
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

function verifyExternalStopTarget(app, processInfo) {
  if (!processInfo) {
    throw createHttpError("Target process was not found.", 404);
  }

  const expectedCwd = String(app.cwd || "").trim().toLowerCase();
  const commandLine = String(processInfo.commandLine || "").toLowerCase();

  if (processMatchesExecutable(processInfo, app.executable)) {
    return;
  }

  if (expectedCwd && commandLine.includes(expectedCwd)) {
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
