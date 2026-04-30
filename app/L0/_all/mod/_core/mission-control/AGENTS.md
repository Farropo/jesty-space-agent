# AGENTS

## Purpose

`_core/mission-control/` owns the first-party local machine dashboard for the user's PC and development environment.

It provides a bundled Space template installed under the authenticated user's `~/spaces/mission-control/` folder, dashboard bootstrap that keeps that Space present, a browser runtime API at `space.missionControl`, and a routed inspector fallback at `#/mission-control?inspect=1`. The frontend stays the primary product surface; server APIs are narrow OS-inspection and registered-app control boundaries that the browser cannot enforce safely by itself.

Documentation is top priority for this module. After any change under `_core/mission-control/`, update this file, the matching server docs when API behavior changes, and the supplemental documentation module docs in the same session.

## Ownership

This module owns:

- `view.html`: routed Mission Control inspector and control surface.
- `store.js`: Alpine store, `space.missionControl` runtime namespace, API calls, refresh loop, config editor, and app action orchestration.
- `secrets.js`: frontend-only encryption/decryption helpers for Mission Control config secret fields.
- `mission-control.css`: route-local responsive layout and operational dashboard styling.
- `space-template.js`: installer for the bundled `mission-control` Space template assets.
- `space-template/`: static `space.yaml` and `widgets/*.yaml` copied into `~/spaces/mission-control/`.
- `widget-runtime.js`: shared widget renderer helpers for snapshots, styling, and formatting.
- `dashboard-bootstrap.html` and `dashboard-bootstrap.js`: hidden dashboard bootstrap that installs the bundled Space and emits `space:spaces-changed`.
- `ext/html/_core/dashboard/content_start/mission-control-space-bootstrap.html`: dashboard extension adapter for the bootstrap component.
- `ext/skills/mission-control/SKILL.md`: page-context skill that teaches agents the safe Mission Control helpers.

The paired backend contract is owned by `server/lib/mission_control/` and the `mission_control_*` API endpoints under `server/api/`.

## Local Contracts

Current route and extension contract:

- the primary user-facing surface is the `mission-control` Space
- `#/mission-control` installs and opens the bundled Space by default
- `#/mission-control?inspect=1` keeps the inspector route open for config and provider debugging
- the dashboard bootstrap installs the Space without opening it and notifies listeners with `space:spaces-changed`
- the route emits an `x-context` tag with `mission-control` so the module skill can auto-load on this surface
- `view.html` owns page structure only; provider normalization, app control, and persistence are not duplicated in inline bindings
- buttons that start, stop, or restart apps must stay disabled when an app is not registered or when another action is already running

Current runtime namespace:

- `space.missionControl.snapshot({ cacheMs?, force? })`
- `space.missionControl.refresh(options)`
- `space.missionControl.config()`
- `space.missionControl.startApp(appId)`
- `space.missionControl.stopApp(appId, { confirmed?, pid? })`
- `space.missionControl.restartApp(appId, { confirmed?, pid? })`
- `space.missionControl.probe(url)`
- `space.missionControl.ensureSpace(options)`
- `space.missionControl.installSpace(options)`

The runtime namespace returns plain JSON and does not expose shell execution. App-control helpers accept app ids, not command text.

## Space Template Contract

`space-template.js` installs the bundled space into `~/spaces/mission-control/` through normal authenticated app-file writes. It copies static YAML assets from `space-template/` instead of generating YAML from JavaScript strings, and writes `data/template-version.txt` so older generated templates can be upgraded once.

Current widgets cover:

- system load
- localhost apps and probes
- LM Studio
- Codex processes
- listening ports
- SQLite files

Widget renderers import the route store when needed and call `space.missionControl.snapshot(...)`. They should stay read-only and should not duplicate backend provider logic.

## Development Guidance

- keep this module a Mission Control UI and widget package, not a generic command runner
- use `space.api.call(...)` through the store helpers instead of ad hoc fetch code
- keep provider failures visible as degraded or unavailable states instead of crashing the route
- keep user config editing explicit and local to the authenticated user's app files through the backend config API
- do not store OpenRouter or other secrets in repo-tracked files; `modelPreferences.apiKey` is encrypted through `space.utils.userCrypto` before config writes when user crypto is available
- if route, runtime namespace, app-control behavior, widget layout, or provider semantics change, update this file and the matching supplemental docs
