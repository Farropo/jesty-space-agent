# AGENTS

## Purpose

`server/lib/mission_control/providers/` owns the individual Mission Control data and action providers.

Each file should expose one narrow provider family and return normalized plain JSON through `providerResult(...)` from `common.js`. Provider failures must be caught locally and represented as `degraded` or `unavailable`; they must not fail the full Mission Control snapshot unless the caller explicitly requested a single action such as starting or stopping a registered app.

## Ownership

- `common.js`: shared provider envelope, PowerShell JSON helper, numeric coercion, and small constants.
- `system.js`: OS, memory, disk, and network counters.
- `processes.js`: Windows process discovery and process signature helpers.
- `ports.js`: listening TCP port discovery.
- `localhost_http.js`: localhost-only HTTP probes.
- `lm_studio.js`: LM Studio process/API detection and model parsing.
- `sqlite.js`: bounded SQLite discovery and read-only schema inspection.
- `windows_services.js`: Windows service state.
- `docker.js`: Docker CLI/daemon diagnostics.
- `codex.js`: Codex process detection.
- `apps.js`: registered-app status, tracked child processes, start/stop/restart actions, and action audit entries.

## Development Guidance

- keep OS command calls bounded with timeouts and maximum buffers
- prefer structured APIs such as PowerShell objects, Docker JSON output, and read-only SQLite connections
- never add generic shell execution or arbitrary command text
- keep app actions registry-based and use `spawn(..., { shell: false })`
- when adding a provider, include focused tests for provider normalization and degraded behavior
