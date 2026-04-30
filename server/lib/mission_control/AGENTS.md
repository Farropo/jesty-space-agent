# AGENTS

## Purpose

`server/lib/mission_control/` owns the backend side of Mission Control.

This subtree is the narrow OS boundary for facts and actions that the browser cannot safely perform itself: local process and port inspection, localhost health probes, LM Studio detection, SQLite read-only inspection, Windows service visibility, Docker diagnostics, network counters, and registered-app lifecycle control.

Documentation is top priority for this subtree. After any change under `server/lib/mission_control/` or to any `mission_control_*` API contract, update this file, `server/api/AGENTS.md`, and the matching supplemental documentation module docs in the same session.

## Ownership

This subtree owns:

- `config.js`: Mission Control user config normalization, storage under `~/conf/mission-control.json`, and audit append writes under `~/hist/mission-control.jsonl`.
- `local_url.js`: localhost-only HTTP URL normalization and validation.
- `service.js`: thin snapshot orchestration and public service exports for the API adapters.
- `providers/`: modular provider and app-control implementations for OS facts and actions.

Endpoint files under `server/api/mission_control_*.js` are thin adapters over this library. Frontend files under `_core/mission-control/` own presentation and browser runtime helpers.

## Provider Contract

Providers are best-effort. Each provider returns a normalized envelope:

- `status`: `available`, `degraded`, or `unavailable`
- `available`: boolean
- `data`: provider-specific plain JSON
- `reason`: present when the provider is degraded or unavailable

Current providers are Windows-first:

- `system`
- `processes`
- `ports`
- `localhost_http`
- `lm_studio`
- `sqlite`
- `windows_services`
- `docker`
- `network`
- `codex`

Provider failures must be caught and represented in the provider envelope. A failed optional tool such as Docker, PowerShell, Python, or LM Studio should degrade one provider, not fail the whole snapshot.

## Config And Safety Contract

Config is authenticated user state, not repo state.

Current config path:

- `~/conf/mission-control.json`

Current audit path:

- `~/hist/mission-control.jsonl`

Registered apps are normalized to explicit fields: `id`, `label`, `cwd`, `executable`, `args`, `env`, `healthUrl`, `stopMode`, and `tags`.

Frontend-only secrets such as `modelPreferences.apiKey` may be present in config, but the browser should encrypt them with `space.utils.userCrypto` before writing when user crypto is available. The backend stores and returns the value as opaque text; it must not need the OpenRouter key for Mission Control's current OS inspection and app-control work.

Safety rules:

- never accept raw shell text from the UI
- only registered app ids can be started, stopped, or restarted
- app starts use `spawn(..., { shell: false })`
- probes must pass `local_url.js` and are limited to `http` or `https` localhost URLs
- external PID stop requires explicit confirmation and must still match the registered executable or cwd signature
- every start, stop, restart, and config update should append an audit entry
- OpenRouter and other API keys must not be committed or written into repo-owned defaults

## Development Guidance

- keep endpoint modules thin; add provider and app-control logic here
- preserve plain JSON response shapes that do not collide with router HTTP response keys at the endpoint top level
- prefer structured OS interfaces where available, then small bounded command probes with timeouts
- keep filesystem scans bounded and defensive; SQLite inspection must stay read-only
- add unit or live HTTP coverage when validation, provider normalization, local URL policy, config shape, or app-control behavior changes
