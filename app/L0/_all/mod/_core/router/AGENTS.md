# AGENTS

## Purpose

`_core/router/` owns the authenticated root app shell.

It mounts into the `/` page shell, resolves hash routes into module views, exposes the routed extension anchors, persists per-route scroll position, and publishes the router contract on `space.router` and Alpine `$router`.

Documentation is top priority for this module. After any change under `_core/router/`, update this file and any affected parent docs in the same session.

## Ownership

This module owns:

- `ext/html/body/start/router-page.html`: thin adapter that mounts the router into the root page shell
- `view.html`: the routed shell layout, backdrop mount point, route outlet, and shell or overlay extension anchors
- `route-path.js`: hash-route parsing, normalization, search-param handling, and view-path resolution
- `router-store.js`: router store, route loading lifecycle, scroll persistence, and error rendering
- `router-page.js`: router entry module and static backdrop install
- `router.css`: shell layout and routed-stage styling

## Route Contract

The router is hash-based.

Current route rules:

- the default route is `#/dashboard`
- a one-segment route such as `#/dashboard` resolves to `/mod/_core/dashboard/view.html`
- a multi-segment route such as `#/author/repo/path` resolves to `/mod/author/repo/path/view.html`
- if the final segment already ends in `.html`, the router resolves directly to that file under `/mod/...`
- query parameters remain attached to the resolved route target

`space.router` and Alpine `$router` currently expose:

- `createHref(...)`
- `goTo(...)`
- `replaceTo(...)`
- `back(...)`
- `goBack(...)`
- `getParam(...)`
- `scrollTo(...)`
- `scrollToTop(...)`
- `scrollToElement(...)`

`router-store.js` persists per-route scroll positions in `sessionStorage` under `space.router.scrollPositions`.

## Shell And Extension Seams

`view.html` owns the routed shell and its stable extension points.

Current anchors:

- `_core/router/shell_start`
- `_core/router/shell_end`
- `page/router/route/start`
- `page/router/route/end`
- `page/router/overlay/start`
- `page/router/overlay/end`

The routed overlay anchors are the correct place for floating routed UI such as `_core/onscreen_agent/`. Do not hardwire overlay features directly into `view.html` when an extension seam already exists.

## Development Guidance

- use extension anchors for shell-level additions instead of editing `view.html` directly whenever possible
- keep route resolution rules centralized in `route-path.js`
- keep route lifecycle, scroll memory, and `space.router` behavior centralized in `router-store.js`
- routed feature modules should ship their own `view.html` and let the router mount them
- if you add or rename a stable router seam, update this file and `/app/AGENTS.md`
