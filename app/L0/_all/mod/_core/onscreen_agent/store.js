import * as config from "/mod/_core/onscreen_agent/config.js";
import * as agentApi from "/mod/_core/onscreen_agent/api.js";
import * as execution from "/mod/_core/onscreen_agent/execution.js";
import * as llmParams from "/mod/_core/onscreen_agent/llm-params.js";
import * as prompt from "/mod/_core/onscreen_agent/prompt.js";
import * as storage from "/mod/_core/onscreen_agent/storage.js";
import * as agentView from "/mod/_core/onscreen_agent/view.js";
import { positionPopover } from "/mod/_core/visual/chrome/popover.js";
import { closeDialog, openDialog } from "/mod/_core/visual/forms/dialog.js";
import { countTextTokens } from "/mod/_core/framework/js/token-count.js";
import {
  createAttachmentRuntime,
  createDraftAttachments,
  normalizeStoredAttachment,
  serializeAttachmentMetadata
} from "/mod/_core/onscreen_agent/attachments.js";

const CONFIG_PERSIST_DELAY_MS = 180;
const AGENT_IDLE_HINT_DELAY_MS = 2000;
const COMPACT_MODE_TOP_EDGE_THRESHOLD_EM = 10;
const DISPLAY_MODE_FULL = "full";
const DISPLAY_MODE_COMPACT = "compact";
const DRAG_CLICK_THRESHOLD = 6;
const MAX_COMPACT_TRIM_ATTEMPTS = 4;
const MAX_PROTOCOL_RETRY_COUNT = 2;
const POSITION_MARGIN = 16;
const UI_BUBBLE_AUTO_HIDE_BASE_MS = 1400;
const UI_BUBBLE_AUTO_HIDE_MAX_MS = 12000;
const UI_BUBBLE_AUTO_HIDE_MIN_MS = 2200;
const UI_BUBBLE_AUTO_HIDE_PER_CHAR_MS = 28;
const UI_BUBBLE_AUTO_HIDE_PER_WORD_MS = 260;
const UI_BUBBLE_ENTER_DURATION_MS = 420;
const UI_BUBBLE_EXIT_DURATION_MS = 180;
const IDLE_HINT_BUBBLE_TEXT = "Drag me, tap me.";
const HISTORY_DIALOG_ELEMENT_ID = "onscreen-agent-history-dialog";
const RAW_DIALOG_ELEMENT_ID = "onscreen-agent-raw-dialog";
const SETTINGS_DIALOG_ELEMENT_ID = "onscreen-agent-settings-dialog";

function getRuntime() {
  const runtime = globalThis.space;

  if (!runtime || typeof runtime !== "object") {
    throw new Error("Space runtime is not available.");
  }

  if (!runtime.fw || typeof runtime.fw.createStore !== "function") {
    throw new Error("space.fw.createStore is not available.");
  }

  return runtime;
}

function resolveDialogRef(refs, refKey, elementId) {
  const existingRef = refs && typeof refs === "object" ? refs[refKey] : null;

  if (existingRef) {
    return existingRef;
  }

  if (!elementId) {
    return null;
  }

  const dialog = document.getElementById(elementId);

  if (dialog && refs && typeof refs === "object") {
    refs[refKey] = dialog;
  }

  return dialog;
}

function ensureCurrentChatRuntime(targetRuntime) {
  if (!targetRuntime.currentChat || typeof targetRuntime.currentChat !== "object") {
    targetRuntime.currentChat = {};
  }

  if (!Array.isArray(targetRuntime.currentChat.messages)) {
    targetRuntime.currentChat.messages = [];
  }

  if (!targetRuntime.currentChat.attachments || typeof targetRuntime.currentChat.attachments !== "object") {
    targetRuntime.currentChat.attachments = createAttachmentRuntime();
  }

  return targetRuntime.currentChat;
}

function createMessage(role, content, options = {}) {
  return {
    attachments: Array.isArray(options.attachments) ? options.attachments.slice() : [],
    content,
    id: `${role}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    kind: typeof options.kind === "string" ? options.kind : "",
    role
  };
}

function createStreamingAssistantMessage() {
  return {
    ...createMessage("assistant", ""),
    streaming: true
  };
}

function createRuntimeMessageSnapshot(message) {
  return {
    attachments: Array.isArray(message?.attachments)
      ? message.attachments.map((attachment) => serializeAttachmentMetadata(attachment))
      : [],
    content: typeof message?.content === "string" ? message.content : "",
    id: typeof message?.id === "string" ? message.id : "",
    kind: typeof message?.kind === "string" ? message.kind : "",
    role: message?.role === "assistant" ? "assistant" : "user",
    streaming: message?.streaming === true
  };
}

function normalizeStoredMessage(message) {
  return {
    attachments: Array.isArray(message?.attachments)
      ? message.attachments.map((attachment) => normalizeStoredAttachment(attachment))
      : [],
    content: typeof message?.content === "string" ? message.content : "",
    id:
      typeof message?.id === "string" && message.id
        ? message.id
        : `${message?.role || "message"}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    kind: typeof message?.kind === "string" ? message.kind : "",
    role: message?.role === "assistant" ? "assistant" : "user",
    streaming: message?.streaming === true
  };
}

function findConversationInputMessage(history, assistantMessageId) {
  const assistantMessageIndex = history.findIndex(
    (message) => message.id === assistantMessageId && message.role === "assistant"
  );

  if (assistantMessageIndex === -1) {
    return null;
  }

  for (let index = assistantMessageIndex - 1; index >= 0; index -= 1) {
    const message = history[index];

    if (message.role !== "user") {
      continue;
    }

    if (isExecutionFollowUpKind(message.kind)) {
      continue;
    }

    return message;
  }

  return null;
}

function formatPromptHistoryText(messages) {
  if (!Array.isArray(messages) || !messages.length) {
    return "";
  }

  return messages
    .map((message) => {
      const role = typeof message?.role === "string" ? message.role.toUpperCase() : "UNKNOWN";
      const content = typeof message?.content === "string" ? message.content : "";
      return `${role}:\n${content}`;
    })
    .join("\n\n");
}

function buildPromptHistoryText(systemPrompt, history) {
  return formatPromptHistoryText(agentApi.buildOnscreenAgentPromptMessages(systemPrompt, history));
}

function isContextLengthError(error) {
  const message = String(error?.message || "").toLowerCase();
  return ["context", "token", "length", "maximum", "too long", "exceed"].some((pattern) =>
    message.includes(pattern)
  );
}

function trimHistoryTextToRecentMessages(text, targetFraction = 0.5) {
  const blocks = text.split(/\n\n(?=(?:USER|ASSISTANT):\n)/u);

  if (blocks.length <= 1) {
    const targetLength = Math.max(1, Math.floor(text.length * targetFraction));
    return text.slice(Math.max(0, text.length - targetLength));
  }

  const targetLength = Math.floor(text.length * targetFraction);
  let trimIndex = 0;
  let trimmed = text;

  while (trimIndex < blocks.length - 1 && trimmed.length > targetLength) {
    trimIndex += 1;
    trimmed = blocks.slice(trimIndex).join("\n\n");
  }

  return trimmed;
}

function summarizeProtocolMessage(message, maxLength = 280) {
  const normalizedMessage = typeof message === "string" ? message.replace(/\s+/gu, " ").trim() : "";

  if (normalizedMessage.length <= maxLength) {
    return normalizedMessage;
  }

  return `${normalizedMessage.slice(0, maxLength - 3)}...`;
}

function isExecutionFollowUpKind(kind) {
  return kind === "execution-output" || kind === "execution-retry";
}

function executionResultHasUsableOutput(result) {
  if (result?.error) {
    return true;
  }

  if (result?.result !== undefined) {
    return true;
  }

  return Array.isArray(result?.logs) && result.logs.length > 0;
}

function executionResultsNeedReturnedValue(results) {
  if (!Array.isArray(results) || !results.length) {
    return false;
  }

  return results.every((result) => !executionResultHasUsableOutput(result));
}

function buildMissingExecutionResultRetryMessage(executionOutputText) {
  const summarizedOutput = summarizeProtocolMessage(executionOutputText);

  return [
    "Protocol correction: the last browser execution finished but returned no result.",
    `Execution output: "${summarizedOutput}"`,
    "Space Agent already runs your JavaScript inside an async function.",
    "Use top-level await directly and end with a top-level return for the value you need.",
    "Do not wrap the whole snippet in an async IIFE like `(async () => { ... })()` unless you also return it.",
    "Execute again now. Do not stop until you have a result or a clear error."
  ].join("\n");
}

function buildEmptyAssistantRetryMessage(executionOutputText) {
  const summarizedOutput = summarizeProtocolMessage(executionOutputText);

  return [
    "Protocol correction: your last reply after browser execution was empty.",
    `Execution output: "${summarizedOutput}"`,
    "Read the execution output and continue.",
    "If another browser step is needed, execute again now.",
    "Do not stop until you provide a user-facing answer or a clear error."
  ].join("\n");
}

function isAbortError(error) {
  return Boolean(error && (error.name === "AbortError" || error.code === 20));
}

function clearTimer(timerId) {
  if (timerId) {
    window.clearTimeout(timerId);
  }

  return 0;
}

function getRootFontSizePx() {
  const rootStyle = globalThis.getComputedStyle?.(document.documentElement);
  const fontSize = Number.parseFloat(rootStyle?.fontSize || "");
  return Number.isFinite(fontSize) && fontSize > 0 ? fontSize : 16;
}

function normalizeUiBubbleHideDelay(value) {
  const normalizedValue = Number(value);

  if (!Number.isFinite(normalizedValue) || normalizedValue <= 0) {
    return 0;
  }

  return Math.max(0, Math.round(normalizedValue));
}

function getAutoUiBubbleHideDelay(text) {
  const normalizedText = typeof text === "string" ? text.trim() : "";

  if (!normalizedText) {
    return 0;
  }

  const charCount = Array.from(normalizedText).length;
  const wordCount = normalizedText.split(/\s+/u).filter(Boolean).length;
  const estimatedDelay = UI_BUBBLE_AUTO_HIDE_BASE_MS + Math.max(
    charCount * UI_BUBBLE_AUTO_HIDE_PER_CHAR_MS,
    wordCount * UI_BUBBLE_AUTO_HIDE_PER_WORD_MS
  );

  return Math.min(UI_BUBBLE_AUTO_HIDE_MAX_MS, Math.max(UI_BUBBLE_AUTO_HIDE_MIN_MS, estimatedDelay));
}

function createComposerActionMenuPosition() {
  return {
    left: 12,
    maxHeight: 240,
    top: 12
  };
}

function normalizeDisplayMode(value) {
  if (value === DISPLAY_MODE_FULL || value === DISPLAY_MODE_COMPACT) {
    return value;
  }

  return DISPLAY_MODE_COMPACT;
}

function getNextDisplayMode(value) {
  return normalizeDisplayMode(value) === DISPLAY_MODE_FULL ? DISPLAY_MODE_COMPACT : DISPLAY_MODE_FULL;
}

function normalizeUiBubbleText(text) {
  if (typeof text !== "string") {
    return "";
  }

  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/^\n+/u, "")
    .replace(/\n+$/u, "");
}

function extractAssistantBubbleText(content) {
  if (typeof content !== "string" || !content.trim()) {
    return "";
  }

  let normalizedContent = content;

  execution.extractExecuteBlocks(content).forEach((block) => {
    if (typeof block?.raw === "string" && block.raw) {
      normalizedContent = normalizedContent.replace(block.raw, "");
    }
  });

  return normalizeUiBubbleText(normalizedContent);
}

function runOnNextFrame(callback) {
  if (typeof callback !== "function") {
    return;
  }

  window.requestAnimationFrame(() => {
    callback();
  });
}

function countDisplayLines(text) {
  const normalizedText =
    typeof text === "string" ? text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trimEnd() : "";

  if (!normalizedText.trim()) {
    return 0;
  }

  return normalizedText.split("\n").length;
}

function formatLineCount(lineCount) {
  return `${lineCount.toLocaleString()} ${lineCount === 1 ? "line" : "lines"}`;
}

function getStreamingAssistantStatus(content) {
  const normalizedContent = typeof content === "string" ? content : "";
  const executeBlocks = execution.extractExecuteBlocks(normalizedContent);

  if (executeBlocks.length) {
    const codeLineCount = countDisplayLines(executeBlocks[0]?.code || "");

    if (codeLineCount > 0) {
      return `Writing ${formatLineCount(codeLineCount)} of code...`;
    }

    return "Preparing code...";
  }

  if (normalizedContent.trim()) {
    return "Writing response...";
  }

  return "Thinking...";
}

function getExecutionStatusText(code, index, total) {
  const lineCount = countDisplayLines(code);
  const lineCountLabel = lineCount > 0 ? `Executing ${formatLineCount(lineCount)} of code` : "Executing code";

  return total > 1 ? `${lineCountLabel} (${index + 1}/${total})...` : `${lineCountLabel}...`;
}

const model = {
  activeRequestController: null,
  composerActionMenuAnchor: null,
  composerActionMenuPosition: createComposerActionMenuPosition(),
  configPersistTimer: 0,
  currentChatRuntime: null,
  defaultSystemPrompt: "",
  displayMode: DISPLAY_MODE_COMPACT,
  draft: "",
  draftAttachments: [],
  dragState: null,
  executionContext: null,
  executionOutputOverrides: Object.create(null),
  history: [],
  historyPersistPromise: null,
  historyText: "",
  historyTokenCount: 0,
  hasInteracted: false,
  initializationPromise: null,
  interactionHintTimer: 0,
  isCompactingHistory: false,
  isInitialized: false,
  isLoadingDefaultSystemPrompt: false,
  isUiBubbleMounted: false,
  isSending: false,
  nextUiBubble: null,
  pendingHistorySnapshot: null,
  pendingStreamingMessage: null,
  promptHistoryMessages: [],
  promptHistoryMode: "text",
  promptHistoryTitle: "Context window",
  queuedSubmissions: [],
  rawOutputContent: "",
  rawOutputTitle: "Raw LLM Output",
  refs: {
    actionMenu: null,
    attachmentInput: null,
    historyDialog: null,
    input: null,
    rawDialog: null,
    scroller: null,
    settingsDialog: null,
    thread: null
  },
  rerunningMessageId: "",
  resizeHandler: null,
  runtime: null,
  runtimeSystemPrompt: "",
  streamingRenderFrame: 0,
  dragMoveHandler: null,
  dragEndHandler: null,
  uiBubbleAutoHideTimer: 0,
  uiBubbleEnterTimer: 0,
  uiBubbleExitTimer: 0,
  uiBubblePhase: "",
  uiBubbleText: "",
  settings: {
    apiEndpoint: "",
    apiKey: "",
    maxTokens: config.DEFAULT_ONSCREEN_AGENT_SETTINGS.maxTokens,
    model: "",
    paramsText: ""
  },
  settingsDraft: {
    apiEndpoint: "",
    apiKey: "",
    maxTokens: config.DEFAULT_ONSCREEN_AGENT_SETTINGS.maxTokens,
    model: "",
    paramsText: ""
  },
  status: "Loading onscreen agent...",
  stopRequested: false,
  systemPrompt: "",
  systemPromptDraft: "",
  agentX: null,
  agentY: null,

  get composerPlaceholder() {
    const statusText = typeof this.status === "string" ? this.status.trim() : "";

    if (!statusText) {
      return "Message Space Agent...";
    }

    return statusText === "Ready." ? "Ready. Message Space Agent..." : statusText;
  },

  get composerActionMenuActions() {
    return [
      {
        icon: "open_in_full",
        id: "full-mode",
        label: "Full mode"
      },
      {
        icon: "attach_file",
        id: "attach",
        label: "Attachment"
      },
      {
        icon: this.compactButtonIcon,
        id: "compact-history",
        label: "Compact context"
      },
      {
        danger: true,
        icon: "restart_alt",
        id: "clear",
        label: "Clear chat"
      },
      {
        icon: "notes",
        id: "history",
        label: "History"
      },
      {
        icon: "tune",
        id: "settings",
        label: "Model settings"
      }
    ];
  },

  get composerActionMenuStyle() {
    return {
      left: `${this.composerActionMenuPosition.left}px`,
      maxHeight: `${this.composerActionMenuPosition.maxHeight}px`,
      top: `${this.composerActionMenuPosition.top}px`
    };
  },

  get isComposerInputDisabled() {
    return !this.isInitialized || this.isCompactingHistory;
  },

  get isCompactMode() {
    return this.displayMode === DISPLAY_MODE_COMPACT;
  },

  get isComposerActionMenuOpen() {
    return Boolean(this.composerActionMenuAnchor);
  },

  get hasDraftSubmission() {
    return Boolean(this.draft.trim() || this.draftAttachments.length);
  },

  get hasQueuedSubmission() {
    return this.queuedSubmissions.length > 0;
  },

  get queuedSubmissionCount() {
    return this.queuedSubmissions.length;
  },

  get canQueueSubmissionWhileBusy() {
    return (
      this.isSending &&
      !this.isLoadingDefaultSystemPrompt &&
      !this.isCompactingHistory &&
      this.hasDraftSubmission
    );
  },

  get isComposerSubmitDisabled() {
    return (
      !this.isInitialized ||
      this.isLoadingDefaultSystemPrompt ||
      this.isCompactingHistory ||
      (!this.isSending && !this.hasDraftSubmission) ||
      (this.isSending && !this.canQueueSubmissionWhileBusy)
    );
  },

  get isCompactDisabled() {
    return (
      !this.isInitialized ||
      this.isSending ||
      this.isLoadingDefaultSystemPrompt ||
      this.isCompactingHistory ||
      !this.historyText.trim()
    );
  },

  get llmSummary() {
    return agentView.summarizeLlmConfig(this.settings.apiEndpoint, this.settings.model);
  },

  get historyTokenSummary() {
    return `${config.formatOnscreenAgentTokenCount(this.historyTokenCount)} tokens`;
  },

  get isAttachmentPickerDisabled() {
    return !this.isInitialized || this.isLoadingDefaultSystemPrompt || this.isCompactingHistory;
  },

  get isPrimaryActionDisabled() {
    if (!this.isInitialized || this.isLoadingDefaultSystemPrompt || this.isCompactingHistory) {
      return true;
    }

    if (!this.isSending) {
      return !this.hasDraftSubmission;
    }

    if (this.canQueueSubmissionWhileBusy) {
      return false;
    }

    return this.hasQueuedSubmission;
  },

  get primaryActionIcon() {
    if (this.isSending) {
      if (this.canQueueSubmissionWhileBusy) {
        return "arrow_upward";
      }

      if (this.hasQueuedSubmission) {
        return "progress_activity";
      }

      return "stop";
    }

    return "arrow_upward";
  },

  get primaryActionLabel() {
    if (this.isSending) {
      if (this.canQueueSubmissionWhileBusy) {
        return this.hasQueuedSubmission ? "Add message to queue" : "Queue message for next step";
      }

      if (this.hasQueuedSubmission) {
        return this.queuedSubmissionCount === 1
          ? "1 message queued for next step"
          : `${this.queuedSubmissionCount} messages queued for next steps`;
      }

      return "Stop current loop";
    }

    return "Send message";
  },

  get isPrimaryActionBusy() {
    return this.isSending && this.hasQueuedSubmission && !this.canQueueSubmissionWhileBusy;
  },

  get isPrimaryActionStop() {
    return this.isSending && !this.hasQueuedSubmission && !this.canQueueSubmissionWhileBusy;
  },

  get compactButtonIcon() {
    return this.isCompactingHistory ? "progress_activity" : "compress";
  },

  get isFullMode() {
    return this.displayMode === DISPLAY_MODE_FULL;
  },

  get promptHistoryContent() {
    if (this.promptHistoryMode === "json") {
      return JSON.stringify(this.promptHistoryMessages, null, 2);
    }

    return formatPromptHistoryText(this.promptHistoryMessages);
  },

  get promptHistorySections() {
    if (!Array.isArray(this.promptHistoryMessages) || !this.promptHistoryMessages.length) {
      return [];
    }

    return this.promptHistoryMessages.map((message) => ({
      content: typeof message?.content === "string" ? message.content : "",
      role: typeof message?.role === "string" ? message.role.toUpperCase() : "UNKNOWN",
      tokenCountLabel: `${config.formatOnscreenAgentTokenCount(
        countTextTokens(typeof message?.content === "string" ? message.content : "")
      )} tokens`
    }));
  },

  get isDockedRight() {
    return this.agentX > this.getViewportWidth() / 2;
  },

  get isHistoryBelow() {
    return this.agentY < this.getViewportHeight() * 0.5;
  },

  get isCompactModeNearTopEdge() {
    return this.agentY < Math.max(POSITION_MARGIN, getRootFontSizePx() * COMPACT_MODE_TOP_EDGE_THRESHOLD_EM);
  },

  get isUiBubbleBelowHead() {
    return this.isCompactMode ? this.isCompactModeNearTopEdge : this.isHistoryBelow;
  },

  get shouldOpenComposerActionMenuBelow() {
    return this.isCompactMode ? this.isCompactModeNearTopEdge : this.isHistoryBelow;
  },

  get avatarButtonLabel() {
    return this.isFullMode ? "Switch to compact chat mode" : "Switch to full chat mode";
  },

  get shouldShowHistory() {
    return this.isFullMode && this.history.length > 0;
  },

  get positionStyle() {
    return `left:${Math.round(this.agentX)}px;top:${Math.round(this.agentY)}px;`;
  },

  getViewportWidth() {
    return Math.max(window.innerWidth || 0, document.documentElement.clientWidth || 0, 360);
  },

  getViewportHeight() {
    return Math.max(window.innerHeight || 0, document.documentElement.clientHeight || 0, 320);
  },

  getDefaultPosition() {
    return {
      x: 40,
      y: Math.max(POSITION_MARGIN, this.getViewportHeight() - 132)
    };
  },

  clampPosition(x, y) {
    const maxX = Math.max(POSITION_MARGIN, this.getViewportWidth() - 72 - POSITION_MARGIN);
    const maxY = Math.max(POSITION_MARGIN, this.getViewportHeight() - 72 - POSITION_MARGIN);

    return {
      x: Math.min(maxX, Math.max(POSITION_MARGIN, Math.round(Number(x) || 0))),
      y: Math.min(maxY, Math.max(POSITION_MARGIN, Math.round(Number(y) || 0)))
    };
  },

  setPosition(x, y, options = {}) {
    const position = this.clampPosition(x, y);
    this.agentX = position.x;
    this.agentY = position.y;

    if (options.persist !== false) {
      this.scheduleConfigPersist();
    }
  },

  ensurePosition(options = {}) {
    if (typeof this.agentX !== "number" || !Number.isFinite(this.agentX) || typeof this.agentY !== "number" || !Number.isFinite(this.agentY)) {
      const defaultPosition = this.getDefaultPosition();
      this.agentX = defaultPosition.x;
      this.agentY = defaultPosition.y;

      if (options.persist === true) {
        this.scheduleConfigPersist();
      }

      return;
    }

    this.setPosition(this.agentX, this.agentY, {
      persist: options.persist === true
    });
  },

  scheduleConfigPersist() {
    if (this.configPersistTimer) {
      window.clearTimeout(this.configPersistTimer);
    }

    this.configPersistTimer = window.setTimeout(() => {
      this.configPersistTimer = 0;
      void this.persistConfig();
    }, CONFIG_PERSIST_DELAY_MS);
  },

  async persistConfig() {
    try {
      await storage.saveOnscreenAgentConfig({
        agentX: this.agentX,
        agentY: this.agentY,
        displayMode: this.displayMode,
        settings: this.settings,
        systemPrompt: this.systemPrompt
      });
    } catch (error) {
      this.status = error.message;
    }
  },

  clearInteractionHintTimer() {
    this.interactionHintTimer = clearTimer(this.interactionHintTimer);
  },

  clearUiBubbleEnterTimer() {
    this.uiBubbleEnterTimer = clearTimer(this.uiBubbleEnterTimer);
  },

  clearUiBubbleAutoHideTimer() {
    this.uiBubbleAutoHideTimer = clearTimer(this.uiBubbleAutoHideTimer);
  },

  clearUiBubbleExitTimer() {
    this.uiBubbleExitTimer = clearTimer(this.uiBubbleExitTimer);
  },

  recordInteraction(options = {}) {
    this.hasInteracted = true;
    this.clearInteractionHintTimer();

    if (options.hideBubble === true) {
      this.dismissUiBubble({
        clearQueue: options.clearBubbleQueue !== false
      });
    }
  },

  showCompactAssistantReplyBubble(assistantContent) {
    if (!this.isCompactMode) {
      return;
    }

    const bubbleText = extractAssistantBubbleText(assistantContent);

    if (!bubbleText) {
      return;
    }

    this.showUiBubble(bubbleText);
  },

  setStreamingAssistantStatus(content) {
    const nextStatus = getStreamingAssistantStatus(content);

    if (this.status !== nextStatus) {
      this.status = nextStatus;
    }
  },

  scheduleInteractionHint() {
    this.clearInteractionHintTimer();

    if (this.hasInteracted) {
      return;
    }

    this.interactionHintTimer = window.setTimeout(() => {
      this.interactionHintTimer = 0;

      if (this.hasInteracted || !this.isCompactMode || this.dragState?.moved === true) {
        return;
      }

      this.showUiBubble(IDLE_HINT_BUBBLE_TEXT);
    }, AGENT_IDLE_HINT_DELAY_MS);
  },

  showUiBubble(text, hideAfterMs = 0) {
    const normalizedText = normalizeUiBubbleText(text);

    if (!normalizedText.trim()) {
      this.dismissUiBubble({
        clearQueue: true
      });
      return;
    }

    this.nextUiBubble = {
      hideAfterMs: normalizeUiBubbleHideDelay(hideAfterMs) || getAutoUiBubbleHideDelay(normalizedText),
      text: normalizedText
    };
    this.flushUiBubbleQueue();
  },

  flushUiBubbleQueue() {
    if (this.uiBubblePhase === "leaving") {
      return;
    }

    if (this.isUiBubbleMounted) {
      this.dismissUiBubble();
      return;
    }

    const nextUiBubble = this.nextUiBubble;

    if (!nextUiBubble) {
      return;
    }

    this.nextUiBubble = null;
    this.clearUiBubbleExitTimer();
    this.clearUiBubbleEnterTimer();
    this.clearUiBubbleAutoHideTimer();
    this.uiBubbleText = nextUiBubble.text;
    this.isUiBubbleMounted = true;
    this.uiBubblePhase = "entering";
    this.uiBubbleEnterTimer = window.setTimeout(() => {
      this.uiBubbleEnterTimer = 0;

      if (!this.isUiBubbleMounted || this.uiBubblePhase !== "entering") {
        return;
      }

      this.uiBubblePhase = "visible";
    }, UI_BUBBLE_ENTER_DURATION_MS);

    if (nextUiBubble.hideAfterMs > 0) {
      this.uiBubbleAutoHideTimer = window.setTimeout(() => {
        this.uiBubbleAutoHideTimer = 0;
        this.dismissUiBubble();
      }, UI_BUBBLE_ENTER_DURATION_MS + nextUiBubble.hideAfterMs);
    }
  },

  dismissUiBubble(options = {}) {
    if (options.clearQueue === true) {
      this.nextUiBubble = null;
    }

    if (!this.isUiBubbleMounted || this.uiBubblePhase === "leaving") {
      return;
    }

    this.clearUiBubbleEnterTimer();
    this.clearUiBubbleAutoHideTimer();
    this.uiBubblePhase = "leaving";
    this.uiBubbleExitTimer = window.setTimeout(() => {
      this.uiBubbleExitTimer = 0;
      this.isUiBubbleMounted = false;
      this.uiBubblePhase = "";
      this.uiBubbleText = "";
      this.flushUiBubbleQueue();
    }, UI_BUBBLE_EXIT_DURATION_MS);
  },

  syncCurrentChatRuntime() {
    if (!this.currentChatRuntime) {
      return;
    }

    this.currentChatRuntime.messages = this.history.map((message) => createRuntimeMessageSnapshot(message));
  },

  replaceHistory(nextHistory) {
    this.history = Array.isArray(nextHistory) ? [...nextHistory] : [];
    this.syncCurrentChatRuntime();
    this.refreshHistoryMetrics();
  },

  refreshHistoryMetrics() {
    this.historyText = buildPromptHistoryText("", this.history);
    this.promptHistoryMessages = agentApi.buildOnscreenAgentPromptMessages(this.runtimeSystemPrompt, this.history);
    this.historyTokenCount = countTextTokens(formatPromptHistoryText(this.promptHistoryMessages));
  },

  getConfiguredMaxTokens() {
    return config.normalizeOnscreenAgentMaxTokens(this.settings.maxTokens);
  },

  isHistoryOverConfiguredMaxTokens() {
    return Boolean(this.historyText.trim()) && this.historyTokenCount > this.getConfiguredMaxTokens();
  },

  serializeHistory() {
    return this.history.map((message) => ({
      attachments: Array.isArray(message.attachments)
        ? message.attachments.map((attachment) => serializeAttachmentMetadata(attachment))
        : [],
      content: message.content,
      id: message.id,
      kind: message.kind || "",
      role: message.role
    }));
  },

  async flushHistoryPersistence() {
    if (this.historyPersistPromise) {
      return this.historyPersistPromise;
    }

    this.historyPersistPromise = (async () => {
      while (this.pendingHistorySnapshot) {
        const snapshot = this.pendingHistorySnapshot;
        this.pendingHistorySnapshot = null;
        await storage.saveOnscreenAgentHistory(snapshot);
      }
    })()
      .catch((error) => {
        this.status = error.message;
      })
      .finally(() => {
        this.historyPersistPromise = null;

        if (this.pendingHistorySnapshot) {
          void this.flushHistoryPersistence();
        }
      });

    return this.historyPersistPromise;
  },

  async persistHistory(options = {}) {
    this.syncCurrentChatRuntime();
    this.pendingHistorySnapshot = this.serializeHistory();
    const flushPromise = this.flushHistoryPersistence();

    if (options.immediate === true) {
      await flushPromise;

      if (this.pendingHistorySnapshot) {
        await this.flushHistoryPersistence();
      }
    }
  },

  async init() {
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = (async () => {
      this.runtime = getRuntime();
      this.currentChatRuntime = ensureCurrentChatRuntime(this.runtime);
      this.executionContext = execution.createExecutionContext({
        targetWindow: window
      });
      this.syncCurrentChatRuntime();

      try {
        const [storedConfig, storedHistory] = await Promise.all([
          storage.loadOnscreenAgentConfig(),
          storage.loadOnscreenAgentHistory()
        ]);

        this.settings = {
          ...storedConfig.settings
        };
        this.settingsDraft = {
          ...this.settings
        };
        this.systemPrompt = storedConfig.systemPrompt;
        this.systemPromptDraft = storedConfig.systemPrompt;
        this.agentX = storedConfig.agentX;
        this.agentY = storedConfig.agentY;
        this.displayMode = normalizeDisplayMode(storedConfig.displayMode);
        this.replaceHistory(storedHistory.map((message) => normalizeStoredMessage(message)));
        this.ensurePosition();

        this.status = "Loading default system prompt...";
        this.isLoadingDefaultSystemPrompt = true;

        await this.ensureDefaultSystemPrompt({
          preserveStatus: true
        });
        this.systemPrompt = prompt.extractCustomOnscreenAgentSystemPrompt(
          this.systemPrompt,
          this.defaultSystemPrompt
        );
        this.systemPromptDraft = this.systemPrompt;
        await this.refreshRuntimeSystemPrompt();

        this.isInitialized = true;
        this.status = "Ready.";
        this.render();

        if (this.hasInteracted) {
          this.focusInput();
        }
      } catch (error) {
        this.status = error.message;
        this.render();
      }
    })();

    return this.initializationPromise;
  },

  mount(refs = {}) {
    this.refs = {
      actionMenu: refs.actionMenu || null,
      attachmentInput: refs.attachmentInput || null,
      historyDialog: refs.historyDialog || null,
      input: refs.input || null,
      rawDialog: refs.rawDialog || null,
      scroller: refs.scroller || null,
      settingsDialog: refs.settingsDialog || null,
      thread: refs.thread || null
    };

    if (!this.resizeHandler) {
      this.resizeHandler = () => {
        this.ensurePosition();
        this.positionComposerActionMenu();
        this.render({
          preserveScroll: true
        });
      };
      window.addEventListener("resize", this.resizeHandler);
    }

    if (!this.dragMoveHandler) {
      this.dragMoveHandler = (event) => {
        this.handleAgentPointerMove(event);
      };
    }

    if (!this.dragEndHandler) {
      this.dragEndHandler = (event) => {
        this.handleAgentPointerUp(event);
      };
    }

    if (this.refs.input) {
      this.refs.input.value = this.draft;
      agentView.autoResizeTextarea(this.refs.input);
    }

    this.ensurePosition();
    this.render();
    this.scheduleInteractionHint();
    void this.init();
  },

  cleanupDrag() {
    if (this.dragState?.target?.releasePointerCapture && this.dragState.pointerId !== null) {
      try {
        this.dragState.target.releasePointerCapture(this.dragState.pointerId);
      } catch {
        // Ignore capture release issues.
      }
    }

    window.removeEventListener("pointermove", this.dragMoveHandler);
    window.removeEventListener("pointerup", this.dragEndHandler);
    window.removeEventListener("pointercancel", this.dragEndHandler);
    this.dragState = null;
  },

  unmount() {
    this.cleanupDrag();
    this.cancelStreamingMessageRender();
    this.clearInteractionHintTimer();
    this.clearUiBubbleEnterTimer();
    this.clearUiBubbleAutoHideTimer();
    this.clearUiBubbleExitTimer();
    this.closeComposerActionMenu();
    this.nextUiBubble = null;
    this.isUiBubbleMounted = false;
    this.uiBubblePhase = "";
    this.uiBubbleText = "";

    if (this.configPersistTimer) {
      window.clearTimeout(this.configPersistTimer);
      this.configPersistTimer = 0;
    }

    if (this.resizeHandler) {
      window.removeEventListener("resize", this.resizeHandler);
      this.resizeHandler = null;
    }

    this.refs = {
      actionMenu: null,
      attachmentInput: null,
      historyDialog: null,
      input: null,
      rawDialog: null,
      scroller: null,
      settingsDialog: null,
      thread: null
    };
  },

  handleAgentPointerDown(event) {
    if (event.button !== 0) {
      return;
    }

    this.recordInteraction();

    const target = event.currentTarget;

    this.dragState = {
      moved: false,
      originX: this.agentX,
      originY: this.agentY,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      target
    };

    if (target?.setPointerCapture) {
      try {
        target.setPointerCapture(event.pointerId);
      } catch {
        // Ignore pointer capture failures.
      }
    }

    window.addEventListener("pointermove", this.dragMoveHandler);
    window.addEventListener("pointerup", this.dragEndHandler);
    window.addEventListener("pointercancel", this.dragEndHandler);
    event.preventDefault();
  },

  handleAgentPointerMove(event) {
    if (!this.dragState || event.pointerId !== this.dragState.pointerId) {
      return;
    }

    const deltaX = event.clientX - this.dragState.startX;
    const deltaY = event.clientY - this.dragState.startY;

    if (!this.dragState.moved && Math.hypot(deltaX, deltaY) >= DRAG_CLICK_THRESHOLD) {
      this.dragState.moved = true;
    }

    this.setPosition(this.dragState.originX + deltaX, this.dragState.originY + deltaY, {
      persist: false
    });
  },

  handleAgentPointerUp(event) {
    if (!this.dragState || event.pointerId !== this.dragState.pointerId) {
      return;
    }

    const wasDrag = this.dragState.moved === true;
    this.cleanupDrag();

    if (wasDrag) {
      this.scheduleConfigPersist();
      return;
    }

    this.cycleDisplayMode();
  },

  cycleDisplayMode() {
    this.setDisplayMode(getNextDisplayMode(this.displayMode));
  },

  showFullMode(options = {}) {
    this.recordInteraction();
    this.setDisplayMode(DISPLAY_MODE_FULL, options);
  },

  showCompactMode(options = {}) {
    this.recordInteraction();
    this.setDisplayMode(DISPLAY_MODE_COMPACT, options);
  },

  setDisplayMode(nextMode, options = {}) {
    const previousMode = this.displayMode;
    const normalizedMode = normalizeDisplayMode(nextMode);
    const shouldPersist = options.persist !== false;
    const shouldHideBubble = options.hideBubble === true || normalizedMode === DISPLAY_MODE_FULL;
    const shouldFocusInput = options.focusInput !== false;
    const modeChanged = normalizedMode !== this.displayMode;
    const shouldScrollToLatestOnRender = normalizedMode === DISPLAY_MODE_FULL && previousMode !== DISPLAY_MODE_FULL;

    this.displayMode = normalizedMode;
    this.closeComposerActionMenu();

    if (shouldPersist && modeChanged) {
      this.scheduleConfigPersist();
    }

    if (shouldHideBubble) {
      this.dismissUiBubble({
        clearQueue: true
      });
    }

    this.render({
      preserveScroll: !shouldScrollToLatestOnRender
    });

    if (shouldScrollToLatestOnRender) {
      this.scrollHistoryToLatest();
    }

    if (shouldFocusInput) {
      this.focusInput();
    }
  },

  async ensureDefaultSystemPrompt(options = {}) {
    const preserveStatus = options.preserveStatus === true;

    if (!this.defaultSystemPrompt || options.forceRefresh === true) {
      this.isLoadingDefaultSystemPrompt = true;

      try {
        this.defaultSystemPrompt = await prompt.fetchDefaultOnscreenAgentSystemPrompt({
          forceRefresh: options.forceRefresh
        });
      } finally {
        this.isLoadingDefaultSystemPrompt = false;
      }
    }

    if (!preserveStatus) {
      this.status = "Ready.";
    }

    return this.defaultSystemPrompt;
  },

  async refreshRuntimeSystemPrompt() {
    this.runtimeSystemPrompt = await prompt.buildRuntimeOnscreenAgentSystemPrompt(this.systemPrompt, {
      defaultSystemPrompt: this.defaultSystemPrompt
    });
    this.refreshHistoryMetrics();
    return this.runtimeSystemPrompt;
  },

  cancelStreamingMessageRender() {
    if (this.streamingRenderFrame) {
      window.cancelAnimationFrame(this.streamingRenderFrame);
      this.streamingRenderFrame = 0;
    }

    this.pendingStreamingMessage = null;
  },

  scheduleStreamingMessageRender(message) {
    if (!message || message.role !== "assistant" || message.streaming !== true) {
      return;
    }

    this.pendingStreamingMessage = message;

    if (this.streamingRenderFrame || !this.isFullMode) {
      return;
    }

    this.streamingRenderFrame = window.requestAnimationFrame(() => {
      this.streamingRenderFrame = 0;
      const pendingMessage = this.pendingStreamingMessage;
      this.pendingStreamingMessage = null;

      if (!pendingMessage || !this.refs.thread || !this.isFullMode) {
        return;
      }

      agentView.updateStreamingAssistantMessage(this.refs.thread, pendingMessage, {
        scroller: this.refs.scroller
      });
    });
  },

  render(options = {}) {
    if (!this.isFullMode) {
      return;
    }

    agentView.renderMessages(this.refs.thread, this.history, {
      isConversationBusy: this.isSending,
      outputOverrides: this.executionOutputOverrides,
      preserveScroll: options.preserveScroll === true,
      queuedMessages: this.getQueuedPreviewMessages(),
      rerunningMessageId: this.rerunningMessageId,
      scroller: this.refs.scroller
    });
  },

  scrollHistoryToLatest() {
    const applyScroll = () => {
      const scroller = this.refs.scroller;

      if (!scroller || !this.isFullMode) {
        return;
      }

      scroller.scrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    };

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        applyScroll();

        window.requestAnimationFrame(() => {
          applyScroll();
        });
      });
    });
  },

  focusInput() {
    const input = this.refs.input;

    if (!input || input.disabled) {
      return;
    }

    window.requestAnimationFrame(() => {
      try {
        input.focus({
          preventScroll: true
        });
      } catch {
        input.focus();
      }

      if (typeof input.setSelectionRange === "function") {
        const cursorPosition = input.value.length;
        input.setSelectionRange(cursorPosition, cursorPosition);
      }
    });
  },

  syncDraft(value) {
    this.draft = value;

    if (this.refs.input) {
      agentView.autoResizeTextarea(this.refs.input);
    }
  },

  clearComposerDraft() {
    this.draft = "";
    this.draftAttachments = [];

    if (this.refs.input) {
      this.refs.input.value = "";
      agentView.autoResizeTextarea(this.refs.input);
    }

    if (this.refs.attachmentInput) {
      this.refs.attachmentInput.value = "";
    }
  },

  createDraftSubmissionSnapshot() {
    const content = this.draft.trim();
    const attachments = this.draftAttachments.slice();

    if (!content && !attachments.length) {
      return null;
    }

    return {
      attachments,
      content
    };
  },

  queueDraftSubmission() {
    const snapshot = this.createDraftSubmissionSnapshot();

    if (!snapshot) {
      return false;
    }

    this.queuedSubmissions = [...this.queuedSubmissions, snapshot];
    this.clearComposerDraft();
    this.status =
      this.queuedSubmissionCount === 1
        ? "1 message queued for the next step."
        : `${this.queuedSubmissionCount} messages queued for the next steps.`;
    this.render({
      preserveScroll: true
    });
    return true;
  },

  consumeNextQueuedSubmissionMessage() {
    if (!this.queuedSubmissions.length) {
      return null;
    }

    const [snapshot, ...rest] = this.queuedSubmissions;
    this.queuedSubmissions = rest;
    return createMessage("user", snapshot.content, {
      attachments: Array.isArray(snapshot.attachments) ? snapshot.attachments.slice() : []
    });
  },

  getQueuedPreviewMessages() {
    return this.queuedSubmissions.map((submission, index) =>
      createMessage("user", submission.content, {
        attachments: Array.isArray(submission.attachments) ? submission.attachments.slice() : [],
        kind: "queued"
      })
    ).map((message, index) => ({
      ...message,
      id: `queued-preview-${index}`
    }));
  },

  getBoundaryAction() {
    if (this.hasQueuedSubmission) {
      return "queued";
    }

    if (this.stopRequested) {
      return "stopped";
    }

    return "";
  },

  handleDraftInput(event) {
    this.recordInteraction();
    this.syncDraft(event.target.value);
  },

  closeComposerActionMenu() {
    this.composerActionMenuAnchor = null;
    this.composerActionMenuPosition = createComposerActionMenuPosition();
  },

  openComposerActionMenu(anchor) {
    this.composerActionMenuAnchor = anchor || null;

    globalThis.requestAnimationFrame(() => {
      this.positionComposerActionMenu();

      globalThis.requestAnimationFrame(() => {
        this.positionComposerActionMenu();
      });
    });
  },

  positionComposerActionMenu() {
    const actionMenu = this.refs.actionMenu || document.getElementById("onscreen-agent-composer-menu");

    if (!this.isComposerActionMenuOpen || !actionMenu || !this.composerActionMenuAnchor) {
      return;
    }

    this.refs.actionMenu = actionMenu;
    this.composerActionMenuPosition = positionPopover(actionMenu, this.composerActionMenuAnchor, {
      align: "end",
      placement: this.shouldOpenComposerActionMenuBelow ? "bottom" : "top"
    });
  },

  async submitComposerActionMenuAction(actionId) {
    this.closeComposerActionMenu();

    switch (actionId) {
      case "full-mode":
        this.showFullMode();
        return;
      case "attach":
        this.openAttachmentPicker();
        return;
      case "clear":
        if (this.isSending || this.isLoadingDefaultSystemPrompt || this.isCompactingHistory) {
          return;
        }

        await this.handleClearClick();
        return;
      case "compact-history":
        if (this.isCompactDisabled) {
          return;
        }

        await this.handleCompactClick();
        return;
      case "history":
        runOnNextFrame(() => {
          void this.openPromptHistoryDialog();
        });
        return;
      case "settings":
        runOnNextFrame(() => {
          this.openSettingsDialog();
        });
        return;
      default:
        return;
    }
  },

  toggleComposerActionMenu(event) {
    const anchor = event?.currentTarget || null;

    if (!anchor) {
      return;
    }

    this.recordInteraction();

    if (this.composerActionMenuAnchor === anchor) {
      this.closeComposerActionMenu();
      return;
    }

    this.openComposerActionMenu(anchor);
  },

  openAttachmentPicker() {
    if (this.isAttachmentPickerDisabled) {
      return;
    }

    this.recordInteraction();
    this.refs.attachmentInput?.click();
  },

  handleAttachmentInput(event) {
    const nextAttachments = createDraftAttachments(event?.target?.files);

    if (!nextAttachments.length) {
      if (event?.target) {
        event.target.value = "";
      }
      return;
    }

    const existingKeys = new Set(
      this.draftAttachments.map(
        (attachment) =>
          `${attachment.name}::${attachment.size}::${attachment.lastModified}::${attachment.type}`
      )
    );
    const uniqueAttachments = nextAttachments.filter((attachment) => {
      const key = `${attachment.name}::${attachment.size}::${attachment.lastModified}::${attachment.type}`;

      if (existingKeys.has(key)) {
        return false;
      }

      existingKeys.add(key);
      return true;
    });

    if (uniqueAttachments.length) {
      this.draftAttachments = [...this.draftAttachments, ...uniqueAttachments];
      this.render({
        preserveScroll: true
      });
      this.status = `${this.draftAttachments.length} attachment${
        this.draftAttachments.length === 1 ? "" : "s"
      } ready.`;
    }

    if (event?.target) {
      event.target.value = "";
    }
  },

  removeDraftAttachment(attachmentId) {
    const nextAttachments = this.draftAttachments.filter((attachment) => attachment.id !== attachmentId);

    if (nextAttachments.length === this.draftAttachments.length) {
      return;
    }

    this.draftAttachments = nextAttachments;
    this.render({
      preserveScroll: true
    });
    this.status = this.draftAttachments.length
      ? `${this.draftAttachments.length} attachment${this.draftAttachments.length === 1 ? "" : "s"} ready.`
      : "Attachment removed.";
  },

  handleComposerKeydown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      this.handleComposerPrimaryAction();
    }
  },

  handleComposerPrimaryAction() {
    this.recordInteraction();

    if (this.isSending) {
      if (this.queueDraftSubmission()) {
        return;
      }

      if (!this.hasQueuedSubmission) {
        this.requestStop();
      }

      return;
    }

    void this.submitMessage();
  },

  requestStop() {
    if (!this.isSending) {
      return;
    }

    this.stopRequested = true;
    this.activeRequestController?.abort();
    this.status = "Stopping after the current step...";
  },

  openSettingsDialog() {
    this.recordInteraction();
    this.settingsDraft = {
      ...this.settings
    };
    this.systemPromptDraft = this.systemPrompt;
    openDialog(resolveDialogRef(this.refs, "settingsDialog", SETTINGS_DIALOG_ELEMENT_ID));
  },

  closeSettingsDialog() {
    closeDialog(resolveDialogRef(this.refs, "settingsDialog", SETTINGS_DIALOG_ELEMENT_ID));
  },

  resetSettingsDraftToDefaults() {
    const preservedApiKey =
      typeof this.settingsDraft.apiKey === "string" ? this.settingsDraft.apiKey : "";

    this.settingsDraft = {
      ...config.DEFAULT_ONSCREEN_AGENT_SETTINGS,
      apiKey: preservedApiKey
    };
    this.status = "LLM settings draft reset to defaults except API key.";
  },

  async saveSettingsFromDialog() {
    const paramsText = typeof this.settingsDraft.paramsText === "string" ? this.settingsDraft.paramsText.trim() : "";
    const draftPrompt = typeof this.systemPromptDraft === "string" ? this.systemPromptDraft.trim() : "";
    let maxTokens = config.DEFAULT_ONSCREEN_AGENT_SETTINGS.maxTokens;

    try {
      maxTokens = config.parseOnscreenAgentMaxTokens(this.settingsDraft.maxTokens);
      llmParams.parseOnscreenAgentParamsText(paramsText);
    } catch (error) {
      this.status = error.message;
      return;
    }

    this.settings = {
      apiEndpoint: (this.settingsDraft.apiEndpoint || "").trim(),
      apiKey: (this.settingsDraft.apiKey || "").trim(),
      maxTokens,
      model: (this.settingsDraft.model || "").trim(),
      paramsText
    };
    this.systemPrompt = draftPrompt;
    this.systemPromptDraft = draftPrompt;

    try {
      await this.refreshRuntimeSystemPrompt();
      await this.persistConfig();
      this.status = "Chat settings updated.";
      this.closeSettingsDialog();
    } catch (error) {
      this.status = error.message;
    }
  },

  openRawDialogForMessage(messageId) {
    const message = this.history.find((entry) => entry.id === messageId && entry.role === "assistant");

    if (!message) {
      this.status = "That assistant message is no longer available.";
      return;
    }

    this.rawOutputTitle = "Raw LLM Output";
    this.rawOutputContent = typeof message.content === "string" ? message.content : "";
    openDialog(resolveDialogRef(this.refs, "rawDialog", RAW_DIALOG_ELEMENT_ID));
  },

  closeRawDialog() {
    closeDialog(resolveDialogRef(this.refs, "rawDialog", RAW_DIALOG_ELEMENT_ID));
  },

  async openPromptHistoryDialog() {
    this.recordInteraction();

    try {
      const runtimeSystemPrompt = await this.refreshRuntimeSystemPrompt();
      this.promptHistoryMessages = agentApi.buildOnscreenAgentPromptMessages(runtimeSystemPrompt, this.history);
      const totalTokens = countTextTokens(formatPromptHistoryText(this.promptHistoryMessages));
      this.promptHistoryTitle = `Context window (${totalTokens.toLocaleString()} tokens)`;
      this.promptHistoryMode = "text";
      openDialog(resolveDialogRef(this.refs, "historyDialog", HISTORY_DIALOG_ELEMENT_ID));
    } catch (error) {
      this.status = error.message;
    }
  },

  closePromptHistoryDialog() {
    closeDialog(resolveDialogRef(this.refs, "historyDialog", HISTORY_DIALOG_ELEMENT_ID));
  },

  setPromptHistoryMode(mode) {
    this.promptHistoryMode = mode === "json" ? "json" : "text";
  },

  async copyPromptHistory() {
    const copied = await agentView.copyTextToClipboard(this.promptHistoryContent || "");
    this.status = copied ? "Context window copied." : "Unable to copy context window.";
  },

  async handleClearClick() {
    this.closeComposerActionMenu();
    this.closeRawDialog();
    this.rawOutputContent = "";
    this.clearComposerDraft();
    this.queuedSubmissions = [];
    this.cancelStreamingMessageRender();
    this.replaceHistory([]);
    this.executionOutputOverrides = Object.create(null);
    this.rerunningMessageId = "";
    this.stopRequested = false;
    this.activeRequestController?.abort();
    this.activeRequestController = null;
    this.dismissUiBubble({
      clearQueue: true
    });

    if (this.currentChatRuntime?.attachments) {
      this.currentChatRuntime.attachments.clear();
    }

    if (this.executionContext) {
      this.executionContext.reset();
    }

    await this.persistHistory({
      immediate: true
    });
    this.render();
    this.status = "Chat cleared and execution context reset.";
  },

  async streamAssistantResponse(requestMessages, assistantMessage) {
    this.status = "Thinking...";
    const runtimeSystemPrompt = await prompt.buildRuntimeOnscreenAgentSystemPrompt(this.systemPrompt, {
      defaultSystemPrompt: this.defaultSystemPrompt
    });
    this.runtimeSystemPrompt = runtimeSystemPrompt;
    const controller = new AbortController();
    this.activeRequestController = controller;

    try {
      await agentApi.streamOnscreenAgentCompletion({
        settings: this.settings,
        systemPrompt: runtimeSystemPrompt,
        messages: requestMessages,
        onDelta: (delta) => {
          assistantMessage.content += delta;
          this.setStreamingAssistantStatus(assistantMessage.content);
          this.scheduleStreamingMessageRender(assistantMessage);
        },
        signal: controller.signal
      });
    } catch (error) {
      assistantMessage.streaming = false;
      this.cancelStreamingMessageRender();

      if (this.activeRequestController === controller) {
        this.activeRequestController = null;
      }

      if (isAbortError(error) && this.stopRequested) {
        const hasContent = Boolean(assistantMessage.content.trim());

        if (hasContent) {
          this.refreshHistoryMetrics();
          await this.persistHistory({
            immediate: true
          });
          this.render();
        }

        return {
          hasContent,
          stopped: true
        };
      }

      throw error;
    }

    assistantMessage.streaming = false;
    this.cancelStreamingMessageRender();

    if (this.activeRequestController === controller) {
      this.activeRequestController = null;
    }

    this.refreshHistoryMetrics();
    await this.persistHistory({
      immediate: true
    });
    this.render();
    return {
      hasContent: Boolean(assistantMessage.content.trim()),
      stopped: false
    };
  },

  async handleCompactClick() {
    if (this.isSending) {
      return;
    }

    await this.init();

    if (this.isLoadingDefaultSystemPrompt) {
      this.status = "Loading default system prompt...";
      return;
    }

    try {
      await this.refreshRuntimeSystemPrompt();
    } catch (error) {
      this.status = error.message;
      return;
    }

    await this.compactHistory();
  },

  async compactHistory(options = {}) {
    const historyText = this.historyText.trim();
    const mode =
      options.mode === prompt.ONSCREEN_AGENT_HISTORY_COMPACT_MODE.AUTOMATIC
        ? prompt.ONSCREEN_AGENT_HISTORY_COMPACT_MODE.AUTOMATIC
        : prompt.ONSCREEN_AGENT_HISTORY_COMPACT_MODE.USER;
    const preserveFocus = options.preserveFocus !== false;
    const statusText =
      typeof options.statusText === "string" && options.statusText.trim()
        ? options.statusText.trim()
        : mode === prompt.ONSCREEN_AGENT_HISTORY_COMPACT_MODE.AUTOMATIC
          ? "Compacting history before continuing..."
          : "Compacting history...";

    if (!historyText) {
      this.status = "No history to compact.";
      return false;
    }

    const previousSendingState = this.isSending;
    this.isSending = true;
    this.isCompactingHistory = true;
    const previousTokenCount = this.historyTokenCount;
    this.status = statusText;

    try {
      const compactPrompt = await prompt.fetchOnscreenAgentHistoryCompactPrompt({
        mode
      });
      let trimmedHistoryText = historyText;

      for (let attempt = 0; attempt < MAX_COMPACT_TRIM_ATTEMPTS; attempt += 1) {
        let compactedHistory = "";
        let compactionError = null;

        try {
          await agentApi.streamOnscreenAgentCompletion({
            settings: this.settings,
            systemPrompt: compactPrompt,
            messages: [
              {
                role: "user",
                content: trimmedHistoryText
              }
            ],
            onDelta: (delta) => {
              compactedHistory += delta;
            }
          });
        } catch (error) {
          compactionError = error;
        }

        if (!compactionError) {
          const normalizedCompactedHistory = compactedHistory.trim();

          if (!normalizedCompactedHistory) {
            throw new Error("History compaction returned no content.");
          }

          const compactedMessage = createMessage("user", normalizedCompactedHistory, {
            kind: "history-compact"
          });
          this.executionOutputOverrides = Object.create(null);
          this.rerunningMessageId = "";
          this.replaceHistory([compactedMessage]);
          await this.persistHistory({
            immediate: true
          });
          this.status = `History compacted from ${previousTokenCount.toLocaleString()} to ${this.historyTokenCount.toLocaleString()} tokens.`;
          return compactedMessage;
        }

        const isLastAttempt = attempt === MAX_COMPACT_TRIM_ATTEMPTS - 1;

        if (isLastAttempt || !isContextLengthError(compactionError)) {
          throw compactionError;
        }

        trimmedHistoryText = trimHistoryTextToRecentMessages(trimmedHistoryText);

        if (!trimmedHistoryText.trim()) {
          throw new Error("History compaction failed: content still too large after trimming.");
        }

        this.status = `Context too large, retrying with trimmed history (attempt ${attempt + 2}/${MAX_COMPACT_TRIM_ATTEMPTS})...`;
      }
    } catch (error) {
      this.status = error.message;
      return false;
    } finally {
      this.isCompactingHistory = false;
      this.isSending = previousSendingState;
      this.render();

      if (preserveFocus) {
        this.focusInput();
      }
    }
  },

  async executeAssistantBlocks(assistantContent) {
    const executionResults = await this.executionContext.executeFromContent(assistantContent, {
      onBeforeBlock: async ({ code, index, total }) => {
        if (!total) {
          return;
        }

        this.status = getExecutionStatusText(code, index, total);
      }
    });

    if (!executionResults.length) {
      return null;
    }

    return executionResults;
  },

  async runConversationLoop(initialUserMessage) {
    this.currentChatRuntime.attachments.rememberMessageAttachments(
      initialUserMessage.id,
      initialUserMessage.attachments
    );
    this.currentChatRuntime.attachments.setActiveMessage(initialUserMessage.id);

    let nextUserMessage = initialUserMessage;
    let emptyAssistantRetryCount = 0;
    let missingExecutionResultRetryCount = 0;

    while (nextUserMessage) {
      if (this.isHistoryOverConfiguredMaxTokens()) {
        const pendingMessageIsLatestHistoryMessage = this.history[this.history.length - 1]?.id === nextUserMessage.id;
        const compactedMessage = await this.compactHistory({
          mode: prompt.ONSCREEN_AGENT_HISTORY_COMPACT_MODE.AUTOMATIC,
          preserveFocus: false,
          statusText: "Compacting history before continuing..."
        });

        if (!compactedMessage) {
          return "failed";
        }

        if (pendingMessageIsLatestHistoryMessage) {
          nextUserMessage = compactedMessage;
        }
      }

      const boundaryActionBeforeStream = this.getBoundaryAction();

      if (boundaryActionBeforeStream) {
        return boundaryActionBeforeStream;
      }

      const requestMessages =
        this.history[this.history.length - 1]?.id === nextUserMessage.id
          ? [...this.history]
          : [...this.history, nextUserMessage];
      const assistantMessage = createStreamingAssistantMessage();

      this.history = [...requestMessages, assistantMessage];
      this.render();

      try {
        const streamResult = await this.streamAssistantResponse(requestMessages, assistantMessage);

        if (streamResult.stopped) {
          if (!streamResult.hasContent) {
            this.replaceHistory(requestMessages);
            await this.persistHistory({
              immediate: true
            });
            this.render();
          }

          return this.getBoundaryAction() || "stopped";
        }

        const boundaryActionAfterResponse = this.getBoundaryAction();

        if (streamResult.hasContent) {
          this.showCompactAssistantReplyBubble(assistantMessage.content);
        }

        if (boundaryActionAfterResponse) {
          return boundaryActionAfterResponse;
        }

        if (!streamResult.hasContent) {
          if (isExecutionFollowUpKind(nextUserMessage.kind) && emptyAssistantRetryCount < MAX_PROTOCOL_RETRY_COUNT) {
            emptyAssistantRetryCount += 1;
            this.replaceHistory(requestMessages);
            await this.persistHistory({
              immediate: true
            });
            this.render();
            nextUserMessage = createMessage(
              "user",
              buildEmptyAssistantRetryMessage(nextUserMessage.content),
              {
                kind: "execution-retry"
              }
            );
            this.status = "Retrying: assistant reply was empty after execution...";
            continue;
          }

          assistantMessage.content = "[No content returned]";
          this.refreshHistoryMetrics();
          await this.persistHistory({
            immediate: true
          });
          this.render();
          return "complete";
        }
      } catch (error) {
        assistantMessage.streaming = false;
        this.cancelStreamingMessageRender();

        if (!assistantMessage.content.trim()) {
          this.replaceHistory(requestMessages);
        } else {
          this.refreshHistoryMetrics();
        }

        await this.persistHistory({
          immediate: true
        });
        this.render();
        throw error;
      }

      emptyAssistantRetryCount = 0;
      const executionResults = await this.executeAssistantBlocks(assistantMessage.content);

      if (!executionResults || !executionResults.length) {
        return "complete";
      }

      const executionOutputMessage = createMessage("user", execution.formatExecutionResultsMessage(executionResults), {
        kind: "execution-output"
      });
      this.replaceHistory([...this.history, executionOutputMessage]);
      await this.persistHistory({
        immediate: true
      });
      this.render();

      const boundaryActionAfterExecution = this.getBoundaryAction();

      if (boundaryActionAfterExecution) {
        return boundaryActionAfterExecution;
      }

      if (
        executionResultsNeedReturnedValue(executionResults) &&
        missingExecutionResultRetryCount < MAX_PROTOCOL_RETRY_COUNT
      ) {
        missingExecutionResultRetryCount += 1;
        nextUserMessage = createMessage(
          "user",
          buildMissingExecutionResultRetryMessage(executionOutputMessage.content),
          {
            kind: "execution-retry"
          }
        );
        this.status = "Retrying: browser code returned no result...";
        continue;
      }

      missingExecutionResultRetryCount = 0;
      nextUserMessage = executionOutputMessage;
      this.status = "Sending code execution output...";
    }

    return "complete";
  },

  async runSubmissionSeries(initialUserMessage) {
    let nextUserMessage = initialUserMessage;
    let finalOutcome = "complete";

    this.isSending = true;
    this.stopRequested = false;

    try {
      while (nextUserMessage) {
        const outcome = await this.runConversationLoop(nextUserMessage);
        finalOutcome = outcome;

        if (outcome === "queued") {
          nextUserMessage = this.consumeNextQueuedSubmissionMessage();

          if (nextUserMessage) {
            this.stopRequested = false;
            this.status = "Sending queued message...";
            continue;
          }

          finalOutcome = "complete";
          break;
        }

        if (outcome === "stopped") {
          this.status = "Stopped.";
          break;
        }

        if (outcome === "failed") {
          break;
        }

        const queuedMessage = this.consumeNextQueuedSubmissionMessage();

        if (queuedMessage) {
          nextUserMessage = queuedMessage;
          this.status = "Sending queued message...";
          continue;
        }

        nextUserMessage = null;
      }

      if (finalOutcome === "complete") {
        this.status = "Ready.";
      }
    } catch (error) {
      this.status = error.message;
    } finally {
      this.activeRequestController = null;
      this.isSending = false;
      this.stopRequested = false;
      this.render();
      this.focusInput();
    }
  },

  async submitMessage() {
    if (this.isSending) {
      return;
    }

    await this.init();

    if (this.isLoadingDefaultSystemPrompt) {
      this.status = "Loading default system prompt...";
      return;
    }

    const draftSubmission = this.createDraftSubmissionSnapshot();

    if (!draftSubmission) {
      return;
    }

    try {
      await this.refreshRuntimeSystemPrompt();
    } catch (error) {
      this.status = error.message;
      return;
    }

    if (this.isHistoryOverConfiguredMaxTokens()) {
      const compacted = await this.compactHistory({
        mode: prompt.ONSCREEN_AGENT_HISTORY_COMPACT_MODE.AUTOMATIC,
        preserveFocus: false,
        statusText: "Compacting history before send..."
      });

      if (!compacted) {
        return;
      }
    }

    const userMessage = createMessage("user", draftSubmission.content, {
      attachments: draftSubmission.attachments
    });
    this.clearComposerDraft();
    await this.runSubmissionSeries(userMessage);
  },

  async handleThreadClick(event) {
    const messageActionButton = event.target.closest("[data-message-action]");

    if (messageActionButton && this.refs.thread && this.refs.thread.contains(messageActionButton)) {
      const action = messageActionButton.dataset.messageAction;
      const messageId = messageActionButton.dataset.messageId;

      if (action === "show-raw" && messageId) {
        this.openRawDialogForMessage(messageId);
        return;
      }

      if (action === "copy-message" && messageId) {
        const copyPayload = agentView.getAssistantMessageCopyText(
          this.history,
          messageId,
          this.executionOutputOverrides
        );
        const copied = copyPayload.text ? await agentView.copyTextToClipboard(copyPayload.text) : false;
        this.status = copied
          ? copyPayload.kind === "result"
            ? "Result copied."
            : "Response copied."
          : "Unable to copy response.";
      }

      return;
    }

    const actionButton = event.target.closest("[data-terminal-action]");

    if (!actionButton || !this.refs.thread || !this.refs.thread.contains(actionButton)) {
      return;
    }

    const action = actionButton.dataset.terminalAction;
    const messageId = actionButton.dataset.terminalMessageId;

    if (!action || !messageId) {
      return;
    }

    const section = agentView.findExecuteSection(this.history, messageId, this.executionOutputOverrides);

    if (!section) {
      this.status = "That execution step is no longer available.";
      return;
    }

    if (action === "copy-input") {
      const copied = await agentView.copyTextToClipboard(agentView.getTerminalInputText(section.executeDisplay));
      this.status = copied ? "Input copied." : "Unable to copy input.";
      return;
    }

    if (action === "copy-output") {
      if (!Array.isArray(section.outputResults) || !section.outputResults.length) {
        this.status = "No execution output to copy yet.";
        return;
      }

      const outputText = agentView.getTerminalOutputText(section.outputResults);
      const copied = outputText ? await agentView.copyTextToClipboard(outputText) : false;
      this.status = copied ? "Output copied." : "Unable to copy output.";
      return;
    }

    if (action !== "rerun" || this.isSending) {
      return;
    }

    actionButton.blur?.();
    this.isSending = true;
    this.rerunningMessageId = messageId;
    const inputMessage = findConversationInputMessage(this.history, messageId);
    this.currentChatRuntime.attachments.setActiveMessage(inputMessage?.id || "");
    this.render({
      preserveScroll: true
    });

    try {
      const executionResults = await this.executeAssistantBlocks(section.message.content);

      if (!executionResults || !executionResults.length) {
        this.status = "No execution code found to rerun.";
        return;
      }

      this.executionOutputOverrides[messageId] = execution.createExecutionOutputSnapshots(executionResults);
      this.status = "Execution refreshed.";
    } catch (error) {
      this.status = error.message;
    } finally {
      this.isSending = false;
      this.rerunningMessageId = "";
      this.render({
        preserveScroll: true
      });
    }
  }
};

const onscreenAgent = space.fw.createStore("onscreenAgent", model);

export { onscreenAgent };
