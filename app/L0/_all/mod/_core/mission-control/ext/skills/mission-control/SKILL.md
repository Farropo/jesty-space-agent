---
name: Mission Control
description: Inspect local PC telemetry, registered localhost apps, LM Studio, SQLite, services, Docker, and Codex status
metadata:
  when:
    tags:
      - mission-control
  loaded:
    tags:
      - mission-control
  placement: system
---

Use this skill on the Mission Control route or inside the Mission Control Space.

runtime
- `space.missionControl.snapshot({ force?, cacheMs? })` returns the live backend snapshot.
- `space.missionControl.config({ decryptSecrets?: true })` reads `~/conf/mission-control.json`.
- `space.missionControl.startApp(id)`, `stopApp(id, options?)`, and `restartApp(id, options?)` act only on registered app ids.
- `space.missionControl.probe(url)` accepts only localhost http(s) URLs.
- `space.missionControl.ensureSpace()` installs and opens `~/spaces/mission-control`.

safety
- Do not invent raw shell commands for app control.
- If a user wants a start/stop button for an app, add it to Mission Control config first with executable, args, cwd, and optional healthUrl.
- Keep `modelPreferences.apiKey` frontend-only; the store encrypts it as `userCrypto:` before saving when user crypto is available.
- Treat provider status `degraded` or `unavailable` as telemetry limits, not as app failure.
