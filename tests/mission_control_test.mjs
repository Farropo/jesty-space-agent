import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import {
  normalizeMissionControlConfig
} from "../server/lib/mission_control/config.js";
import {
  isLocalHttpUrl,
  normalizeLocalHttpUrl
} from "../server/lib/mission_control/local_url.js";
import {
  parseLmStudioModels
} from "../server/lib/mission_control/service.js";
import { createAgentServer } from "../server/app.js";

function listen(server, port = 0, host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.removeListener("error", reject);
      resolve(server.address());
    });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

test("mission control config validation keeps app control explicit", () => {
  const config = normalizeMissionControlConfig({
    apps: [
      {
        args: ["server.js"],
        cwd: "C:/repositories/demo",
        env: {
          GOOD_KEY: "value",
          "bad-key": "ignored"
        },
        executable: "node",
        healthUrl: "http://127.0.0.1:3000",
        id: "demo-app",
        label: "Demo App",
        stopMode: "external",
        tags: ["dev"]
      }
    ],
    refreshIntervalMs: 500
  });

  assert.equal(config.apps[0].id, "demo-app");
  assert.equal(config.apps[0].env.GOOD_KEY, "value");
  assert.equal(config.apps[0].env["bad-key"], undefined);
  assert.equal(config.apps[0].healthUrl, "http://127.0.0.1:3000/");
  assert.equal(config.apps[0].stopMode, "external");
  assert.equal(config.refreshIntervalMs, 1500);

  assert.throws(
    () => normalizeMissionControlConfig({
      apps: [
        { executable: "node", id: "same" },
        { executable: "node", id: "same" }
      ]
    }),
    /Duplicate app id/
  );
});

test("mission control URL validation only accepts localhost http URLs", () => {
  assert.equal(isLocalHttpUrl("http://localhost:5173"), true);
  assert.equal(isLocalHttpUrl("https://127.0.0.1:8443/path"), true);
  assert.equal(normalizeLocalHttpUrl("http://127.0.0.1:8000"), "http://127.0.0.1:8000/");
  assert.equal(isLocalHttpUrl("https://example.com"), false);
  assert.equal(isLocalHttpUrl("file:///C:/tmp/x"), false);
});

test("mission control parses LM Studio model payloads", () => {
  assert.deepEqual(
    parseLmStudioModels({
      data: [
        { id: "qwen/qwen3", object: "model", owned_by: "lm-studio" },
        { id: "", object: "model" }
      ]
    }),
    [
      {
        id: "qwen/qwen3",
        object: "model",
        ownedBy: "lm-studio"
      }
    ]
  );
});

test("mission control APIs save config, probe localhost, and start or stop tracked apps", async (testContext) => {
  const customwarePath = await mkdtemp(path.join(os.tmpdir(), "space-mission-control-"));
  const runtime = await createAgentServer({
    runtimeParamOverrides: {
      CUSTOMWARE_PATH: customwarePath,
      PORT: "0",
      SINGLE_USER_APP: "true"
    }
  });
  const localHttp = http.createServer((req, res) => {
    res.writeHead(200, {
      "content-type": "text/html"
    });
    res.end("<!doctype html><title>Mission Probe</title><main>ok</main>");
  });
  let spawnedPid = 0;

  testContext.after(async () => {
    if (spawnedPid) {
      try {
        process.kill(spawnedPid);
      } catch {
        // Process may already be gone.
      }
    }

    await closeServer(localHttp).catch(() => {});
    await runtime.close().catch(() => {});
    await rm(customwarePath, { recursive: true, force: true });
  });

  await runtime.listen();
  const localAddress = await listen(localHttp);
  const probeUrl = `http://127.0.0.1:${localAddress.port}/`;

  const postJson = async (pathname, body) => {
    const response = await fetch(`${runtime.browserUrl}${pathname}`, {
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json"
      },
      method: "POST"
    });
    const text = await response.text();

    return {
      body: text ? JSON.parse(text) : null,
      response
    };
  };

  const configUpdate = await postJson("/api/mission_control_config_update", {
    config: {
      apps: [
        {
          args: ["-e", "setInterval(() => {}, 1000)"],
          executable: process.execPath,
          healthUrl: probeUrl,
          id: "test-node",
          label: "Test Node"
        }
      ],
      refreshIntervalMs: 2000
    }
  });
  assert.equal(configUpdate.response.status, 200);
  assert.equal(configUpdate.body.config.apps[0].id, "test-node");

  const probe = await postJson("/api/mission_control_probe", {
    url: probeUrl
  });
  assert.equal(probe.response.status, 200);
  assert.equal(probe.body.probe.title, "Mission Probe");

  const externalProbe = await postJson("/api/mission_control_probe", {
    url: "https://example.com/"
  });
  assert.equal(externalProbe.response.status, 400);

  const started = await postJson("/api/mission_control_app_start", {
    appId: "test-node"
  });
  assert.equal(started.response.status, 200);
  assert.equal(started.body.operation.status, "started");
  assert.ok(started.body.operation.pid > 0);
  spawnedPid = started.body.operation.pid;

  const stopped = await postJson("/api/mission_control_app_stop", {
    appId: "test-node"
  });
  assert.equal(stopped.response.status, 200);
  assert.equal(stopped.body.operation.status, "stopped");
  spawnedPid = 0;
});
