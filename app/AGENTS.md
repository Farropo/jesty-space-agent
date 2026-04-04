# AGENTS

## Purpose

`app/` is the primary Space Agent runtime.

Keep agent orchestration, prompt construction, tool flow, state management, user interaction, and optimistic UX in the browser whenever possible. Server-backed work in this tree should be browser clients for explicit server APIs, not server-side orchestration leaking into the frontend.

This is one of the five core docs. It owns app-wide architecture, composition rules, and development principles. Detailed module behavior belongs in deeper module-local docs.

Documentation is top priority for this area. After any change under `app/` or any app-facing contract change owned here, update this file and the closest owning module `AGENTS.md` files in the same session before finishing.

## Documentation Hierarchy

`/app/AGENTS.md` stays high-level. Module-local docs own the implementation details for major frontend modules.

Current module-local docs in the app tree:

- `app/L0/_all/mod/_core/framework/AGENTS.md`
- `app/L0/_all/mod/_core/router/AGENTS.md`
- `app/L0/_all/mod/_core/visual/AGENTS.md`
- `app/L0/_all/mod/_core/admin/AGENTS.md`
- `app/L0/_all/mod/_core/admin/views/agent/AGENTS.md`
- `app/L0/_all/mod/_core/admin/views/files/AGENTS.md`
- `app/L0/_all/mod/_core/admin/views/modules/AGENTS.md`
- `app/L0/_all/mod/_core/chat/AGENTS.md`
- `app/L0/_all/mod/_core/onscreen_agent/AGENTS.md`
- `app/L0/_all/mod/_core/onscreen_menu/AGENTS.md`

Update rules:

- update the nearest module doc when you change a documented module
- update this file only when the app-wide contract, ownership map, composition model, or shared frontend conventions changed
- keep implementation-specific detail out of this file when a deeper doc can own it

## Structure

The browser runtime is organized into three layers:

- `L0/`: immutable firmware changed through updates
- `L1/`: runtime-editable group customware
- `L2/`: runtime-editable user customware

Current browser entry surfaces are served from `server/pages/`:

- `/`: main app shell from `server/pages/index.html`
- `/admin`: admin shell from `server/pages/admin.html`, with `meta[name="space-max-layer"]` set to `0` so module and extension resolution stay `L0`-only
- `/login`: standalone public login screen from `server/pages/login.html`
- `/logout`: server-side logout action that clears the session cookie and redirects to `/login`

Current major first-party modules under `app/L0/_all/mod/_core/`:

- `framework/`: frontend bootstrap, runtime primitives, component loader, extension system, shared utilities
- `visual/`: shared visual language, canvas, chrome, buttons, dialog helpers, and conversation rendering primitives
- `router/`: root routed shell for the authenticated app
- `admin/`: firmware-backed admin shell and panels
- `chat/`: standalone chat surface and legacy reference module
- `onscreen_agent/`: floating routed overlay agent
- `onscreen_menu/`: top-right routed shell menu extension
- `dashboard/` and `space/`: current routed feature modules under the router

## Layer Rules And Module Model

- `L0` is firmware and should stay update-driven
- `L1` contains per-group customware; `_all` and `_admin` are special groups
- `L2` contains per-user customware; users should only write inside their own `L2/<username>/`
- `app/L1` and `app/L2` are transient runtime state and are gitignored; do not document repo-owned example content there as if it were durable framework structure
- `app/L2/<username>/user.yaml` stores user metadata such as `full_name`; auth state lives under `app/L2/<username>/meta/`
- groups may include users and other groups, and may declare managers that can write to that group's `L1` area
- read permissions are explicit: a user can read their own `L2/<username>/`, and can read `L0/<group>/` and `L1/<group>/` for groups they belong to
- write permissions are explicit: a user can write their own `L2/<username>/`; a user can write `L1/<group>/` only when they manage that group directly or through a managing-group include chain; members of `_admin` can write any `L1/` and `L2/` path; nobody writes `L0/`
- modules are the supported browser delivery and extension unit
- each group or user owns a `mod/` folder, and module contents are namespaced as `mod/<author>/<repo>/...`
- browser-facing code and assets should normally be delivered through `/mod/...`
- page shells may clamp module and extension resolution with `meta[name="space-max-layer"]`; the current admin shell sets `0`
- authenticated app-file APIs operate on app-rooted paths such as `L2/alice/user.yaml` or `/app/L2/alice/user.yaml`, and supported APIs may use `~` or `~/...` as shorthand for the authenticated user's `L2/<username>/...`
- first-party application development should happen primarily under `app/L0/_all/mod/_core/`
- use `L1` and `L2` for layered overrides and customware behavior, not as the main home for repo-owned first-party features

## Frontend Composition Model

The frontend is built as a chain of shells, modules, and extension seams.

Current boot flow:

1. A page shell in `server/pages/` loads shared framework CSS and `/mod/_core/framework/js/initFw.js`.
2. The shell exposes one top-level HTML anchor in the body.
3. `initFw.js` installs the runtime, extension system, Alpine helpers, and shared bootstrap behavior.
4. The first mounted module owns the next seam and exposes more anchors or wrapped functions.
5. Other modules compose into those explicit seams instead of patching private internals.

Current entry anchors:

- `/` exposes `html/body/start`, which mounts `_core/router`
- `/admin` exposes `page/admin/body/start`, which mounts `_core/admin`

Default composition guidance:

- keep page shells small
- mount real features through thin `ext/...` adapter files
- let the owning module expose the next seam
- add explicit extension points when downstream customization is realistic

## Extension And Component Contracts

There are two primary extension styles in the frontend runtime.

HTML extension anchors:

- declare a seam with `<x-extension id="some/path">`
- matching HTML files live at `mod/<author>/<repo>/ext/some/path/*.html`
- thin extension files should usually mount the real component from the module root instead of containing the entire feature directly
- root page anchors such as `html/body/start` and `page/admin/body/start` are fixed shell contracts; module-owned anchors should be named after the owning module path, for example `_core/router/shell_start`

JS extension hooks:

- use `space.extend(import.meta, async function name() {})` for behavior seams
- wrapped functions expose `/start` and `/end` hook points
- wrapped functions become async and should be awaited by callers
- use `callJsExtensions("name", data)` only when the seam is an explicit event rather than a function lifecycle

Resolution and overrides:

- `/api/extensions_load` resolves extension files from the accessible `L0 -> L1 -> L2` inheritance chain
- `maxLayer` constrains only module and extension resolution
- identical module-relative extension file paths override lower-ranked layers
- different filenames under the same extension point compose together
- prefer additive composition before full same-path replacement

`<x-component>` contract:

- components may be full HTML documents or fragments
- the loader mounts styles, module scripts, and body nodes, then recursively loads nested `<x-component>` tags
- component HTML should stay declarative and bind to stores instead of carrying dense inline logic
- import a feature's store module in the component that owns the feature, not in unrelated parent shells

## Store And Runtime Model

The default frontend pattern is Alpine plus store-backed modules.

Ownership split:

- component HTML owns structure and Alpine bindings
- stores own state, persistence, async work, server calls, and orchestration
- module utilities own rendering helpers, transforms, and protocol logic that would make the store too dense
- `space` owns shared runtime APIs and explicit cross-feature namespaces

Store guidance:

- create stores with `space.fw.createStore(name, model)` on framework-backed pages
- use `init()` for one-time startup and `mount(refs)` plus `unmount()` for DOM-bound lifecycle
- pass DOM references with `x-ref`; do not make stores scan the document when direct refs will do
- gate store-dependent UI with `x-data` plus `template x-if="$store.<name>"`
- keep store names aligned with the exported binding and the `$store.<name>` key

Runtime guidance:

- framework-backed pages that boot through `/mod/_core/framework/js/initFw.js` already initialize the runtime before feature modules mount
- `globalThis.space` is scoped to the current window or iframe only; do not publish it into other browsing contexts
- use `space.api` for authenticated backend calls
- use `space.utils.markdown` and `space.utils.yaml` for lightweight frontend parsing owned by browser modules
- browser storage is for small non-authoritative UI state; persistent user state belongs in app files or explicit backend APIs

Legacy note:

- `_core/chat` is a standalone page-oriented reference module and still uses direct `createStore()` plus `localStorage`; do not treat that older pattern as the default for new router-hosted work

## Visual Direction

Space Agent frontend work should look like one deliberate system rather than a mix of unrelated component-library defaults.

- minimal first: solve hierarchy with spacing, alignment, type scale, and one strong surface before adding extra chrome
- use the semantic color tokens from `app/L0/_all/mod/_core/framework/css/colors.css`
- use the shared visual system in `app/L0/_all/mod/_core/visual/` before inventing feature-local backgrounds, buttons, dialogs, or menus
- keep the dark space direction calm and readable; avoid noisy sci-fi chrome and neon overload
- if a style pattern appears in more than one place, move it into `_core/visual`
- public shells that cannot load authenticated `/mod/...` assets should keep mirrored local assets aligned with the shared system rather than re-inventing a second design language

Detailed visual subsystem rules now live in `app/L0/_all/mod/_core/visual/AGENTS.md`.

## App Development Principles

- build new first-party features as modules under `app/L0/_all/mod/_core/<feature>/`
- treat page shells as extension roots, not as the application body
- keep extension files thin and keep real implementation in ordinary module files
- if another feature needs to modify owned behavior, expose a seam in the owner instead of reaching into private internals
- when a style, helper, or runtime contract will be reused by multiple modules, move it into `_core/visual`, `_core/framework`, or another clearly shared owning module
- do not grow `server/pages/*.html` beyond shell concerns when modules and extension anchors can own the composition
- do not build new repo-owned first-party app features directly inside transient `L1` or `L2` customware

## Current Major Module Owners

- `framework/` owns frontend bootstrap and runtime primitives; see `app/L0/_all/mod/_core/framework/AGENTS.md`
- `router/` owns the authenticated app shell, routing, and routed extension anchors; see `app/L0/_all/mod/_core/router/AGENTS.md`
- `visual/` owns the shared visual system and reusable presentation primitives; see `app/L0/_all/mod/_core/visual/AGENTS.md`
- `admin/` owns the firmware-backed admin shell, panels, and admin-specific skills/runtime glue; see `app/L0/_all/mod/_core/admin/AGENTS.md`
- `admin/views/agent/` owns the admin-side agent surface; see `app/L0/_all/mod/_core/admin/views/agent/AGENTS.md`
- `admin/views/files/` owns the firmware-backed file browser; see `app/L0/_all/mod/_core/admin/views/files/AGENTS.md`
- `admin/views/modules/` owns the firmware-backed modules panel; see `app/L0/_all/mod/_core/admin/views/modules/AGENTS.md`
- `chat/` owns the standalone reference chat surface; see `app/L0/_all/mod/_core/chat/AGENTS.md`
- `onscreen_agent/` owns the floating routed overlay agent; see `app/L0/_all/mod/_core/onscreen_agent/AGENTS.md`
- `onscreen_menu/` owns the routed shell menu extension; see `app/L0/_all/mod/_core/onscreen_menu/AGENTS.md`

## Guidance

- keep root HTML shells thin and static; session gating belongs in the server router, not in inline frontend boot code
- cache empty extension lookups as valid results; a missing extension point should not cause repeated polling
- because extension lookups are cached in memory, adding new `ext/...` files often requires a refresh before the running page discovers them
- browser-side file changes still require a manual browser refresh; live reload is not wired into the app runtime yet
- when you add or change a stable app seam, update the owning local doc and this file if the app-wide composition model changed
