export const MISSION_CONTROL_SPACE_ID = "mission-control";

function blockScalar(value, indent = "  ") {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => `${indent}${line}`)
    .join("\n");
}

function widgetYaml(widget) {
  return [
    "schema: space-widget/v1",
    `id: ${widget.id}`,
    `name: ${JSON.stringify(widget.name)}`,
    `cols: ${widget.cols}`,
    `rows: ${widget.rows}`,
    `col: ${widget.col}`,
    `row: ${widget.row}`,
    "renderer: |-",
    blockScalar(widget.renderer)
  ].join("\n") + "\n";
}

const BASE_RENDERER_HELPERS = `
async function loadSnapshot() {
  if (!globalThis.space?.missionControl) {
    await import("/mod/_core/mission-control/store.js")
  }
  return await globalThis.space.missionControl.snapshot({ cacheMs: 1500 })
}

function css(parent) {
  parent.style.cssText = "width:100%;height:100%;box-sizing:border-box;overflow:auto;color:#edf5ff;background:#0d1827;border-radius:8px;padding:12px;font:13px/1.35 system-ui,Segoe UI,sans-serif;"
  const style = document.createElement("style")
  style.textContent = ".mcw h3{margin:0 0 10px;font-size:14px}.mcw .row{display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-top:1px solid rgba(151,188,255,.14)}.mcw .muted{color:rgba(225,236,255,.66)}.mcw strong{font-weight:700}.mcw a{color:#9bc7ff;text-decoration:none}.mcw .pill{display:inline-flex;border:1px solid rgba(151,188,255,.2);border-radius:999px;padding:2px 7px;color:#bcd3ff}.mcw .ok{color:#6ee7b7}.mcw .warn{color:#facc15}.mcw .bad{color:#fb7185}"
  parent.appendChild(style)
  const root = document.createElement("div")
  root.className = "mcw"
  parent.appendChild(root)
  return root
}

function bytes(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return "n/a"
  const units = ["B","KB","MB","GB","TB"]
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1 }
  return (i === 0 ? Math.round(v) : v.toFixed(v >= 10 ? 1 : 2)) + " " + units[i]
}
`;

const WIDGETS = [
  {
    col: 0,
    cols: 5,
    id: "system",
    name: "System",
    row: 0,
    rows: 3,
    renderer: `async (parent) => {
${BASE_RENDERER_HELPERS}
  const root = css(parent)
  const snapshot = await loadSnapshot()
  const system = snapshot.providers?.system?.data || {}
  const used = Math.max(0, Number(system.totalMemoryBytes || 0) - Number(system.freeMemoryBytes || 0))
  const pct = system.totalMemoryBytes ? Math.round((used / system.totalMemoryBytes) * 100) : 0
  root.innerHTML = \`
    <h3>System</h3>
    <div class="row"><span class="muted">Host</span><strong>\${system.hostname || "local"}</strong></div>
    <div class="row"><span class="muted">Memory</span><strong>\${pct}%</strong></div>
    <div class="row"><span class="muted">Used</span><strong>\${bytes(used)}</strong></div>
    <div class="row"><span class="muted">CPU</span><strong>\${system.cpuCount || 0} cores</strong></div>
  \`
}`
  },
  {
    col: 5,
    cols: 7,
    id: "localhost",
    name: "Localhost Apps",
    row: 0,
    rows: 3,
    renderer: `async (parent) => {
${BASE_RENDERER_HELPERS}
  const root = css(parent)
  const snapshot = await loadSnapshot()
  const probes = snapshot.providers?.localhost_http?.data?.reachable || []
  root.innerHTML = "<h3>Localhost</h3>" + (probes.length ? probes.slice(0, 8).map((p) => \`
    <a class="row" href="\${p.url}" target="_blank" rel="noreferrer"><span>\${p.title || p.url}</span><strong>\${p.status}</strong></a>
  \`).join("") : '<p class="muted">No reachable local HTTP surfaces.</p>')
}`
  },
  {
    col: 0,
    cols: 6,
    id: "lm-studio",
    name: "LM Studio",
    row: 3,
    rows: 3,
    renderer: `async (parent) => {
${BASE_RENDERER_HELPERS}
  const root = css(parent)
  const snapshot = await loadSnapshot()
  const provider = snapshot.providers?.lm_studio || {}
  const models = provider.data?.models || []
  root.innerHTML = \`
    <h3>LM Studio <span class="pill \${provider.status === "available" ? "ok" : "warn"}">\${provider.status || "unknown"}</span></h3>
    \${models.length ? models.slice(0, 8).map((m) => \`<div class="row"><span>\${m.id}</span><strong>\${m.ownedBy || m.object || ""}</strong></div>\`).join("") : \`<p class="muted">\${provider.reason || "No loaded models detected."}</p>\`}
  \`
}`
  },
  {
    col: 6,
    cols: 6,
    id: "codex",
    name: "Codex",
    row: 3,
    rows: 3,
    renderer: `async (parent) => {
${BASE_RENDERER_HELPERS}
  const root = css(parent)
  const snapshot = await loadSnapshot()
  const proc = snapshot.providers?.codex?.data?.processes || []
  root.innerHTML = "<h3>Codex</h3>" + (proc.length ? proc.slice(0, 8).map((p) => \`
    <div class="row"><span>\${p.name}</span><strong>PID \${p.pid}</strong></div>
  \`).join("") : '<p class="muted">No Codex processes detected.</p>')
}`
  },
  {
    col: 0,
    cols: 6,
    id: "ports",
    name: "Ports",
    row: 6,
    rows: 3,
    renderer: `async (parent) => {
${BASE_RENDERER_HELPERS}
  const root = css(parent)
  const snapshot = await loadSnapshot()
  const ports = snapshot.providers?.ports?.data?.localhost || []
  root.innerHTML = "<h3>Listening Ports</h3>" + ports.slice(0, 10).map((p) => \`
    <div class="row"><span>:\${p.port} \${p.name || ""}</span><strong>PID \${p.pid}</strong></div>
  \`).join("")
}`
  },
  {
    col: 6,
    cols: 6,
    id: "sqlite",
    name: "SQLite",
    row: 6,
    rows: 3,
    renderer: `async (parent) => {
${BASE_RENDERER_HELPERS}
  const root = css(parent)
  const snapshot = await loadSnapshot()
  const dbs = snapshot.providers?.sqlite?.data?.inspected || []
  root.innerHTML = "<h3>SQLite</h3>" + (dbs.length ? dbs.slice(0, 8).map((db) => \`
    <div class="row"><span>\${db.path}</span><strong>\${db.inspection?.tables?.length || 0} tables</strong></div>
  \`).join("") : '<p class="muted">No SQLite files found.</p>')
}`
  }
];

function spaceManifestYaml() {
  const now = new Date().toISOString();

  return [
    "schema: spaces/v2",
    `id: ${MISSION_CONTROL_SPACE_ID}`,
    "title: Mission Control",
    "icon: space_dashboard",
    'icon_color: "#6ee7b7"',
    `created_at: ${now}`,
    `updated_at: ${now}`,
    "agent_instructions: |",
    "  This space is the local mission-control surface for the user's PC and development runtime.",
    "  Use space.missionControl helpers for live telemetry, registered app control, local probes, and config checks.",
    "layout:",
    ...WIDGETS.map((widget) => `  ${widget.id}:\n    col: ${widget.col}\n    row: ${widget.row}\n    cols: ${widget.cols}\n    rows: ${widget.rows}`)
  ].join("\n") + "\n";
}

async function pathExists(path) {
  try {
    await globalThis.space.api.fileInfo(path);
    return true;
  } catch {
    return false;
  }
}

export async function ensureMissionControlSpace(options = {}) {
  if (!globalThis.space?.api?.fileWrite) {
    throw new Error("space.api.fileWrite is not available.");
  }

  const rootPath = `~/spaces/${MISSION_CONTROL_SPACE_ID}/`;
  const manifestPath = `${rootPath}space.yaml`;
  const shouldWrite = options.reset === true || !(await pathExists(manifestPath));

  if (shouldWrite) {
    await globalThis.space.api.fileWrite({
      files: [
        {
          content: spaceManifestYaml(),
          path: manifestPath
        },
        ...WIDGETS.map((widget) => ({
          content: widgetYaml(widget),
          path: `${rootPath}widgets/${widget.id}.yaml`
        }))
      ]
    });
  }

  await import("/mod/_core/spaces/store.js");

  if (options.open === false) {
    return {
      id: MISSION_CONTROL_SPACE_ID,
      installed: shouldWrite,
      path: rootPath
    };
  }

  if (!globalThis.space?.spaces?.openSpace) {
    throw new Error("space.spaces.openSpace is not available.");
  }

  return globalThis.space.spaces.openSpace(MISSION_CONTROL_SPACE_ID, {
    replace: options.replace === true
  });
}
