# AGENTS

## Purpose

`_core/onscreen_agent/` owns the floating routed overlay agent.

It mounts into the router overlay layer, keeps its own floating shell, prompt files, persistence, attachments, execution loop, and overlay-specific interaction model, and reuses shared visual primitives for rendering and dialogs.

Documentation is top priority for this module. After any change under `_core/onscreen_agent/`, update this file and any affected parent docs in the same session.

## Ownership

This module owns:

- `ext/page/router/overlay/end/onscreen-agent.html`: thin adapter that mounts the overlay into the router overlay seam
- `panel.html`: overlay UI
- `store.js`: floating-shell state, send loop, persistence, drag behavior, display mode, and overlay menus
- `view.js`: shared-thread-view wiring
- `api.js`, `prompt.js`, `execution.js`, `attachments.js`, and `llm-params.js`: local runtime helpers
- `config.js` and `storage.js`: persisted settings, position, display mode, and history
- `system-prompt.md`, `compact-prompt.md`, and `compact-prompt-auto.md`: shipped prompt files
- `res/`: overlay-local assets

## Persistence And Prompt Contract

Current persistence paths:

- config: `~/conf/onscreen-agent.yaml`
- history: `~/hist/onscreen-agent.json`

Current config fields include:

- provider settings and params
- `max_tokens`
- optional `custom_system_prompt`
- `agent_x`
- `agent_y`
- `display_mode`

Current defaults:

- API endpoint: `https://openrouter.ai/api/v1/chat/completions`
- model: `openai/gpt-5.4-mini`
- params: `temperature:0.2`
- max tokens: `64000`
- default display mode: compact

Prompt rules:

- `system-prompt.md` is the firmware prompt
- custom instructions are appended under `## User specific instructions`
- `compact-prompt.md` is used for user-triggered history compaction
- `compact-prompt-auto.md` is used for automatic compaction during the loop

## Overlay Contract

Current overlay behavior:

- the module mounts only through the router overlay seam at `page/router/overlay/end`
- the shell supports compact and full display modes
- drag positioning, action menus, and visibility state are owned by `store.js`
- browser execution blocks use the `_____javascript` separator and are executed locally through `execution.js`
- the surface uses the shared `createAgentThreadView(...)` renderer from `_core/visual/conversation/thread-view.js`
- native dialogs use the shared dialog helpers from `_core/visual/forms/dialog.js`
- lightweight action menus use the shared popover positioning helper from `_core/visual/chrome/popover.js`
- the loop supports queued follow-up submissions, stop requests, attachment revalidation, and animation-frame streaming patches

## Development Guidance

- keep overlay-specific behavior local to this module
- do not import `_core/chat` or admin-agent internals for convenience
- use the router overlay seam rather than reaching around the router shell
- if you change the router overlay contract, persistence paths, or prompt execution behavior, update this file and the relevant parent docs in the same session
