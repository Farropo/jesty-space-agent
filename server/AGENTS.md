# AGENTS

## Purpose

`server/` is the thin local infrastructure runtime.

It should not become the main application runtime. Keep browser concerns in `app/` and keep this tree focused on explicit infrastructure contracts that the browser or CLI needs.

This is one of the five core docs. It owns server-wide responsibilities, request flow, and infrastructure boundaries. Detailed subsystem contracts belong in deeper docs inside `server/`.

Documentation is top priority for this area. After any change under `server/` or any server contract change owned here, update this file and the closest owning subsystem `AGENTS.md` files in the same session before finishing.

## Documentation Hierarchy

`/server/AGENTS.md` stays high-level. Deeper docs own the technical details for major server subsystems.

Current subsystem-local docs in the server tree:

- `server/api/AGENTS.md`
- `server/router/AGENTS.md`
- `server/pages/AGENTS.md`
- `server/lib/customware/AGENTS.md`
- `server/lib/auth/AGENTS.md`
- `server/lib/file_watch/AGENTS.md`
- `server/lib/git/AGENTS.md`

Update rules:

- update the nearest subsystem doc when you change a documented server area
- update this file only when the server-wide contract, request flow, or ownership map changed
- keep endpoint- or module-specific detail out of this file when a deeper doc can own it

## Responsibilities

- serve the root HTML entry shells and public page-shell assets from `server/pages/`
- resolve browser-delivered modules from the layered `app/L0`, `app/L1`, and `app/L2` customware model
- expose server API modules from `server/api/`
- provide the outbound fetch proxy at `/api/proxy`
- enforce auth, session, module, and app-file access boundaries
- support local development and source-checkout update flows without turning the server into business-logic orchestration

## Structure

Current server layout:

- `server/app.js`: server factory and subsystem bootstrap
- `server/server.js`: startup entry used by the CLI and thin host flows
- `server/config.js`: default host, port, and filesystem roots
- `server/dev_server.js`: source-checkout dev supervisor used by `npm run dev`
- `server/pages/`: page shells for `/`, `/login`, and `/admin`, plus public shell assets under `server/pages/res/`
- `server/api/`: endpoint modules loaded by endpoint name
- `server/router/`: top-level request routing, page handling, `/mod/...` serving, direct app-file fetches, request context, response helpers, proxy transport, and CORS handling
- `server/lib/customware/`: path normalization, group and inheritance logic, extension override resolution, app-file access, and module management
- `server/lib/auth/`: password verification, session service, user file helpers, user indexing, and user-management helpers
- `server/lib/file_watch/`: config-driven watchdog plus derived indexes such as `path_index`, `group_index`, and `user_index`
- `server/lib/git/`: Git backend abstraction used by update flows and Git-backed module installs

## Request Flow And Runtime Contracts

Request routing order is:

1. API preflight handling
2. `/api/proxy`
3. `/api/<endpoint>`
4. `/mod/...`
5. `/~/...` and `/L0/...`, `/L1/...`, `/L2/...` app-file fetches
6. page shells and page actions as the final fallback

Core runtime contracts:

- request identity is derived from the server-issued `space_session` cookie via router-side request context plus the auth service
- `/api/proxy`, `/mod/...`, and direct app-file fetches require an authenticated session unless an endpoint explicitly opts into anonymous access
- `/mod/...` resolution uses the layered customware model and honors `maxLayer`, which defaults to `2`
- `/admin` requests effectively force `maxLayer=0` for module and extension resolution through explicit request data, query parameters, or admin-origin fallback
- `/~/path` maps to the authenticated user's `L2/<username>/path`
- `/L0/...`, `/L1/...`, and `/L2/...` direct fetches require authentication and use the same read permission model as the file APIs
- non-`/mod`, non-`/api`, and non-app-fetch requests stay limited to the root page shells and page actions owned by `server/pages/`
- `/logout` is handled by the pages layer and clears the current session before redirecting to `/login`

## Shared Infrastructure Contracts

The server relies on a small set of shared infrastructure contracts. Do not re-implement them inside endpoints or handlers.

- `server/lib/file_watch/` owns the canonical live view of app files through `path_index`, `group_index`, and `user_index`
- `server/lib/customware/file_access.js` is the canonical entry point for authenticated app-file list, read, write, delete, copy, move, and info operations
- `server/lib/customware/module_inheritance.js` and `server/lib/customware/extension_overrides.js` are the canonical module and extension resolution helpers
- `server/lib/customware/module_manage.js` is the canonical module list, info, install, and remove helper
- `server/lib/auth/service.js` is the canonical session and login service

Infrastructure rules:

- keep file-access checks in shared helpers, not in endpoint-local logic
- keep group and user access state derived from `group_index` and `user_index`, not re-parsed per request
- keep file-list and path-discovery work index-backed instead of walking the filesystem ad hoc
- refresh the watchdog after mutations that affect indexed filesystem, group, or auth state

## API Contract

Endpoint files in `server/api/` are loaded by filename. Multiword API route names should use object-first underscore naming so related routes stay grouped together alphabetically, for example `login_check`, `guest_create`, and `extensions_load`.

Endpoint modules may export:

- `get(context)`
- `post(context)`
- `put(context)`
- `patch(context)`
- `delete(context)`
- `head(context)`
- `options(context)`
- `allowAnonymous = true` for explicit public endpoints only

Handlers may return:

- plain JavaScript values, which are serialized as JSON automatically
- explicit HTTP-style response objects when status, headers, binary bodies, or streaming behavior matter
- Web `Response` objects for advanced cases

Current endpoint families:

- public auth and health: `health`, `guest_create`, `login_challenge`, `login`, `login_check`
- app files: `file_list`, `file_paths`, `file_read`, `file_write`, `file_delete`, `file_copy`, `file_move`, `file_info`
- modules: `module_list`, `module_info`, `module_install`, `module_remove`
- runtime and identity: `extensions_load`, `password_generate`, `user_self_info`

Detailed endpoint behavior now lives in `server/api/AGENTS.md`.

## Server Implementation Guide

- keep endpoints narrow and explicit
- keep routing order explicit and easy to reason about
- keep page-shell behavior in `server/pages/` plus `server/router/pages_handler.js`, not spread across unrelated files
- keep backend modules in `server/` on ES module syntax with `import` and `export`
- use underscores consistently for multiword server-side module files, handler ids, and helper entry points
- keep inheritance resolution explicit and small
- keep new persistence APIs explicit, small, and integrity-safe
- do not move browser-side agent logic onto the server by default
- when server responsibilities, request flow, API contracts, watched-file behavior, or persistence architecture change, update this file and the owning subsystem docs in the same session
