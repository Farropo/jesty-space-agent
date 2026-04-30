export async function loadSnapshot() {
  if (!globalThis.space?.missionControl) {
    await import("/mod/_core/mission-control/store.js");
  }
  return globalThis.space.missionControl.snapshot({ cacheMs: 1500 });
}

export function css(parent) {
  parent.style.cssText = "width:100%;height:100%;box-sizing:border-box;overflow:auto;color:#edf5ff;background:#0d1827;border-radius:8px;padding:12px;font:13px/1.35 system-ui,Segoe UI,sans-serif;";
  const style = document.createElement("style");
  style.textContent = ".mcw h3{margin:0 0 10px;font-size:14px}.mcw .row{display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-top:1px solid rgba(151,188,255,.14)}.mcw .muted{color:rgba(225,236,255,.66)}.mcw strong{font-weight:700}.mcw a{color:#9bc7ff;text-decoration:none}.mcw .pill{display:inline-flex;border:1px solid rgba(151,188,255,.2);border-radius:999px;padding:2px 7px;color:#bcd3ff}.mcw .ok{color:#6ee7b7}.mcw .warn{color:#facc15}.mcw .bad{color:#fb7185}";
  parent.appendChild(style);
  const root = document.createElement("div");
  root.className = "mcw";
  parent.appendChild(root);
  return root;
}

export function bytes(value) {
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
