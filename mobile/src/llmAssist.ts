import type { Book, Chapter, Section } from "./types";

export type AssistMode = "paper" | "concept" | "summary" | "augment" | "kids" | "method" | "critique" | "custom";

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

export function buildAssistPrompt(
  book: Book,
  chapter: Chapter | undefined,
  section: Section,
  mode: AssistMode,
  question: string,
  savedSourceText = "",
  savedNotesContext = "",
) {
  return [
    "You are an expert research reading assistant.",
    "Use only the provided context unless you explicitly label outside knowledge.",
    "When saved paper text is present, prioritize it over metadata and abstract-only context.",
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
    "",
    "Reading context:",
    section.content || section.summary || section.intent,
    savedSourceText.trim() ? "Saved paper text excerpt:" : "",
    savedSourceText.trim() ? savedSourceText.trim() : "",
    savedNotesContext.trim() ? "Saved paper notebook:" : "",
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
}) {
  const cleanEndpoint = endpoint.trim().replace(/\/$/, "");
  const url = cleanEndpoint.endsWith("/chat/completions") ? cleanEndpoint : `${cleanEndpoint}/chat/completions`;
  const response = await fetch(url, {
    method: "POST",
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

  if (!response.ok) {
    throw new Error(`LLM request failed: ${response.status}`);
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("LLM response did not include a message.");
  }
  return content.trim();
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
