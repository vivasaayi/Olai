import { randomUUID } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";

const listenHost = process.env.LMSTUDIO_PROXY_HOST || process.env.LLM_ROUTER_HOST || "0.0.0.0";
const listenPort = Number(process.env.LMSTUDIO_PROXY_PORT || process.env.LLM_ROUTER_PORT || "1235");
const targetHost = process.env.LMSTUDIO_TARGET_HOST || "127.0.0.1";
const targetPort = Number(process.env.LMSTUDIO_TARGET_PORT || "1234");
const defaultProviderId = process.env.LLM_ROUTER_DEFAULT_PROVIDER || "lmstudio";
const registryFile = process.env.LLM_ROUTER_REGISTRY_FILE
  || path.resolve(process.cwd(), "config", "llm-router.local.json");
const aruviConfigFile = process.env.ARUVI_LLM_CONFIG_FILE
  || path.join(os.homedir(), ".aruvistudio", "llm-config.json");
const traceFile = process.env.LLM_ROUTER_TRACE_FILE
  || path.resolve(process.cwd(), "logs", "llm-router-traces.jsonl");
const traceBody = parseBoolean(process.env.LLM_ROUTER_TRACE_BODY);
const maxTracePreviewBytes = Number(process.env.LLM_ROUTER_TRACE_PREVIEW_BYTES || "1200");
const maxBufferedRequestBytes = Number(process.env.LLM_ROUTER_MAX_REQUEST_BYTES || `${20 * 1024 * 1024}`);
const recentTraceLimit = Number(process.env.LLM_ROUTER_RECENT_TRACE_LIMIT || "100");

const runtimeApiKeys = new Map();
const recentTraces = [];
let registry = loadRegistry();
let aruviConfig = loadAruviConfig();
let providers = buildProviders();

function parseBoolean(value) {
  return value === "1" || value === "true" || value === "yes";
}

function timestamp() {
  return new Date().toISOString();
}

function splitList(value) {
  return value ? value.split(",").map((item) => item.trim()).filter(Boolean) : [];
}

function normalizeBaseUrl(value) {
  return value.replace(/\/+$/, "");
}

function loadRegistry() {
  if (!fs.existsSync(registryFile)) {
    return { providers: [], models: [] };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(registryFile, "utf8"));
    return {
      providers: Array.isArray(parsed.providers) ? parsed.providers : [],
      models: Array.isArray(parsed.models) ? parsed.models : [],
    };
  } catch (error) {
    console.error(`[${timestamp()}] Failed to read registry ${registryFile}: ${error.message}`);
    return { providers: [], models: [] };
  }
}

function saveRegistry() {
  fs.mkdirSync(path.dirname(registryFile), { recursive: true });
  fs.writeFileSync(registryFile, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
}

function loadAruviConfig() {
  if (!fs.existsSync(aruviConfigFile)) {
    return { apiKeys: {} };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(aruviConfigFile, "utf8"));
    const rawKeys = parsed?.api_keys || parsed?.apiKeys || {};
    const apiKeys = {};
    for (const [key, value] of Object.entries(rawKeys)) {
      if (typeof value === "string" && value.trim()) {
        apiKeys[normalizeKeyName(key)] = value.trim();
      }
    }
    return { apiKeys };
  } catch (error) {
    console.error(`[${timestamp()}] Failed to read Aruvi LLM config ${aruviConfigFile}: ${error.message}`);
    return { apiKeys: {} };
  }
}

function normalizeKeyName(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function builtInProviders() {
  return [
    {
      id: "lmstudio",
      label: "Local LLMs (LM Studio)",
      adapter: "openai-compatible",
      baseUrl: process.env.LMSTUDIO_BASE_URL || `http://${targetHost}:${targetPort}/v1`,
      apiKeyEnv: "LMSTUDIO_API_KEY",
      apiKey: process.env.LMSTUDIO_API_KEY || "",
      default: defaultProviderId === "lmstudio",
      models: splitList(process.env.LMSTUDIO_MODELS),
    },
    {
      id: "openai",
      label: "OpenAI",
      adapter: "openai-compatible",
      baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
      apiKeyEnv: "OPENAI_API_KEY",
      apiKey: process.env.OPENAI_API_KEY || "",
      default: defaultProviderId === "openai",
      models: splitList(process.env.OPENAI_MODELS || "gpt-*,o1*,o3*,o4*,o5*"),
    },
    {
      id: "deepseek",
      label: "DeepSeek",
      adapter: "openai-compatible",
      baseUrl: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
      apiKeyEnv: "DEEPSEEK_API_KEY",
      apiKey: process.env.DEEPSEEK_API_KEY || "",
      default: defaultProviderId === "deepseek",
      stripIncomingPrefix: "/v1",
      models: splitList(process.env.DEEPSEEK_MODELS || "deepseek-*"),
    },
    {
      id: "xai",
      label: "xAI Grok",
      adapter: "openai-compatible",
      baseUrl: process.env.XAI_BASE_URL || "https://api.x.ai/v1",
      apiKeyEnv: "XAI_API_KEY",
      apiKey: process.env.XAI_API_KEY || "",
      default: defaultProviderId === "xai" || defaultProviderId === "grok",
      models: splitList(process.env.XAI_MODELS || "grok-*"),
    },
    {
      id: "anthropic",
      label: "Claude (Anthropic)",
      adapter: "anthropic",
      baseUrl: process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com/v1",
      apiKeyEnv: "ANTHROPIC_API_KEY",
      apiKey: process.env.ANTHROPIC_API_KEY || "",
      anthropicVersion: process.env.ANTHROPIC_VERSION || "2023-06-01",
      defaultMaxTokens: Number(process.env.ANTHROPIC_DEFAULT_MAX_TOKENS || "1024"),
      default: defaultProviderId === "anthropic" || defaultProviderId === "claude",
      models: splitList(process.env.ANTHROPIC_MODELS || "claude-*"),
    },
  ];
}

function builtInModels() {
  return [
    {
      id: "google/gemma-4-12b-qat",
      provider: "lmstudio",
      label: "Gemma 4 12B QAT",
    },
    {
      id: "gpt-5.4-nano",
      provider: "openai",
      label: "GPT 5.4 Nano",
    },
    {
      id: "gpt-5.4-mini",
      provider: "openai",
      label: "GPT 5.4 Mini",
    },
    {
      id: "deepseek-v4-pro",
      provider: "deepseek",
      label: "DeepSeek V4 Pro",
    },
    {
      id: "deepseek-v4-flash",
      provider: "deepseek",
      label: "DeepSeek V4 Flash",
    },
    {
      id: "grok-4.3",
      provider: "xai",
      label: "Grok 4.3",
    },
    {
      id: "claude-opus-4-8",
      provider: "anthropic",
      label: "Claude Opus 4.8",
    },
    {
      id: "claude-sonnet-4-5",
      provider: "anthropic",
      label: "Claude Sonnet 4.5",
    },
  ];
}

function buildProviders() {
  const merged = new Map();
  for (const provider of builtInProviders()) {
    merged.set(provider.id, normalizeProvider(provider));
  }

  for (const provider of parseJsonArrayEnv("LLM_ROUTER_PROVIDERS")) {
    merged.set(provider.id, normalizeProvider(provider));
  }

  for (const provider of registry.providers) {
    merged.set(provider.id, normalizeProvider(provider));
  }

  const providerList = [...merged.values()];
  const hasDefault = providerList.some((provider) => provider.default);
  if (!hasDefault && providerList.length) {
    providerList[0].default = true;
  }
  return providerList;
}

function parseJsonArrayEnv(name) {
  if (!process.env[name]) {
    return [];
  }

  try {
    const parsed = JSON.parse(process.env[name]);
    if (!Array.isArray(parsed)) {
      throw new Error(`${name} must be a JSON array`);
    }
    return parsed;
  } catch (error) {
    console.error(`[${timestamp()}] Failed to parse ${name}: ${error.message}`);
    return [];
  }
}

function normalizeProvider(provider) {
  if (!provider.id || !provider.baseUrl) {
    throw new Error("Provider requires id and baseUrl");
  }

  const adapter = provider.adapter || "openai-compatible";
  if (!["openai-compatible", "anthropic"].includes(adapter)) {
    throw new Error(`Unsupported provider adapter: ${adapter}`);
  }

  return {
    id: String(provider.id),
    label: provider.label ? String(provider.label) : String(provider.id),
    adapter,
    baseUrl: normalizeBaseUrl(String(provider.baseUrl)),
    apiKey: provider.apiKey ? String(provider.apiKey) : "",
    apiKeyEnv: provider.apiKeyEnv ? String(provider.apiKeyEnv) : "",
    default: provider.default === true || provider.id === defaultProviderId,
    models: Array.isArray(provider.models) ? provider.models.map(String) : [],
    stripIncomingPrefix: provider.stripIncomingPrefix ? String(provider.stripIncomingPrefix) : "",
    anthropicVersion: provider.anthropicVersion ? String(provider.anthropicVersion) : "2023-06-01",
    defaultMaxTokens: Number(provider.defaultMaxTokens || 1024),
  };
}

function providerForId(id) {
  return providers.find((provider) => provider.id === id);
}

function resolveApiKey(provider) {
  return runtimeApiKeys.get(provider.id)
    || provider.apiKey
    || (provider.apiKeyEnv ? process.env[provider.apiKeyEnv] : "")
    || aruviApiKeyForProvider(provider.id)
    || "";
}

function aruviApiKeyForProvider(providerId) {
  const candidates = {
    lmstudio: ["lmstudio", "localllm", "local"],
    openai: ["openai"],
    deepseek: ["deepseek"],
    xai: ["xai", "grok"],
    anthropic: ["anthropic", "claude"],
  }[providerId] || [providerId];

  for (const key of candidates) {
    const value = aruviConfig.apiKeys[normalizeKeyName(key)];
    if (value) {
      return value;
    }
  }
  return "";
}

function publicProvider(provider) {
  return {
    id: provider.id,
    label: provider.label,
    adapter: provider.adapter,
    baseUrl: provider.baseUrl,
    default: provider.default,
    apiKeyEnv: provider.apiKeyEnv || undefined,
    hasApiKey: Boolean(resolveApiKey(provider)),
    hasRuntimeApiKey: runtimeApiKeys.has(provider.id),
    hasAruviApiKey: Boolean(aruviApiKeyForProvider(provider.id)),
    models: provider.models,
    stripIncomingPrefix: provider.stripIncomingPrefix || undefined,
  };
}

function buildModelRegistry() {
  const merged = new Map();

  for (const model of builtInModels()) {
    merged.set(model.id, normalizeModel(model));
  }

  for (const provider of providers) {
    for (const modelId of provider.models) {
      if (!modelId.includes("*") && !merged.has(modelId)) {
        merged.set(modelId, normalizeModel({ id: modelId, provider: provider.id }));
      }
    }
  }

  for (const model of parseJsonArrayEnv("LLM_ROUTER_MODELS")) {
    merged.set(model.id, normalizeModel(model));
  }

  for (const model of registry.models) {
    merged.set(model.id, normalizeModel(model));
  }

  return [...merged.values()];
}

function normalizeModel(model) {
  if (!model.id || !model.provider) {
    throw new Error("Model requires id and provider");
  }

  return {
    id: String(model.id),
    provider: String(model.provider),
    upstreamId: model.upstreamId ? String(model.upstreamId) : undefined,
    label: model.label ? String(model.label) : undefined,
    aliases: Array.isArray(model.aliases) ? model.aliases.map(String) : [],
    contextWindow: model.contextWindow ? Number(model.contextWindow) : undefined,
    default: model.default === true,
  };
}

function findRegisteredModel(modelId) {
  if (!modelId) {
    return null;
  }

  return buildModelRegistry().find((model) => (
    model.id === modelId || model.aliases.includes(modelId)
  )) || null;
}

function redactedHeaders(headers) {
  const blocked = new Set(["authorization", "cookie", "set-cookie", "x-api-key"]);
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      blocked.has(key.toLowerCase()) ? "[redacted]" : value,
    ]),
  );
}

function ensureTraceDir() {
  fs.mkdirSync(path.dirname(traceFile), { recursive: true });
}

function rememberTrace(trace) {
  recentTraces.push(trace);
  while (recentTraces.length > recentTraceLimit) {
    recentTraces.shift();
  }

  try {
    ensureTraceDir();
    fs.appendFileSync(traceFile, `${JSON.stringify(trace)}\n`, "utf8");
  } catch (error) {
    console.error(`[${timestamp()}] Failed to write trace file ${traceFile}: ${error.message}`);
  }
}

function previewBuffer(buffer) {
  if (!traceBody || !buffer.length) {
    return undefined;
  }
  return buffer.toString("utf8", 0, Math.min(buffer.length, maxTracePreviewBytes));
}

function parseJsonBody(buffer, contentType) {
  if (!buffer.length || !String(contentType || "").includes("application/json")) {
    return null;
  }

  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch {
    return null;
  }
}

async function readRequestBody(request) {
  const chunks = [];
  let bytes = 0;

  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maxBufferedRequestBytes) {
      throw new Error(`Request body is larger than ${maxBufferedRequestBytes} bytes`);
    }
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

function summarizeBody(jsonBody) {
  if (!jsonBody || typeof jsonBody !== "object") {
    return {};
  }

  const messages = Array.isArray(jsonBody.messages) ? jsonBody.messages : [];
  return {
    model: jsonBody.model,
    provider: jsonBody.provider,
    stream: jsonBody.stream === true,
    temperature: jsonBody.temperature,
    maxTokens: jsonBody.max_tokens,
    maxCompletionTokens: jsonBody.max_completion_tokens,
    thinking: jsonBody.thinking,
    reasoningEffort: jsonBody.reasoning_effort,
    messages: messages.length,
    lastMessageRole: messages.length ? messages[messages.length - 1]?.role : undefined,
  };
}

function modelMatches(provider, model) {
  if (!model || !provider.models.length) {
    return false;
  }

  return provider.models.some((pattern) => {
    if (pattern.endsWith("*")) {
      return model.startsWith(pattern.slice(0, -1));
    }
    return pattern === model;
  });
}

function selectProvider(request, jsonBody) {
  const headerProvider = request.headers["x-llm-provider"];
  const bodyProvider = jsonBody && typeof jsonBody === "object" ? jsonBody.provider : undefined;
  const model = jsonBody && typeof jsonBody === "object" ? jsonBody.model : undefined;

  if (typeof headerProvider === "string" && providerForId(headerProvider)) {
    const provider = providerForId(headerProvider);
    return { provider, modelOverride: modelOverrideFor(provider, model), routeReason: "x-llm-provider" };
  }

  if (typeof bodyProvider === "string" && providerForId(bodyProvider)) {
    const provider = providerForId(bodyProvider);
    return { provider, modelOverride: modelOverrideFor(provider, model), routeReason: "body.provider" };
  }

  if (typeof model === "string") {
    const separatorIndex = model.indexOf(":");
    if (separatorIndex > 0) {
      const providerId = model.slice(0, separatorIndex);
      const provider = providerForId(providerId);
      if (provider) {
        return {
          provider,
          modelOverride: model.slice(separatorIndex + 1),
          routeReason: "model-prefix",
        };
      }
    }

    const registeredModel = findRegisteredModel(model);
    if (registeredModel) {
      const provider = providerForId(registeredModel.provider);
      if (provider) {
        return {
          provider,
          modelOverride: registeredModel.upstreamId || registeredModel.id,
          routeReason: "model-registry",
        };
      }
    }

    const modelProvider = providers.find((provider) => modelMatches(provider, model));
    if (modelProvider) {
      return { provider: modelProvider, modelOverride: null, routeReason: "model-pattern" };
    }
  }

  const defaultProvider = providers.find((provider) => provider.default) || providers[0];
  return { provider: defaultProvider, modelOverride: modelOverrideFor(defaultProvider, model), routeReason: "default" };
}

function modelOverrideFor(provider, model) {
  const registeredModel = findRegisteredModel(model);
  if (registeredModel && registeredModel.provider === provider.id) {
    return registeredModel.upstreamId || registeredModel.id;
  }
  return null;
}

function buildUpstreamUrl(provider, originalUrl) {
  const incomingUrl = new URL(originalUrl, "http://bookforge-router.local");
  const baseUrl = new URL(provider.baseUrl);
  const basePath = baseUrl.pathname.replace(/\/+$/, "");
  let requestPath = incomingUrl.pathname;

  if (provider.stripIncomingPrefix && (
    requestPath === provider.stripIncomingPrefix
    || requestPath.startsWith(`${provider.stripIncomingPrefix}/`)
  )) {
    requestPath = requestPath.slice(provider.stripIncomingPrefix.length) || "/";
  } else if (basePath.endsWith("/v1") && requestPath === "/v1") {
    requestPath = "";
  } else if (basePath.endsWith("/v1") && requestPath.startsWith("/v1/")) {
    requestPath = requestPath.slice(3);
  }

  const upstreamUrl = new URL(baseUrl.toString());
  upstreamUrl.pathname = joinUrlPaths(basePath, requestPath);
  upstreamUrl.search = incomingUrl.search;
  upstreamUrl.searchParams.delete("provider");
  upstreamUrl.searchParams.delete("upstream");
  return upstreamUrl;
}

function buildAnthropicUrl(provider) {
  const upstreamUrl = new URL(provider.baseUrl);
  upstreamUrl.pathname = joinUrlPaths(upstreamUrl.pathname.replace(/\/+$/, ""), "/messages");
  return upstreamUrl;
}

function joinUrlPaths(left, right) {
  const combined = `${left || ""}/${right || ""}`.replace(/\/+/g, "/");
  return combined === "" ? "/" : combined;
}

function buildOpenAiCompatibleHeaders(request, provider, requestBody) {
  const headers = {
    ...request.headers,
    host: new URL(provider.baseUrl).host,
    connection: "close",
    "content-length": Buffer.byteLength(requestBody),
  };

  delete headers["accept-encoding"];
  delete headers["x-llm-provider"];

  const apiKey = resolveApiKey(provider);
  if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
  }

  return headers;
}

function buildAnthropicHeaders(provider, requestBody) {
  const headers = {
    host: new URL(provider.baseUrl).host,
    connection: "close",
    "content-type": "application/json",
    "content-length": Buffer.byteLength(requestBody),
    "anthropic-version": provider.anthropicVersion,
  };

  const apiKey = resolveApiKey(provider);
  if (apiKey) {
    headers["x-api-key"] = apiKey;
  }

  if (process.env.ANTHROPIC_BETA) {
    headers["anthropic-beta"] = process.env.ANTHROPIC_BETA;
  }

  return headers;
}

function maybeRewriteOpenAiBody(provider, jsonBody, rawBody, modelOverride) {
  if (!jsonBody || typeof jsonBody !== "object") {
    return rawBody;
  }

  const rewritten = { ...jsonBody };
  delete rewritten.provider;

  if (modelOverride) {
    rewritten.model = modelOverride;
  }

  if (provider.id === "deepseek") {
    if (!rewritten.thinking) {
      rewritten.thinking = { type: process.env.DEEPSEEK_THINKING || "disabled" };
    }
    if (rewritten.thinking?.type === "disabled") {
      delete rewritten.reasoning_effort;
    }
  }

  return Buffer.from(JSON.stringify(rewritten), "utf8");
}

function toAnthropicBody(provider, jsonBody, modelOverride) {
  if (!jsonBody || typeof jsonBody !== "object") {
    throw Object.assign(new Error("Anthropic adapter requires a JSON chat/completions body"), { statusCode: 400 });
  }

  if (jsonBody.stream === true) {
    throw Object.assign(new Error("Anthropic adapter does not support OpenAI-compatible streaming yet"), { statusCode: 400 });
  }

  const messages = Array.isArray(jsonBody.messages) ? jsonBody.messages : [];
  const systemMessages = [];
  const anthropicMessages = [];

  for (const message of messages) {
    if (!message || typeof message !== "object") {
      continue;
    }

    if (message.role === "system") {
      systemMessages.push(contentToText(message.content));
      continue;
    }

    if (message.role === "assistant" || message.role === "user") {
      anthropicMessages.push({
        role: message.role,
        content: contentToText(message.content),
      });
    }
  }

  const body = {
    model: modelOverride || jsonBody.model,
    max_tokens: Number(jsonBody.max_tokens || provider.defaultMaxTokens || 1024),
    messages: anthropicMessages,
  };

  if (systemMessages.length) {
    body.system = systemMessages.join("\n\n");
  }

  if (typeof jsonBody.temperature === "number") {
    body.temperature = jsonBody.temperature;
  }
  if (typeof jsonBody.top_p === "number") {
    body.top_p = jsonBody.top_p;
  }
  if (Array.isArray(jsonBody.stop)) {
    body.stop_sequences = jsonBody.stop;
  } else if (typeof jsonBody.stop === "string") {
    body.stop_sequences = [jsonBody.stop];
  }

  return Buffer.from(JSON.stringify(body), "utf8");
}

function contentToText(content) {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === "string") {
        return part;
      }
      if (part?.type === "text" && typeof part.text === "string") {
        return part.text;
      }
      return "";
    }).filter(Boolean).join("\n");
  }

  return "";
}

function toOpenAiChatCompletion(anthropicResponse) {
  const content = Array.isArray(anthropicResponse.content)
    ? anthropicResponse.content
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("")
    : "";

  const inputTokens = anthropicResponse.usage?.input_tokens || 0;
  const outputTokens = anthropicResponse.usage?.output_tokens || 0;

  return {
    id: anthropicResponse.id || `chatcmpl_${randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: anthropicResponse.model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content,
        },
        finish_reason: mapAnthropicStopReason(anthropicResponse.stop_reason),
      },
    ],
    usage: {
      prompt_tokens: inputTokens,
      completion_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
    },
  };
}

function mapAnthropicStopReason(reason) {
  if (reason === "max_tokens") {
    return "length";
  }
  if (reason === "stop_sequence") {
    return "stop";
  }
  if (reason === "tool_use") {
    return "tool_calls";
  }
  return "stop";
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(payload, null, 2));
}

function handleRouterEndpoint(request, response, rawBody) {
  const requestUrl = new URL(request.url, "http://bookforge-router.local");

  if (request.method === "GET" && requestUrl.pathname === "/health") {
    sendJson(response, 200, {
      ok: true,
      router: "bookforge-llm-router",
      listen: `http://${listenHost}:${listenPort}`,
      defaultProvider: (providers.find((provider) => provider.default) || providers[0])?.id,
      providers: providers.map(publicProvider),
      models: buildModelRegistry(),
      registryFile,
      aruviConfigFile,
      traceFile,
    });
    return true;
  }

  if (request.method === "GET" && requestUrl.pathname === "/routes") {
    sendJson(response, 200, {
      providers: providers.map(publicProvider),
      models: buildModelRegistry(),
      routing: [
        "x-llm-provider header",
        "body.provider",
        "model prefix like anthropic:claude-sonnet-4-5",
        "registered model id or alias",
        "provider model patterns",
        "default provider",
      ],
    });
    return true;
  }

  if (request.method === "GET" && requestUrl.pathname === "/debug/traces") {
    const limit = Number(requestUrl.searchParams.get("limit") || "25");
    sendJson(response, 200, {
      traces: recentTraces.slice(-Math.max(1, Math.min(limit, recentTraceLimit))),
      traceFile,
    });
    return true;
  }

  if (request.method === "POST" && requestUrl.pathname === "/debug/route") {
    const body = parseJsonBody(rawBody, request.headers["content-type"]);
    const { provider, modelOverride, routeReason } = selectProvider(request, body);
    const upstreamUrl = provider.adapter === "anthropic"
      ? buildAnthropicUrl(provider)
      : buildUpstreamUrl(provider, requestUrl.searchParams.get("path") || "/v1/chat/completions");
    sendJson(response, 200, {
      provider: publicProvider(provider),
      routeReason,
      requestedModel: body?.model,
      upstreamModel: modelOverride || body?.model,
      upstream: upstreamUrl.toString(),
    });
    return true;
  }

  if (request.method === "GET" && requestUrl.pathname === "/registry") {
    sendJson(response, 200, {
      providers: providers.map(publicProvider),
      models: buildModelRegistry(),
      registryFile,
      aruviConfigFile,
    });
    return true;
  }

  if (request.method === "POST" && requestUrl.pathname === "/config/reload") {
    aruviConfig = loadAruviConfig();
    providers = buildProviders();
    sendJson(response, 200, {
      ok: true,
      aruviConfigFile,
      providers: providers.map(publicProvider),
    });
    return true;
  }

  if (request.method === "GET" && isModelsPath(requestUrl.pathname)) {
    sendJson(response, 200, {
      object: "list",
      data: buildModelRegistry().map((model) => ({
        id: model.id,
        object: "model",
        owned_by: model.provider,
        provider: model.provider,
        upstreamId: model.upstreamId,
        aliases: model.aliases,
        contextWindow: model.contextWindow,
      })),
    });
    return true;
  }

  if (request.method === "GET" && requestUrl.pathname === "/registry/providers") {
    sendJson(response, 200, { providers: providers.map(publicProvider) });
    return true;
  }

  if (request.method === "POST" && requestUrl.pathname === "/registry/providers") {
    const body = parseJsonBody(rawBody, request.headers["content-type"]);
    const provider = registerProvider(body);
    sendJson(response, 201, { provider: publicProvider(provider), registryFile });
    return true;
  }

  if (request.method === "GET" && requestUrl.pathname === "/registry/models") {
    sendJson(response, 200, { models: buildModelRegistry() });
    return true;
  }

  if (request.method === "POST" && requestUrl.pathname === "/registry/models") {
    const body = parseJsonBody(rawBody, request.headers["content-type"]);
    const model = registerModel(body);
    sendJson(response, 201, { model, registryFile });
    return true;
  }

  return false;
}

function isModelsPath(pathname) {
  return pathname === "/v1/models" || pathname === "/models";
}

function registerProvider(body) {
  if (!body || typeof body !== "object") {
    throw Object.assign(new Error("Provider registration requires a JSON body"), { statusCode: 400 });
  }

  const provider = normalizeProvider(body);
  if (body.apiKey) {
    runtimeApiKeys.set(provider.id, String(body.apiKey));
  }

  const persistedProvider = { ...provider };
  delete persistedProvider.apiKey;

  registry.providers = upsertById(registry.providers, persistedProvider);
  saveRegistry();
  registry = loadRegistry();
  providers = buildProviders();
  return providerForId(provider.id);
}

function registerModel(body) {
  if (!body || typeof body !== "object") {
    throw Object.assign(new Error("Model registration requires a JSON body"), { statusCode: 400 });
  }

  const model = normalizeModel(body);
  if (!providerForId(model.provider)) {
    throw Object.assign(new Error(`Unknown provider for model: ${model.provider}`), { statusCode: 400 });
  }

  registry.models = upsertById(registry.models, model);
  saveRegistry();
  registry = loadRegistry();
  return model;
}

function upsertById(items, item) {
  const others = items.filter((candidate) => candidate.id !== item.id);
  return [...others, item];
}

function proxyToProvider({
  request,
  response,
  requestId,
  provider,
  routeReason,
  upstreamUrl,
  upstreamBody,
  upstreamHeaders,
  responseAdapter,
  jsonBody,
  startedAt,
  rawBody,
}) {
  const upstreamClient = upstreamUrl.protocol === "https:" ? https : http;
  let responseBytes = 0;
  const responseChunks = [];

  const upstreamRequest = upstreamClient.request(
    {
      protocol: upstreamUrl.protocol,
      hostname: upstreamUrl.hostname,
      port: upstreamUrl.port,
      path: `${upstreamUrl.pathname}${upstreamUrl.search}`,
      method: request.method,
      headers: upstreamHeaders,
    },
    (upstreamResponse) => {
      upstreamResponse.on("data", (chunk) => {
        responseBytes += chunk.length;
        if (responseAdapter) {
          responseChunks.push(chunk);
        } else {
          if (!response.headersSent) {
            response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
          }
          response.write(chunk);
        }
      });

      upstreamResponse.on("end", () => {
        if (responseAdapter) {
          writeAdaptedResponse(response, upstreamResponse, Buffer.concat(responseChunks), responseAdapter);
        } else {
          response.end();
        }

        const trace = {
          id: requestId,
          timestamp: timestamp(),
          method: request.method,
          path: request.url,
          provider: provider.id,
          adapter: provider.adapter,
          routeReason,
          upstream: upstreamUrl.toString(),
          statusCode: upstreamResponse.statusCode || 502,
          durationMs: Date.now() - startedAt,
          requestBytes: rawBody.length,
          upstreamRequestBytes: upstreamBody.length,
          responseBytes,
          headers: redactedHeaders(request.headers),
          body: {
            ...summarizeBody(jsonBody),
            preview: previewBuffer(rawBody),
          },
        };
        console.log(`[${trace.timestamp}] ${trace.id} ${trace.statusCode} ${request.method} ${request.url} -> ${provider.id} ${trace.durationMs}ms ${responseBytes}b`);
        rememberTrace(trace);
      });
    },
  );

  upstreamRequest.on("error", (error) => {
    const trace = {
      id: requestId,
      timestamp: timestamp(),
      method: request.method,
      path: request.url,
      provider: provider.id,
      adapter: provider.adapter,
      routeReason,
      upstream: upstreamUrl.toString(),
      statusCode: 502,
      durationMs: Date.now() - startedAt,
      requestBytes: rawBody.length,
      upstreamRequestBytes: upstreamBody.length,
      responseBytes,
      headers: redactedHeaders(request.headers),
      body: {
        ...summarizeBody(jsonBody),
        preview: previewBuffer(rawBody),
      },
      error: error.message,
    };
    console.error(`[${trace.timestamp}] ${trace.id} 502 ${request.method} ${request.url} -> ${provider.id}: ${error.message}`);
    rememberTrace(trace);
    sendJson(response, 502, {
      error: "LLM router could not reach upstream provider",
      detail: error.message,
      provider: provider.id,
      upstream: upstreamUrl.toString(),
      requestId,
    });
  });

  upstreamRequest.end(upstreamBody);
}

function writeAdaptedResponse(response, upstreamResponse, responseBody, responseAdapter) {
  const statusCode = upstreamResponse.statusCode || 502;
  const contentType = upstreamResponse.headers["content-type"] || "application/json";

  if (statusCode < 200 || statusCode >= 300) {
    response.writeHead(statusCode, { "content-type": contentType });
    response.end(responseBody);
    return;
  }

  try {
    const parsed = JSON.parse(responseBody.toString("utf8"));
    const adapted = responseAdapter(parsed);
    sendJson(response, 200, adapted);
  } catch (error) {
    sendJson(response, 502, {
      error: "LLM router could not adapt upstream response",
      detail: error.message,
    });
  }
}

function prepareProviderRequest(request, provider, jsonBody, rawBody, modelOverride) {
  if (provider.adapter === "anthropic") {
    const requestUrl = new URL(request.url, "http://bookforge-router.local");
    if (!requestUrl.pathname.endsWith("/chat/completions")) {
      throw Object.assign(new Error("Anthropic adapter currently supports /v1/chat/completions"), { statusCode: 400 });
    }

    const upstreamBody = toAnthropicBody(provider, jsonBody, modelOverride);
    return {
      upstreamUrl: buildAnthropicUrl(provider),
      upstreamBody,
      upstreamHeaders: buildAnthropicHeaders(provider, upstreamBody),
      responseAdapter: toOpenAiChatCompletion,
    };
  }

  const upstreamBody = maybeRewriteOpenAiBody(provider, jsonBody, rawBody, modelOverride);
  return {
    upstreamUrl: buildUpstreamUrl(provider, request.url),
    upstreamBody,
    upstreamHeaders: buildOpenAiCompatibleHeaders(request, provider, upstreamBody),
    responseAdapter: null,
  };
}

const server = http.createServer(async (request, response) => {
  const startedAt = Date.now();
  const requestId = randomUUID();
  console.log(`[${timestamp()}] ${requestId} ${request.method} ${request.url}`);

  try {
    const requestUrl = new URL(request.url, "http://bookforge-router.local");

    if (request.method === "GET" && isModelsPath(requestUrl.pathname) && requestUrl.searchParams.get("upstream") === "1") {
      const provider = providerForId(requestUrl.searchParams.get("provider") || defaultProviderId) || providers.find((candidate) => candidate.default) || providers[0];
      const upstreamUrl = buildUpstreamUrl(provider, request.url);
      proxyToProvider({
        request,
        response,
        requestId,
        provider,
        routeReason: "models-upstream-query",
        upstreamUrl,
        upstreamBody: Buffer.alloc(0),
        upstreamHeaders: buildOpenAiCompatibleHeaders(request, provider, Buffer.alloc(0)),
        responseAdapter: null,
        jsonBody: null,
        startedAt,
        rawBody: Buffer.alloc(0),
      });
      return;
    }

    const rawBody = await readRequestBody(request);

    if (handleRouterEndpoint(request, response, rawBody)) {
      return;
    }

    const jsonBody = parseJsonBody(rawBody, request.headers["content-type"]);
    const { provider, modelOverride, routeReason } = selectProvider(request, jsonBody);
    const prepared = prepareProviderRequest(request, provider, jsonBody, rawBody, modelOverride);

    proxyToProvider({
      request,
      response,
      requestId,
      provider,
      routeReason,
      ...prepared,
      jsonBody,
      startedAt,
      rawBody,
    });
  } catch (error) {
    const statusCode = error.statusCode || 400;
    const trace = {
      id: requestId,
      timestamp: timestamp(),
      method: request.method,
      path: request.url,
      statusCode,
      durationMs: Date.now() - startedAt,
      error: error.message,
    };
    console.error(`[${trace.timestamp}] ${trace.id} ${statusCode} ${request.method} ${request.url}: ${error.message}`);
    rememberTrace(trace);
    sendJson(response, statusCode, {
      error: "LLM router could not process request",
      detail: error.message,
      requestId,
    });
  }
});

server.listen(listenPort, listenHost, () => {
  console.log(`BookForge LLM router listening on http://${listenHost}:${listenPort}`);
  console.log(`Default provider: ${(providers.find((provider) => provider.default) || providers[0])?.id}`);
  for (const provider of providers) {
    const keyStatus = resolveApiKey(provider) ? "key=present" : `key=${provider.apiKeyEnv || "none"}`;
    console.log(`Provider ${provider.id} (${provider.adapter}): ${provider.baseUrl} ${keyStatus}`);
  }
  console.log(`Registry file: ${registryFile}`);
  console.log(`Trace file: ${traceFile}`);
});
