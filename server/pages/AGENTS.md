# AGENTS

## Purpose

`server/pages/` contains the server-owned HTML shells and public shell assets.

These files define entry shells and pre-auth presentation only. They should not become a second frontend application runtime.

Documentation is top priority for this subtree. After any change under `server/pages/`, update this file and any affected parent or linked module docs in the same session.

## Ownership

Current page shells:

- `index.html`: authenticated root shell for `/`
- `admin.html`: authenticated admin shell for `/admin`
- `login.html`: public login shell for `/login`

Current public shell assets:

- `res/space-backdrop.css`
- `res/space-backdrop.js`
- login-shell image assets under `res/`

## Shell Contracts

`index.html`:

- loads shared framework CSS and `/mod/_core/framework/js/initFw.js`
- keeps the body minimal and exposes exactly the `html/body/start` extension anchor

`admin.html`:

- loads the same framework bootstrap with `?maxLayer=0`
- declares `meta[name="space-max-layer"]` with content `0`
- keeps the body minimal and exposes exactly the `page/admin/body/start` extension anchor

`login.html`:

- is public and must not depend on authenticated `/mod/...` assets
- owns the login flow, guest creation flow, and pre-auth layout
- keeps login-specific styling and motion local

## Public Asset Mirroring

`/login` cannot use authenticated module assets, so `server/pages/res/space-backdrop.css` and `server/pages/res/space-backdrop.js` mirror the shared visual backdrop for public-shell use.

Rules:

- keep the mirrored public backdrop aligned with `_core/visual`
- if the shared backdrop visuals or runtime behavior change, review and update these mirrored files in the same session
- keep public-shell assets under `server/pages/res/` instead of embedding large data blobs into page HTML

## Development Guidance

- keep page shells thin and static
- expose stable anchors and let browser modules own dynamic composition
- keep pre-auth shell behavior local to `login.html` and `server/pages/res/`
- do not hardwire authenticated app structure into page shells when an extension seam can own it
- if page-shell contracts or mirrored public assets change, update this file and the related app docs
