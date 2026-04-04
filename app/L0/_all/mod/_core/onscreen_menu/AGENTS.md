# AGENTS

## Purpose

`_core/onscreen_menu/` owns the routed top-right page menu.

It is a thin shell extension that mounts into the router shell, exposes Admin and Logout actions, and preserves the current routed URL when jumping into `/admin`.

Documentation is top priority for this module. After any change under `_core/onscreen_menu/`, update this file and any affected parent docs in the same session.

## Ownership

This module owns:

- `ext/_core/router/shell_start/menu.html`: thin shell-start extension
- `onscreen-menu.css`: menu-specific styling layered on the shared topbar primitives

## Current Contract

Current behavior:

- the menu mounts through `_core/router/shell_start`
- the Admin action builds `/admin?url=<current-path-search-hash>` so the admin iframe opens on the current app location
- navigation prefers `window.top` and falls back to the current window
- Logout navigates to `/logout`

## Development Guidance

- keep this module thin; it should stay a routed shell affordance, not a second app shell
- prefer shared topbar and menu styles from `_core/visual/chrome/topbar.css`
- if the router shell seam or admin handoff contract changes, update this file and the router or admin docs too
