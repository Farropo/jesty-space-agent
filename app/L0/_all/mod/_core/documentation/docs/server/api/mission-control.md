# Mission Control APIs

Mission Control APIs expose the narrow server boundary needed by the local dashboard.

## Primary Sources

- `server/api/AGENTS.md`
- `server/api/mission_control_snapshot.js`
- `server/api/mission_control_config_get.js`
- `server/api/mission_control_config_update.js`
- `server/api/mission_control_app_start.js`
- `server/api/mission_control_app_stop.js`
- `server/api/mission_control_app_restart.js`
- `server/api/mission_control_probe.js`
- `server/lib/mission_control/AGENTS.md`

## Endpoints

Current authenticated endpoints:

- `mission_control_snapshot`
- `mission_control_config_get`
- `mission_control_config_update`
- `mission_control_app_start`
- `mission_control_app_stop`
- `mission_control_app_restart`
- `mission_control_probe`

`mission_control_snapshot` returns a provider map plus generated timestamp and config summary. Provider failures are represented as `degraded` or `unavailable` entries rather than route-wide failures.

`mission_control_config_get` and `mission_control_config_update` read and write the current user's `~/conf/mission-control.json` through normalized config helpers.

App action endpoints accept app ids, not command text. Their JSON response wraps the lifecycle result in `operation` to avoid colliding with the router's HTTP response-shape keys.

`mission_control_probe` accepts only localhost `http` or `https` URLs and returns the probe result under `probe`.

## Safety Contract

- no anonymous access
- no arbitrary shell command API
- only registered app ids are actionable
- app starts use `shell: false`
- external PID stops require confirmation plus registered executable or cwd signature matching
- mutations append audit entries under `~/hist/mission-control.jsonl`
- optional OS tooling failures degrade individual providers, not the full snapshot
