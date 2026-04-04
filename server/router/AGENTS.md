# AGENTS

## Purpose

`server/router/` owns top-level HTTP request handling for the local server runtime.

It is responsible for request ordering, request context creation, page handling, `/mod/...` serving, direct app-file fetches, proxy routing, CORS handling, body parsing, and shared response helpers.

Documentation is top priority for this subtree. After any change under `server/router/`, update this file and any affected parent or helper docs in the same session.

## Ownership

Current files:

- `router.js`: top-level routing order and API dispatch
- `pages_handler.js`: page-route redirects, auth gating, `/logout`, and `/pages/res/...`
- `mod_handler.js`: `/mod/...` serving through layered module inheritance
- `app_fetch_handler.js`: `/~/...` and `/L0/...`, `/L1/...`, `/L2/...` direct app-file serving
- `request_context.js`: cookie parsing, request user resolution, and AsyncLocalStorage-backed request context
- `request_body.js`: parsed request-body helpers
- `cors.js`: API CORS headers and preflight handling
- `responses.js`: shared JSON, redirect, file, and generic API response writers
- `proxy.js`: outbound fetch proxy transport for `/api/proxy`

## Routing Order

Current request order is fixed:

1. API preflight handling
2. `/api/proxy`
3. `/api/<endpoint>`
4. `/mod/...`
5. `/~/...` and `/L0/...`, `/L1/...`, `/L2/...`
6. page shells and page actions

Rules:

- keep this order explicit and centralized in `router.js`
- do not hide route precedence in scattered conditionals across unrelated files
- all non-public API, module, and app-fetch routes require an authenticated request context before dispatch

## Request Context Contract

`request_context.js` owns request-scoped auth state.

Current behavior:

- cookies are parsed once from the incoming request
- the auth service resolves the current user from the `space_session` cookie
- the request context is stored in AsyncLocalStorage for the lifetime of the request
- `ensureAuthenticatedRequestContext(...)` is the shared guard for authenticated routes

## Serving Contracts

Pages:

- `pages_handler.js` is the only owner of page auth gating, pretty-route redirects, `/logout`, and `/pages/res/...`
- `/login` is public
- `/` and `/admin` require authentication

Modules:

- `mod_handler.js` resolves `/mod/...` through `server/lib/customware/module_inheritance.js`
- `maxLayer` is read from explicit request data, query params, or admin-origin fallback through `layer_limit.js`

Direct app-file fetches:

- `app_fetch_handler.js` maps `/~/...` to the authenticated user's `L2/<username>/...`
- `/L0/...`, `/L1/...`, and `/L2/...` are also supported for authenticated direct fetches
- read permission checks are delegated to `createAppAccessController(...)`

Responses:

- `responses.js` owns JSON serialization, redirects, file responses, stream responses, and Web `Response` bridging
- `cors.js` owns the API CORS policy and `OPTIONS` handling

## Development Guidance

- keep routing logic here, not in page or API modules
- keep page and module serving thin and delegate policy decisions to shared helpers
- do not bypass `request_context.js` for auth state
- if routing order, auth flow, page handling, or response contracts change, update this file and `/server/AGENTS.md`
