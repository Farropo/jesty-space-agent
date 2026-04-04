# AGENTS

## Purpose

`_core/chat/` owns the standalone reference chat surface.

It is a self-contained page-oriented chat runtime with its own store, prompt building, execution loop, attachments, rendering helpers, and local browser persistence. It predates the newer router-hosted module pattern and should be treated as a standalone reference surface, not as the default template for new feature work.

Documentation is top priority for this module. After any change under `_core/chat/`, update this file and any affected parent docs in the same session.

## Ownership

This module owns:

- `page.html` and `page.js`: standalone page shell for the chat surface
- `chat-page.html` and `chat-page.js`: mounted chat UI
- `chat-store.js`: main runtime, send loop, dialog handling, and persistence orchestration
- `api.js`, `execution-context.js`, `attachments.js`, `llm-params.js`, `system-prompt.js`, and `chat-view.js`: local helpers
- `storage.js`: browser-local persistence
- `default-system-prompt.md`: shipped prompt content
- `res/`: local chat assets

## Runtime And Persistence Contract

Current runtime shape:

- `page.js` imports the shared framework bootstrap from `/mod/_core/framework/js/initFw.js`
- `chat-store.js` still initializes its own runtime and uses `createStore(...)` directly instead of `space.fw.createStore(...)`
- this is legacy behavior for this standalone page and should not be copied into new router-hosted modules by default

Current browser-local persistence:

- draft: `space.chat.draft`
- history: `space.chat.history`
- settings: `space.chat.settings`
- system prompt: `space.chat.system-prompt`
- system prompt mode: `space.chat.system-prompt-mode`

All of those keys currently live in `localStorage`.

## Surface Contract

Current behavior:

- the page has its own page menu for Admin and Logout navigation
- settings, history, raw output, and system prompt are handled through local dialogs
- prompt building, execution context handling, and message rendering are local to this module
- admin and onscreen agent surfaces do not depend on this module's internals

## Development Guidance

- keep `_core/chat` self-contained
- do not import chat internals into admin or onscreen agent modules for convenience
- if functionality becomes meaningfully shared across surfaces, promote it into `_core/framework` or `_core/visual` instead of creating hidden dependencies on `_core/chat`
- if you change persistence keys, runtime shape, or prompt execution behavior, update this file and `/app/AGENTS.md`
