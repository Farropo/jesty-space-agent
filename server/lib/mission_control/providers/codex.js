import { providerResult } from "./common.js";

export async function collectCodex(processes = []) {
  const codexProcesses = processes.filter((entry) => entry.isCodex);

  return providerResult("codex", codexProcesses.length ? "available" : "degraded", {
    appServer: codexProcesses.filter((entry) => entry.commandLine.toLowerCase().includes("app-server")),
    processes: codexProcesses.slice(0, 40),
    total: codexProcesses.length
  }, codexProcesses.length ? "" : "No Codex process was detected in the process list.");
}
