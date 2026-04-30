import {
  isWindows,
  normalizePowerShellRows,
  providerResult,
  runPowerShellJson
} from "./common.js";

export async function collectWindowsServices() {
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
