import {
  ensureMissionControlSpace,
  MISSION_CONTROL_SPACE_ID
} from "/mod/_core/mission-control/space-template.js";

const SNAPSHOT_CACHE = {
  at: 0,
  promise: null,
  value: null
};

function getApi() {
  const runtime = globalThis.space;

  if (!runtime?.api?.call) {
    throw new Error("space.api.call is not available.");
  }

  return runtime.api;
}

function logMissionControlError(context, error) {
  console.error(`[mission-control] ${context}`, error);
}

function normalizeSnapshot(snapshot = {}) {
  return snapshot && typeof snapshot === "object" ? snapshot : {};
}

async function fetchSnapshot(options = {}) {
  const cacheMs = Math.max(0, Number(options.cacheMs) || 0);
  const now = Date.now();

  if (!options.force && SNAPSHOT_CACHE.value && cacheMs > 0 && now - SNAPSHOT_CACHE.at < cacheMs) {
    return SNAPSHOT_CACHE.value;
  }

  if (!options.force && SNAPSHOT_CACHE.promise) {
    return SNAPSHOT_CACHE.promise;
  }

  SNAPSHOT_CACHE.promise = getApi()
    .call("mission_control_snapshot", {
      method: "GET"
    })
    .then((snapshot) => {
      SNAPSHOT_CACHE.value = normalizeSnapshot(snapshot);
      SNAPSHOT_CACHE.at = Date.now();
      return SNAPSHOT_CACHE.value;
    })
    .finally(() => {
      SNAPSHOT_CACHE.promise = null;
    });

  return SNAPSHOT_CACHE.promise;
}

async function fetchConfig() {
  return getApi().call("mission_control_config_get", {
    method: "GET"
  });
}

async function updateConfig(config) {
  return getApi().call("mission_control_config_update", {
    body: {
      config
    },
    method: "POST"
  });
}

async function startApp(appId) {
  const result = await getApi().call("mission_control_app_start", {
    body: {
      appId
    },
    method: "POST"
  });
  return result?.operation || result;
}

async function stopApp(appId, options = {}) {
  const result = await getApi().call("mission_control_app_stop", {
    body: {
      appId,
      confirmed: options.confirmed === true,
      pid: options.pid || undefined
    },
    method: "POST"
  });
  return result?.operation || result;
}

async function restartApp(appId, options = {}) {
  const result = await getApi().call("mission_control_app_restart", {
    body: {
      appId,
      confirmed: options.confirmed === true,
      pid: options.pid || undefined
    },
    method: "POST"
  });
  return result?.operation || result;
}

async function probe(url) {
  return getApi().call("mission_control_probe", {
    body: {
      url
    },
    method: "POST"
  });
}

function ensureRuntimeNamespace() {
  const previous = globalThis.space.missionControl || {};

  globalThis.space.missionControl = {
    ...previous,
    config: fetchConfig,
    ensureSpace: ensureMissionControlSpace,
    installSpace: ensureMissionControlSpace,
    probe,
    refresh: (options = {}) => fetchSnapshot({ ...options, force: true }),
    restartApp,
    snapshot: fetchSnapshot,
    startApp,
    stopApp
  };
}

function provider(snapshot, name) {
  const providers = snapshot?.providers && typeof snapshot.providers === "object"
    ? snapshot.providers
    : {};

  return providers[name] || {
    data: {},
    name,
    reason: "",
    status: "unavailable"
  };
}

function dataOf(snapshot, name, fallback) {
  return provider(snapshot, name).data || fallback;
}

function formatBytes(value) {
  const number = Number(value);

  if (!Number.isFinite(number) || number < 0) {
    return "n/a";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = number;
  let index = 0;

  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }

  return `${index === 0 ? Math.round(size) : size.toFixed(size >= 10 ? 1 : 2)} ${units[index]}`;
}

function formatDuration(value) {
  const seconds = Math.max(0, Number(value) || 0);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) {
    return `${days}d ${hours}h`;
  }

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
}

function normalizeConfigForEdit(configResult = {}) {
  const config = configResult?.config && typeof configResult.config === "object"
    ? configResult.config
    : {
        apps: [],
        refreshIntervalMs: 5000,
        schema: "mission-control/v1"
      };

  return JSON.stringify(config, null, 2);
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const output = [];

  for (const item of Array.isArray(items) ? items : []) {
    const key = keyFn(item);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(item);
  }

  return output;
}

const model = {
  actionAppId: "",
  configResult: null,
  configText: "",
  errorText: "",
  installingSpace: false,
  lastActionText: "",
  loading: false,
  redirectingToSpace: false,
  refreshTimer: 0,
  savingConfig: false,
  showConfig: false,
  snapshot: null,

  async init() {
    ensureRuntimeNamespace();

    if (this.shouldRedirectToSpace()) {
      await this.openMissionControlSpace({
        replace: true
      });
      return;
    }

    await Promise.all([
      this.loadConfig(),
      this.refresh({ force: true })
    ]);
    this.scheduleRefresh();
  },

  destroy() {
    window.clearTimeout(this.refreshTimer);
    this.refreshTimer = 0;
  },

  shouldRedirectToSpace() {
    const hash = String(window.location.hash || "");
    return !new URLSearchParams(hash.split("?")[1] || "").has("inspect");
  },

  get generatedAtLabel() {
    const value = this.snapshot?.generatedAt;
    if (!value) {
      return "";
    }

    try {
      return new Date(value).toLocaleTimeString();
    } catch {
      return String(value);
    }
  },

  get refreshIntervalMs() {
    return Math.max(1500, Number(this.configResult?.config?.refreshIntervalMs) || 5000);
  },

  get system() {
    return dataOf(this.snapshot, "system", {});
  },

  get disks() {
    return dataOf(this.snapshot, "disks", {}).disks || [];
  },

  get memoryUsedBytes() {
    return Math.max(0, Number(this.system.totalMemoryBytes || 0) - Number(this.system.freeMemoryBytes || 0));
  },

  get memoryPercent() {
    const total = Number(this.system.totalMemoryBytes || 0);
    return total > 0 ? Math.round((this.memoryUsedBytes / total) * 100) : 0;
  },

  get ports() {
    return dataOf(this.snapshot, "ports", {}).localhost || [];
  },

  get highlightedPorts() {
    return this.ports
      .filter((entry) => {
        const text = `${entry.name || ""} ${entry.commandLine || ""}`.toLowerCase();
        return text.includes("node") || text.includes("python") || text.includes("vite") || text.includes("uvicorn") || text.includes("lm studio");
      })
      .slice(0, 12);
  },

  get reachableHttp() {
    return uniqueBy(dataOf(this.snapshot, "localhost_http", {}).reachable || [], (entry) => entry.url)
      .slice(0, 12);
  },

  get registeredApps() {
    return this.snapshot?.registeredApps || [];
  },

  get lmStudio() {
    return provider(this.snapshot, "lm_studio");
  },

  get lmStudioModels() {
    return this.lmStudio.data?.models || [];
  },

  get codex() {
    return provider(this.snapshot, "codex");
  },

  get codexProcesses() {
    return this.codex.data?.processes || [];
  },

  get sqliteFiles() {
    return dataOf(this.snapshot, "sqlite", {}).files || [];
  },

  get inspectedSqlite() {
    return dataOf(this.snapshot, "sqlite", {}).inspected || [];
  },

  get services() {
    return dataOf(this.snapshot, "windows_services", {}).services || [];
  },

  get docker() {
    return provider(this.snapshot, "docker");
  },

  get networkStats() {
    return dataOf(this.snapshot, "network", {}).stats || [];
  },

  get providerList() {
    const providers = this.snapshot?.providers || {};
    return Object.values(providers);
  },

  get configAppCount() {
    return this.configResult?.config?.apps?.length || 0;
  },

  statusClass(name) {
    const status = provider(this.snapshot, name).status;
    return {
      "is-available": status === "available",
      "is-degraded": status === "degraded",
      "is-unavailable": status === "unavailable"
    };
  },

  providerStatus(name) {
    const value = provider(this.snapshot, name).status || "unavailable";
    return value.replace(/^./u, (letter) => letter.toUpperCase());
  },

  providerReason(name) {
    return provider(this.snapshot, name).reason || "";
  },

  formatBytes,
  formatDuration,

  scheduleRefresh() {
    window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      void this.refresh().finally(() => this.scheduleRefresh());
    }, this.refreshIntervalMs);
  },

  async refresh(options = {}) {
    this.loading = true;
    this.errorText = "";

    try {
      this.snapshot = await fetchSnapshot({
        cacheMs: options.force ? 0 : 1000,
        force: options.force === true
      });
    } catch (error) {
      logMissionControlError("snapshot failed", error);
      this.errorText = String(error?.message || "Unable to refresh Mission Control.");
    } finally {
      this.loading = false;
    }
  },

  async loadConfig() {
    try {
      this.configResult = await fetchConfig();
      this.configText = normalizeConfigForEdit(this.configResult);
    } catch (error) {
      logMissionControlError("config load failed", error);
      this.errorText = String(error?.message || "Unable to load Mission Control config.");
    }
  },

  async saveConfig() {
    if (this.savingConfig) {
      return;
    }

    this.savingConfig = true;
    this.errorText = "";

    try {
      const parsed = JSON.parse(this.configText || "{}");
      this.configResult = await updateConfig(parsed);
      this.configText = normalizeConfigForEdit(this.configResult);
      this.lastActionText = "Config saved.";
      await this.refresh({ force: true });
      this.scheduleRefresh();
    } catch (error) {
      logMissionControlError("config save failed", error);
      this.errorText = String(error?.message || "Unable to save Mission Control config.");
    } finally {
      this.savingConfig = false;
    }
  },

  async handleAppAction(action, app = {}) {
    const appId = String(app.id || "").trim();
    if (!appId || this.actionAppId) {
      return;
    }

    this.actionAppId = appId;
    this.errorText = "";
    this.lastActionText = "";

    try {
      let result;
      if (action === "start") {
        result = await startApp(appId);
      } else if (action === "restart") {
        result = await restartApp(appId, {
          confirmed: app.stopMode === "external",
          pid: app.pid
        });
      } else {
        result = await stopApp(appId, {
          confirmed: app.stopMode === "external",
          pid: app.pid
        });
      }

      this.lastActionText = `${app.label || appId}: ${result.status || action}`;
      await this.refresh({ force: true });
    } catch (error) {
      logMissionControlError(`${action} failed`, error);
      this.errorText = String(error?.message || `Unable to ${action} ${appId}.`);
    } finally {
      this.actionAppId = "";
    }
  },

  async openMissionControlSpace(options = {}) {
    if (this.installingSpace) {
      return;
    }

    this.installingSpace = true;
    this.redirectingToSpace = true;
    this.errorText = "";

    try {
      await ensureMissionControlSpace({
        replace: options.replace === true
      });
      this.lastActionText = `Opened ${MISSION_CONTROL_SPACE_ID}.`;
    } catch (error) {
      logMissionControlError("install space failed", error);
      this.errorText = String(error?.message || "Unable to open Mission Control Space.");
      this.redirectingToSpace = false;
    } finally {
      this.installingSpace = false;
    }
  },

  async installSpace() {
    await this.openMissionControlSpace();
  }
};

ensureRuntimeNamespace();
globalThis.space.fw.createStore("missionControl", model);
