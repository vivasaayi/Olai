import type { Book, Chapter, Section, TokenUsage } from "./types";

export type AssistMode = "paper" | "concept" | "summary" | "augment" | "kids" | "method" | "critique" | "custom";

export type AssistModelOption = {
  id: string;
  label: string;
  provider?: string;
  upstreamId?: string;
};

export type AssistRunResult = {
  content: string;
  tokenUsage?: TokenUsage;
};

const modeInstructions: Record<AssistMode, string> = {
  paper: "Explain the whole paper as a patient tutor: problem, motivation, core idea, method, evidence, limitations, and why it matters.",
  concept: "Explain the concept or topic from the question. Define it, connect it to the paper, give intuition, and add a concrete example.",
  summary: "Summarize the section in concise graduate-level notes.",
  augment: "Expand the reading into detailed study notes with background, definitions, intuition, examples, and practical implications.",
  kids: "Explain the section to a curious 12-year-old without losing the key idea.",
  method: "Identify the method, assumptions, evidence, and result.",
  critique: "List limitations, weak assumptions, and questions to verify.",
  custom: "Answer the custom question using only the provided reading context.",
};

const requestTimeoutMs = 45_000;

function timeoutSignal() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  return { controller, timeout };
}

export function buildAssistPrompt(
  book: Book,
  chapter: Chapter | undefined,
  section: Section,
  mode: AssistMode,
  question: string,
  outlineContext = "",
  savedSourceText = "",
  savedNotesContext = "",
) {
  return [
    "You are an expert research reading assistant.",
    "Use only the provided context unless you explicitly label outside knowledge.",
    "When saved paper text is present, prioritize it over metadata and abstract-only context.",
    "For section-level work, explain the selected outline node. Use parent and sibling nodes only as context, not as the main subject.",
    "When saved notebook references are present, use them to keep continuity with the reader's prior understanding.",
    "",
    `Task: ${modeInstructions[mode]}`,
    question.trim() ? `Question: ${question.trim()}` : "",
    "",
    `Paper or book: ${book.title}`,
    book.source?.id ? `Source ID: ${book.source.id}` : "",
    book.source?.url ? `Source URL: ${book.source.url}` : "",
    book.source?.authors?.length ? `Authors: ${book.source.authors.join(", ")}` : "",
    chapter ? `Chapter: ${chapter.title}` : "",
    `Section: ${section.title}`,
    section.summary ? `Section summary: ${section.summary}` : "",
    section.intent ? `Section intent: ${section.intent}` : "",
    outlineContext.trim() ? "Selected outline context:" : "",
    outlineContext.trim() ? outlineContext.trim() : "",
    "",
    "Selected node reading context:",
    section.content || section.summary || section.intent,
    savedSourceText.trim() ? "Saved paper text excerpt:" : "",
    savedSourceText.trim() ? savedSourceText.trim() : "",
    savedNotesContext.trim() ? "Saved notes for this topic:" : "",
    savedNotesContext.trim() ? savedNotesContext.trim() : "",
    "",
    "Return:",
    "- direct answer",
    "- expanded explanation",
    "- references to paper sections or concepts when useful",
    "- key terms",
    "- what to read next",
  ].filter(Boolean).join("\n");
}

export async function runOpenAiCompatibleAssist({
  apiKey,
  endpoint,
  model,
  prompt,
}: {
  apiKey: string;
  endpoint: string;
  model: string;
  prompt: string;
}): Promise<AssistRunResult> {
  const cleanEndpoint = endpoint.trim().replace(/\/$/, "");
  const url = cleanEndpoint.endsWith("/chat/completions") ? cleanEndpoint : `${cleanEndpoint}/chat/completions`;
  const { controller, timeout } = timeoutSignal();
  let response: Response;

  try {
    response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(apiKey.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : {}),
      },
      body: JSON.stringify({
        model: model.trim() || "google/gemma-4-12b-qat",
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content: "You help readers understand research papers. Be precise, concise, and honest about uncertainty.",
          },
          { role: "user", content: prompt },
        ],
      }),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("LLM request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`LLM request failed: ${response.status}`);
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("LLM response did not include a message.");
  }
  return {
    content: content.trim(),
    tokenUsage: readTokenUsage(payload?.usage),
  };
}

function readTokenUsage(value: unknown): TokenUsage | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const usage = value as Record<string, unknown>;
  const inputTokens = readNumber(usage.prompt_tokens)
    ?? readNumber(usage.input_tokens)
    ?? readNumber(usage.inputTokens);
  const outputTokens = readNumber(usage.completion_tokens)
    ?? readNumber(usage.output_tokens)
    ?? readNumber(usage.outputTokens);
  const totalTokens = readNumber(usage.total_tokens)
    ?? readNumber(usage.totalTokens)
    ?? (inputTokens !== undefined || outputTokens !== undefined
      ? (inputTokens ?? 0) + (outputTokens ?? 0)
      : undefined);

  return inputTokens !== undefined || outputTokens !== undefined || totalTokens !== undefined
    ? { inputTokens, outputTokens, totalTokens }
    : undefined;
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export async function fetchAssistModels({
  apiKey,
  endpoint,
}: {
  apiKey: string;
  endpoint: string;
}): Promise<AssistModelOption[]> {
  const cleanEndpoint = endpoint.trim().replace(/\/$/, "");
  if (!cleanEndpoint) {
    return [];
  }

  const url = cleanEndpoint.endsWith("/models") ? cleanEndpoint : `${cleanEndpoint}/models`;
  const { controller, timeout } = timeoutSignal();
  let response: Response;

  try {
    response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(apiKey.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : {}),
      },
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Model list request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`Model list request failed: ${response.status}`);
  }

  const payload = await response.json();
  const data: unknown[] = Array.isArray(payload?.data) ? payload.data : [];
  return data
    .map((entry: unknown): AssistModelOption | null => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const record = entry as Record<string, unknown>;
      if (typeof record.id !== "string") {
        return null;
      }
      const provider = typeof record.provider === "string"
        ? record.provider
        : typeof record.owned_by === "string"
          ? record.owned_by
          : undefined;
      const upstreamId = typeof record.upstreamId === "string" ? record.upstreamId : undefined;
      return {
        id: record.id,
        label: provider ? `${record.id} (${provider})` : record.id,
        provider,
        upstreamId,
      };
    })
    .filter((entry): entry is AssistModelOption => Boolean(entry));
}

export function localAssistFallback(prompt: string) {
  return [
    "LLM endpoint is not configured yet.",
    "",
    "Use the prompt below with LM Studio:",
    "",
    prompt,
  ].join("\n");
}
