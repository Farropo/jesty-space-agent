# AGENTS

## Purpose

`server/lib/git/` owns the Git backend abstraction used by source-checkout update flows and Git-backed module installs.

It provides a stable interface over multiple backend implementations so the rest of the server and CLI can talk to Git without coupling themselves to one transport.

Documentation is top priority for this subtree. After any change under `server/lib/git/`, update this file and any affected parent or dependent docs in the same session.

## Ownership

Current files:

- `client_interface.js`: shared Git client assertions and interface shape
- `client_create.js`: backend selection and client creation
- `native_handler.js`: native Git backend
- `nodegit_handler.js`: NodeGit backend
- `isomorphic_handler.js`: isomorphic-git backend
- `shared.js`: shared backend-selection and remote-sanitization helpers

## Backend Selection Contract

Current backend order:

- `native`
- `nodegit`
- `isomorphic`

Current rules:

- `createGitClient({ projectRoot })` resolves the best available client for local repo operations
- `cloneGitRepository(...)` resolves the best available clone client for remote installs
- `SPACE_GIT_BACKEND` may force a specific backend name
- backend clients must satisfy the shared interface asserted by `client_interface.js`

## Development Guidance

- keep backend-specific behavior behind this abstraction
- do not import a backend implementation directly from unrelated server or command code when `client_create.js` already owns selection
- keep remote sanitization and backend-resolution logic centralized in `shared.js`
- if backend order, interface shape, or environment-variable behavior changes, update this file and the relevant server or command docs in the same session
