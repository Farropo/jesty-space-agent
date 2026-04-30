import {
  isWindows,
  normalizePowerShellRows,
  providerResult,
  runPowerShellJson,
  toNumber
} from "./common.js";

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

export async function collectPorts(processes = []) {
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
