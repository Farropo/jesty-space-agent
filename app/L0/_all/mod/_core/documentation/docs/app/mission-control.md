# Mission Control

Mission Control is the first-party local machine dashboard built as a Space Agent module.

## Primary Sources

- `app/L0/_all/mod/_core/mission-control/AGENTS.md`
- `app/L0/_all/mod/_core/mission-control/view.html`
- `app/L0/_all/mod/_core/mission-control/store.js`
- `app/L0/_all/mod/_core/mission-control/space-template.js`
- `app/L0/_all/mod/_core/mission-control/space-template/space.yaml`
- `server/lib/mission_control/AGENTS.md`
- `server/api/AGENTS.md`

## Route And Runtime

The primary user-facing surface is the bundled `mission-control` Space.

The routed surface `#/mission-control` is now a bootstrap shortcut that installs and opens that Space. Use `#/mission-control?inspect=1` when the inspector route itself needs to stay open for config or provider debugging.

It publishes `space.missionControl` for route code, widgets, and agents:

- `snapshot({ cacheMs?, force? })`
- `config()`
- `startApp(appId)`
- `stopApp(appId, options)`
- `restartApp(appId, options)`
- `probe(url)`
- `ensureSpace(options)`

These helpers call explicit backend APIs. They do not expose arbitrary shell execution.

## Space Template

The bundled space installs under `~/spaces/mission-control/`.

The template copies static `space.yaml` plus YAML widgets for system load, localhost probes, LM Studio, Codex processes, listening ports, and SQLite files. It also writes `data/template-version.txt` so pre-static generated templates can be upgraded once. Widgets read through `space.missionControl.snapshot(...)` and should remain read-only views over the same provider data as the route.

The dashboard loads a hidden bootstrap component from the Mission Control module. That bootstrap installs the Space without opening it and emits `space:spaces-changed` so the dashboard Spaces launcher can refresh.

## Config And Safety

Mission Control app registry and preferences are stored as user app files through the backend config API, currently under `~/conf/mission-control.json`.

Registered apps are controlled by id only. The browser never sends raw shell commands. Local URL probes are limited to `http` or `https` localhost URLs, and app starts use the backend registry with `shell: false`.

OpenRouter model preferences may live in Mission Control config, but API keys must not be committed to the repo or shipped in module defaults. `modelPreferences.apiKey` is a frontend-only secret field; the Mission Control store encrypts it with `space.utils.userCrypto` before writing config when user crypto is available, and the backend treats it as opaque text.
