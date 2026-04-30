import os from "node:os";

import {
  isWindows,
  normalizePowerShellRows,
  providerResult,
  runPowerShellJson,
  toNumber
} from "./common.js";

export async function collectSystem() {
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

export async function collectDisks() {
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

export async function collectNetwork() {
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
