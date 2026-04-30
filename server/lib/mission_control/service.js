import os from "node:os";

import {
  readMissionControlConfig,
  summarizeMissionControlConfig
} from "./config.js";
import { assertLocalHttpUrl } from "./local_url.js";
import {
  buildRegisteredApps,
  restartMissionControlApp,
  startMissionControlApp,
  stopMissionControlApp
} from "./providers/apps.js";
import { collectCodex } from "./providers/codex.js";
import { PROBE_TIMEOUT_MS, nowIso } from "./providers/common.js";
import { collectDocker } from "./providers/docker.js";
import {
  collectLocalhostHttp,
  probeLocalHttp
} from "./providers/localhost_http.js";
import {
  collectLmStudio,
  parseLmStudioModels
} from "./providers/lm_studio.js";
import { collectPorts } from "./providers/ports.js";
import { collectProcesses } from "./providers/processes.js";
import { collectSqlite } from "./providers/sqlite.js";
import {
  collectDisks,
  collectNetwork,
  collectSystem
} from "./providers/system.js";
import { collectWindowsServices } from "./providers/windows_services.js";

export {
  parseLmStudioModels,
  probeLocalHttp,
  restartMissionControlApp,
  startMissionControlApp,
  stopMissionControlApp
};

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

export async function probeMissionControlUrl(payload = {}) {
  const url = assertLocalHttpUrl(payload.url, "Probe URL");
  return {
    probe: await probeLocalHttp(url, {
      timeoutMs: Math.max(250, Math.min(5000, Number(payload.timeoutMs) || PROBE_TIMEOUT_MS))
    })
  };
}
