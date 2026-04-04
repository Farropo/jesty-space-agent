# AGENTS

## Purpose

`_core/admin/` owns the firmware-backed admin area.

It mounts into `/admin`, keeps admin UI assets on `L0`, provides the split admin-shell layout, and owns the current admin panels and admin-specific skill-loading runtime.

Documentation is top priority for this module. After any change under `_core/admin/`, update this file, any affected deeper admin docs, and any affected parent docs in the same session.

## Ownership

This module owns:

- `ext/page/admin/body/start/admin-shell.html`: thin adapter that mounts the admin shell into `server/pages/admin.html`
- `views/shell/`: split shell layout, tab state, and iframe orchestration
- `views/dashboard/`: dashboard and launch surface inside the admin pane
- `views/agent/`: admin-side agent surface
- `views/files/`: firmware-backed file browser
- `views/modules/`: firmware-backed modules panel
- `skills/`: top-level admin skill folders, each with `SKILL.md`
- `res/`: admin-local visual assets

Inactive area:

- `views/documentation/` exists on disk but is not currently mounted by the admin shell; do not document it as an active admin surface until the shell actually wires it in

## Shell Contract

The admin module is mounted only through the page-specific `page/admin/body/start` anchor.

Current shell responsibilities:

- `views/shell/shell.html` owns the split two-pane layout
- `views/shell/shell.js` owns split sizing, drag-resize behavior, orientation-dependent layout, `?url=` startup handling, and leave-admin navigation back into the current iframe URL
- `views/shell/page.js` owns admin tabs, quick actions, tab keyboard behavior, and cached `space.api.userSelfInfo()` state
- the active admin tab is remembered in `sessionStorage`

`/admin` runs with `maxLayer=0`, so all module and extension fetches for the admin UI stay firmware-backed even though app-file APIs still work across normal readable or writable layers.

## Admin Sub-Areas

Detailed docs for deeper admin surfaces live here:

- `app/L0/_all/mod/_core/admin/views/agent/AGENTS.md`
- `app/L0/_all/mod/_core/admin/views/files/AGENTS.md`
- `app/L0/_all/mod/_core/admin/views/modules/AGENTS.md`

High-level ownership:

- `views/dashboard/` is the lightweight dashboard and launch surface
- `views/agent/` is the admin-side chat or execution surface and owns `space.admin.loadSkill(...)`
- `views/files/` is the firmware-backed file browser for app-rooted paths
- `views/modules/` is the firmware-backed module list and removal surface

## Skills Contract

Admin skills live under `skills/*/SKILL.md`.

Current rules:

- `views/agent/skills.js` discovers top-level skill folders by listing `L0/_all/mod/_core/admin/skills/`
- the admin agent prompt receives a compact catalog of those top-level skills
- the actual skill content is loaded on demand through `space.admin.loadSkill(name)`
- keep skill folders stable and top-level if they should appear in the catalog

## Development Guidance

- keep admin UI logic inside this module; do not spread admin-only behavior into unrelated modules
- keep admin assets local under `admin/res/` instead of borrowing from unrelated feature modules
- keep the admin shell firmware-backed; do not introduce writable-layer dependencies for the admin UI contract itself
- if you add tabs, change the shell seam, or change how skills are discovered, update this file and `/app/AGENTS.md`
