# AGENTS

## Purpose

`packaging/` contains native app hosts and the packaging surface around them.

Keep this file scoped to native hosting and packaging behavior. Repo-wide packaging surface and install commands still belong in `/AGENTS.md`.

This is one of the five core docs. It owns the packaging subtree contract. If platform-specific packaging areas later grow their own `AGENTS.md` files, those local docs should own the detailed implementation guidance while this file stays focused on packaging-wide structure and principles.

Documentation is top priority for this area. After any change under `packaging/` or any packaging contract change owned here, update this file in the same session before finishing.

## Current State

`packaging/desktop/` holds the current Electron desktop host.

`packaging/desktop/preload.js` exposes the desktop bridge as `spaceDesktop`.

`packaging/package.json` holds packaging-only dependencies so the root install can stay lean.

`packaging/scripts/` holds packaging entrypoints and shared build helpers. Multiword operation entrypoints use object-first hyphen naming such as `host-package.js`, `linux-package.js`, and `desktop-dev-run.js`.

`packaging/resources/` holds shared packaging resources.

`packaging/platforms/` holds OS-specific packaging assets and metadata.

Native hosts should remain thin:

- start the local server runtime
- open the browser app inside the host surface
- preserve platform-neutral behavior here when possible

## Guidance

- avoid moving app logic into native hosts
- keep packaging automation in `packaging/scripts/`
- keep multiword packaging script filenames object-first so related entrypoints sort together
- keep platform-specific packaging details in `packaging/platforms/`
- add future mobile-specific hosts alongside `packaging/desktop/`
- when native host behavior, preload bridges, packaging assets, or packaging entrypoints change, update this file in the same session
