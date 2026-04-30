import path from "node:path";

import {
  isWindows,
  normalizePowerShellRows,
  providerResult,
  runPowerShellJson,
  toNumber
} from "./common.js";

export function commandLooksLikeDevServer(commandLine = "") {
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

export function normalizeProcessRow(row = {}) {
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

export async function collectProcesses() {
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

export async function getProcessByPid(pid) {
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

export function processMatchesExecutable(processInfo, executable) {
  const expectedBase = path.basename(String(executable || "")).toLowerCase();
  const actualBase = path.basename(String(processInfo?.executablePath || processInfo?.name || "")).toLowerCase();
  const commandLine = String(processInfo?.commandLine || "").toLowerCase();

  return Boolean(expectedBase && (actualBase === expectedBase || commandLine.includes(expectedBase)));
}
