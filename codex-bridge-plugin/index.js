const DEFAULT_CONFIG = {
  enabled: true,
  mode: "full-proxy",
  sidecarUrl: "http://127.0.0.1:3790",
  requestTimeoutMs: 10 * 60 * 1000,
  interceptChannels: ["wecom"],
  bypassPrefixes: [
    "/help",
    "/status",
    "/model",
    "/models",
    "/new",
    "/reset",
    "/doctor",
    "/plugins",
    "/codex",
    "/codex-bridge-status"
  ],
  replyPrefix: "",
  includeMetadata: true
};

const recentMessageKeys = new Map();

function normalizeStringArray(value, fallback) {
  if (!Array.isArray(value)) return fallback;
  return value
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
}

function resolveConfig(api) {
  const raw = api.pluginConfig && typeof api.pluginConfig === "object" ? api.pluginConfig : {};
  return {
    enabled: raw.enabled !== false,
    mode: raw.mode === "command-only" ? "command-only" : DEFAULT_CONFIG.mode,
    sidecarUrl: typeof raw.sidecarUrl === "string" && raw.sidecarUrl.trim() ? raw.sidecarUrl.trim().replace(/\/$/, "") : DEFAULT_CONFIG.sidecarUrl,
    requestTimeoutMs: Number.isFinite(raw.requestTimeoutMs) ? Math.max(1000, Math.floor(raw.requestTimeoutMs)) : DEFAULT_CONFIG.requestTimeoutMs,
    interceptChannels: normalizeStringArray(raw.interceptChannels, DEFAULT_CONFIG.interceptChannels),
    bypassPrefixes: normalizeStringArray(raw.bypassPrefixes, DEFAULT_CONFIG.bypassPrefixes),
    replyPrefix: typeof raw.replyPrefix === "string" ? raw.replyPrefix : DEFAULT_CONFIG.replyPrefix,
    includeMetadata: raw.includeMetadata !== false
  };
}

function shouldBypassMessage(content, cfg) {
  const text = String(content || "").trim();
  if (!text) return true;
  return cfg.bypassPrefixes.some((prefix) => text.startsWith(prefix));
}

function shouldInterceptChannel(channelId, cfg) {
  if (!cfg.interceptChannels.length) return true;
  return cfg.interceptChannels.includes(String(channelId || "").trim());
}

function buildDedupeKey(payload) {
  const messageId = String(payload.messageId || "").trim();
  if (messageId) return `${payload.channelId}:${messageId}`;
  return `${payload.channelId}:${payload.sessionKey}:${payload.prompt}`;
}

function markSeen(key) {
  const now = Date.now();
  recentMessageKeys.set(key, now);
  for (const [candidate, ts] of recentMessageKeys.entries()) {
    if (now - ts > 2 * 60 * 1000) recentMessageKeys.delete(candidate);
  }
}

function wasSeen(key) {
  return recentMessageKeys.has(key);
}

function buildHookPayload(event, cfg) {
  const context = event && event.context && typeof event.context === "object" ? event.context : {};
  const prompt = String(context.content || "").trim();
  return {
    source: "openclaw-hook",
    sessionKey: String(event.sessionKey || "").trim(),
    prompt,
    channelId: String(context.channelId || "").trim(),
    messageId: String(context.messageId || "").trim(),
    metadata: cfg.includeMetadata ? {
      from: context.from,
      timestamp: context.timestamp,
      accountId: context.accountId,
      conversationId: context.conversationId,
      metadata: context.metadata
    } : {}
  };
}

function buildCommandPayload(ctx, cfg) {
  const prompt = String(ctx.args || "").trim();
  return {
    source: "openclaw-command",
    sessionKey: `${ctx.channel}:${ctx.senderId || "unknown"}`,
    prompt,
    channelId: String(ctx.channelId || ctx.channel || "").trim(),
    messageId: "",
    metadata: cfg.includeMetadata ? {
      senderId: ctx.senderId,
      from: ctx.from,
      to: ctx.to,
      accountId: ctx.accountId,
      messageThreadId: ctx.messageThreadId,
      authorized: ctx.isAuthorizedSender
    } : {}
  };
}

async function callSidecar(cfg, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.requestTimeoutMs);
  try {
    const response = await fetch(`${cfg.sidecarUrl}/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = {
        ok: response.ok,
        reply: text
      };
    }
    if (!response.ok) {
      const error = typeof data.error === "string" && data.error ? data.error : `sidecar returned HTTP ${response.status}`;
      throw new Error(error);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function formatReply(cfg, reply) {
  const text = String(reply || "").trim();
  if (!text) return "";
  return cfg.replyPrefix ? `${cfg.replyPrefix}${text}` : text;
}

async function buildStatusText(cfg) {
  try {
    const response = await fetch(`${cfg.sidecarUrl}/health`);
    if (!response.ok) return `codex-bridge: sidecar unhealthy (${response.status})`;
    const data = await response.json();
    return [
      "codex-bridge: ready",
      `mode: ${cfg.mode}`,
      `sidecar: ${cfg.sidecarUrl}`,
      `adapter: ${data.adapter || "unknown"}`,
      `command: ${data.command || "(not set)"}`
    ].join("\n");
  } catch (error) {
    return `codex-bridge: sidecar unavailable\n${error instanceof Error ? error.message : String(error)}`;
  }
}

const plugin = {
  id: "codex-bridge-plugin",
  name: "Codex Bridge",
  description: "Best-effort full-proxy bridge from OpenClaw to a local Codex sidecar.",
  register(api) {
    api.registerCommand({
      name: "codex-bridge-status",
      description: "Show Codex bridge sidecar status.",
      acceptsArgs: false,
      requireAuth: false,
      handler: async () => {
        const cfg = resolveConfig(api);
        return { text: await buildStatusText(cfg) };
      }
    });

    api.registerCommand({
      name: "codex",
      description: "Delegate a task directly to the Codex bridge sidecar.",
      acceptsArgs: true,
      requireAuth: false,
      handler: async (ctx) => {
        const cfg = resolveConfig(api);
        const payload = buildCommandPayload(ctx, cfg);
        if (!payload.prompt) return { text: "Usage: /codex <task>" };
        try {
          const result = await callSidecar(cfg, payload);
          return { text: formatReply(cfg, result.reply || result.output || "") || "Codex sidecar returned an empty reply." };
        } catch (error) {
          return { text: `codex-bridge error: ${error instanceof Error ? error.message : String(error)}` };
        }
      }
    });

    api.registerHook("message:received", async (event) => {
      const cfg = resolveConfig(api);
      if (!cfg.enabled || cfg.mode !== "full-proxy") return;
      if (event.type !== "message" || event.action !== "received") return;

      const payload = buildHookPayload(event, cfg);
      if (!shouldInterceptChannel(payload.channelId, cfg)) return;
      if (shouldBypassMessage(payload.prompt, cfg)) return;

      const dedupeKey = buildDedupeKey(payload);
      if (wasSeen(dedupeKey)) return;
      markSeen(dedupeKey);

      try {
        const result = await callSidecar(cfg, payload);
        const reply = formatReply(cfg, result.reply || result.output || "");
        if (reply) {
          event.messages.push(reply);
          api.logger.info(`codex-bridge proxied message for ${payload.channelId}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        event.messages.push(`codex-bridge error: ${message}`);
        api.logger.warn(`codex-bridge failed: ${message}`);
      }
    });
  }
};

export default plugin;
