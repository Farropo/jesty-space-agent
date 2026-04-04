# AGENTS

## Purpose

`server/lib/customware/` owns the layered app filesystem and module model.

This subtree is the canonical place for app-path normalization, group-derived permissions, layer limits, module inheritance, extension override resolution, app-file access, and module management. Do not re-implement those rules elsewhere.

Documentation is top priority for this subtree. After any change under `server/lib/customware/`, update this file and any affected parent or dependent docs in the same session.

## Ownership

Current files:

- `layout.js`: path normalization, entity-id normalization, and parser helpers for app, group, user, module, and extension paths
- `layer_limit.js`: `maxLayer` parsing, normalization, and request-level resolution
- `group_files.js`: normalized `L1/<group>/group.yaml` read and write helpers used by CLI-managed group editing
- `group_index.js`: derived group membership and management graph from `group.yaml`
- `overrides.js`: inheritance ranking, accessible module collection, and override selection
- `module_inheritance.js`: `/mod/...` file resolution through layered overrides
- `extension_overrides.js`: extension request-path resolution and grouped batched extension lookup
- `file_access.js`: canonical app-file permission model and file operations
- `module_manage.js`: module list, info, install, remove, and Git metadata helpers

## Path And Permission Contract

Path rules:

- app-rooted paths normalize to `/app/...`
- writable user-relative shorthand `~` and `~/...` are expanded by `file_access.js`
- module request paths normalize under `/mod/...`
- group and user ids are normalized through `normalizeEntityId(...)`

Permission rules:

- nobody writes `L0`
- users may write their own `L2/<username>/`
- users may write `L1/<group>/` only when they manage that group
- `_admin` members may write any `L1/` and `L2/` path
- readable group membership comes from the derived `group_index`

`group.yaml` contract:

- `included_users`
- `included_groups`
- `managing_users`
- `managing_groups`

Those fields are the canonical inputs for the derived membership and management graph.

## Inheritance And Override Contract

Module and extension resolution is layered and rank-based.

High-level resolution order:

- `L0/_all`
- accessible `L0/<group>/` entries in group order
- `L1/_all`
- accessible `L1/<group>/` entries in group order
- `L2/<username>`

Important rules:

- `layer_limit.js` constrains module and extension resolution through `maxLayer`
- exact same override keys replace lower-ranked entries
- different extension filenames under the same extension point compose together
- `module_inheritance.js` and `extension_overrides.js` are the only supported paths for `/mod/...` and extension resolution

## File And Module Management Contract

`file_access.js` is the canonical entry point for:

- app-file list
- app-file read
- app-file write
- app-file delete
- app-file copy
- app-file move
- app-file info
- pattern-based `file_paths` lookup

Rules:

- batch file operations must validate all targets before mutation begins
- keep permission, duplication, overlap, and path-normalization logic centralized here

`module_manage.js` is the canonical entry point for:

- visible module discovery
- module metadata lookup
- Git-backed installs and updates
- module removal

Current module-list areas are:

- `l1`
- `l2_self`
- `l2_user`
- `l2_users`

Admin-only access is required for aggregated or cross-user user-layer listings.

## Development Guidance

- do not add ad hoc filesystem walks or permission checks to endpoints when this subtree already owns the rule
- keep changes to path semantics, inheritance, or permissions centralized here
- refresh the watchdog after mutations that affect indexed module, group, user, or file state
- if you change path normalization, group semantics, `maxLayer`, file access, or module-management rules, update this file and the relevant server or API docs in the same session
