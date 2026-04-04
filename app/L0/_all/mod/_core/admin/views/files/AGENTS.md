# AGENTS

## Purpose

`_core/admin/views/files/` owns the firmware-backed admin file browser.

It is the admin surface for browsing, selecting, editing, copying, moving, deleting, renaming, and downloading app-rooted files through the authenticated file APIs.

Documentation is top priority for this surface. After any change under `views/files/`, update this file and any affected parent docs in the same session.

## Ownership

This surface owns:

- `panel.html`: file-browser UI
- `store.js`: navigation, selection, clipboard, dialogs, path memory, and file API orchestration
- `files.css`: file-browser-specific layout and styling on top of shared visual primitives

## File API Contract

This surface talks to the shared server file APIs through `space.api`.

Current behavior:

- the starting path is the authenticated user's home path `~/`
- paths are app-rooted and may use `~` shorthand where supported
- directory listing uses `space.api.fileList(...)`
- metadata checks use `space.api.fileInfo(...)`
- text reads and writes use `space.api.fileRead(...)` and `space.api.fileWrite(...)`
- delete, copy, and move actions use the corresponding `space.api` helpers
- files are downloaded from the browser surface; directories are navigated

Current editor rule:

- text editing is refused for files larger than `1 MB` based on `fileInfo(...)` metadata before the editor dialog opens

## UI And State Contract

`store.js` owns:

- editable current-path navigation
- Up, Home, and Refresh actions
- highlighted entry, selection, and per-directory scroll memory
- row-level overflow actions through the shared popover contract
- selection-summary actions when multiple paths are checked
- clipboard state for cut or copied items plus paste into the current folder
- shared dialogs for rename, delete confirmation, and text editing
- inline reporting for not-found and permission errors

## Development Guidance

- keep file-browser state and workflow logic centralized in `store.js`
- use shared visual primitives for buttons, popovers, cards, and dialogs instead of creating a second admin-only theme
- keep server permission rules authoritative; do not duplicate them in the browser beyond UI affordances
- if you change file-API expectations, update this file and the relevant server docs in the same session
