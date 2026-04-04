# AGENTS

## Documentation First

Documentation is the most important part of this project.

Treat every `AGENTS.md` file as part of the runtime contract, not as optional notes. Poor documentation causes agent behavior drift, architecture drift, and bad changes in the wrong layer.

This repository now uses a documentation hierarchy:

- `/AGENTS.md` owns repo-wide rules, documentation policy, and top-level architecture
- the five core docs are `/AGENTS.md`, `/app/AGENTS.md`, `/server/AGENTS.md`, `/commands/AGENTS.md`, and `/packaging/AGENTS.md`
- deeper `AGENTS.md` files inside `app/` and `server/` own the concrete implementation contracts for the module or subsystem in their subtree
- the closer the doc is to the code, the more technical and specific it should be
- the higher the doc is in the tree, the more it should focus on principles, ownership, stable contracts, and architecture

Always update the relevant docs in the same session as the code change:

- update the closest owning `AGENTS.md` for the files you changed
- update parent docs too when the higher-level contract, ownership boundary, architecture, or workflow changed
- keep higher-level docs abstract where appropriate and push implementation detail down into local docs
- keep lower-level docs concrete, explicit, and practical
- remove stale or contradictory documentation immediately
- do not create parallel architecture notes in `README.md`; durable agent guidance belongs in `AGENTS.md`

## Introduction

Space Agent is a browser-first AI agent runtime.

The browser app is the primary runtime. The Node.js side exists as thin infrastructure around it for:

- outbound fetch proxying when the browser would otherwise hit CORS limits
- server-owned APIs and other narrow infrastructure contracts
- local development and optional desktop hosting

Implement only what the user explicitly asked for. Do not invent new features, policies, cleanup behavior, or product changes on your own. If a request would require a new behavior or policy that the user did not ask for, stop and ask first.

The five core documentation files remain the project's primary instruction set:

- `/AGENTS.md`
- `/app/AGENTS.md`
- `/server/AGENTS.md`
- `/commands/AGENTS.md`
- `/packaging/AGENTS.md`

## Programming Guide

These rules apply across the codebase:

- keep implementations lean; prefer refactoring and simplification over adding bloat
- do not repeat code unnecessarily; when logic repeats, extract a shared implementation
- design new functionality to be reusable when that reuse is realistic
- do not hardwire features directly to each other when a small explicit contract or abstraction will do
- prefer composition, registries, and stable module boundaries over ad hoc cross-dependencies
- code must stay clean, readable, and reusable
- avoid boilerplate and ceremony unless they solve a real maintenance, safety, or clarity problem
- use deterministic discovery patterns for pluggable systems
- keep each handler type in one predictable folder and load implementations by explicit name, config, or convention
- apply the same deterministic loading rule to API handlers, watched-file handlers, workers, and other extension points that serve the same role
- do not create one-off loader paths for a single feature when that feature belongs in an existing handler or extension system
- in `server/`, name multiword scripts, modules, handler ids, and endpoint files with the object first and the verb second, and use underscores consistently, for example `file_read`, `login_check`, `user_manage`, and `pages_handler`
- when multiple objects should share the same interface, prefer JavaScript classes with a shared superclass and explicit overridden methods
- do not model shared interfaces as plain objects that are inspected at runtime to see whether a function exists
- use ES module syntax throughout the codebase; prefer `import` and `export` and avoid CommonJS forms such as `require` and `module.exports`
- some legacy CommonJS still exists in the repository; treat it as migration debt, not as a pattern to copy
- keep as much agent logic in the browser as possible
- treat the server as infrastructure, not as the main application runtime
- prefer explicit, small contracts between browser and server
- prefer maintainable filesystem structure over clever routing shortcuts

## Top-Level Structure

Top-level structure:

- `space`: root CLI router that discovers command modules dynamically
- `commands/`: CLI command modules such as `serve`, `help`, `get`, `set`, `version`, and `update`
- `app/`: browser runtime, layered customware model, shared frontend modules, and browser test surfaces
- `server/`: thin local infrastructure runtime, with page shells, request routing, API hosting, fetch proxying, file-watch indexes, auth/session infrastructure, and Git support code
- `packaging/`: optional Electron host and packaging scripts; native hosts should stay thin

Project concepts:

- browser first, server last
- modules are the browser delivery unit for code, markup, styles, and assets
- browser modules are namespaced as `mod/<author>/<repo>/...`
- frontend extensibility is a core runtime primitive; the framework installs `space.extend` first and the browser runtime grows by loading modules and extension points deterministically
- the layered browser model is `app/L0` firmware, `app/L1` group customware, and `app/L2` user customware
- `app/L1` and `app/L2` are transient runtime state and are gitignored; do not treat them as durable repo-owned sample content
- `app/L2/<username>/user.yaml` stores user metadata such as `full_name`; auth state lives under `app/L2/<username>/meta/`
- the server resolves `/mod/...` requests through the layered inheritance model and honors a `maxLayer` ceiling that defaults to `2`
- the `/admin` frontend clamps module and extension resolution to `L0` with `maxLayer=0` so admin UI assets stay firmware-backed even though app file APIs still operate on normal writable layers
- the browser authenticates through the server and uses a server-issued session cookie for protected API, module, and app-file access
- app file APIs use app-rooted paths such as `L2/alice/user.yaml` or `/app/L2/alice/user.yaml`, and supported endpoints may also accept `~` or `~/...` for the authenticated user's `L2/<username>/...`
- non-`/api` and non-`/mod` browser entry routes are served from `server/pages/`; `/login` is public and the protected page shells live behind the router-side session gate
- detailed browser-runtime rules live in `/app/AGENTS.md`
- detailed server-runtime rules live in `/server/AGENTS.md`

## Supported CLI Surface

- `node space serve`
- `node space get`
- `node space get <param>`
- `node space set <param> <value>`
- `node space update`
- `node space help`
- `node space --help`
- `node space version`
- `node space --version`
- `node space user create`
- `node space user password`
- `node space group create`
- `node space group add`
- `node space group remove`

## Development Surface

- Node.js 20 or newer
- `npm install` for the standard source checkout
- `npm install --omit=optional` when native optional dependencies are not expected to work
- `npm run dev` to run the local dev supervisor
- `node space serve` to run the server directly
- `npm run install:packaging` to install packaging-only dependencies
- `npm run desktop:dev`, `npm run desktop:pack`, and `npm run desktop:dist` for the Electron host and packaging flow

## Documentation Ownership

Core ownership:

- `/AGENTS.md` owns repo-wide rules, documentation policy, top-level structure, and cross-cutting principles
- `/app/AGENTS.md` owns browser-runtime architecture, layer rules, frontend composition rules, and app-wide guidance
- `/server/AGENTS.md` owns server responsibilities, request flow, API/module/page boundaries, and server-wide infrastructure guidance
- `/commands/AGENTS.md` owns CLI-module conventions and the command-tree contract under `commands/`
- `/packaging/AGENTS.md` owns native-host and packaging-surface guidance under `packaging/`

Local ownership:

- module-local `AGENTS.md` files inside `app/` own the concrete contracts for major frontend modules and surfaces
- subsystem-local `AGENTS.md` files inside `server/` own the concrete contracts for router, pages, APIs, customware, auth, file-watch, and Git infrastructure
- see `/app/AGENTS.md` and `/server/AGENTS.md` for the current map of local docs

Documentation rules:

- keep app-specific details in app docs, not in the root file
- keep server-specific details in server docs, not in the root file
- use local docs for implementation-specific module behavior instead of bloating the core docs
- when a code change adds a new stable seam, subsystem, ownership boundary, or workflow, document it where it belongs before finishing
- when code reveals undocumented architecture, document it
- keep all `AGENTS.md` files explicit, current, and high signal
