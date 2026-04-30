import { execFileAsync, providerResult, toNumber } from "./common.js";

export async function collectDocker() {
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
  } catch {
    return providerResult("docker", "unavailable", {
      containers: [],
      info: null
    }, "Docker CLI or daemon is not available.");
  }
}
