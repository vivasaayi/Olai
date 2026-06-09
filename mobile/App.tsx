import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { WebView } from "react-native-webview";
import { deleteStoredBook, loadStoredBooks, normalizeBook, saveStoredBook } from "./src/bookStore";
import { buildAssistPrompt, localAssistFallback, runOpenAiCompatibleAssist, type AssistMode } from "./src/llmAssist";
import { readBookSourceText } from "./src/paperAssets";
import { importPaperFromInput } from "./src/paperImport";
import { sampleBook } from "./src/sampleBook";
import { defaultReaderSettings, loadReaderSettings, saveReaderSettings } from "./src/settingsStore";
import type { AiNote, AiNoteKind, Book, Resource, Section } from "./src/types";

type ThemeId = "paper" | "sepia" | "night";
type AddMode = "paper" | "json";

const themes: Record<ThemeId, {
  background: string;
  surface: string;
  text: string;
  muted: string;
  border: string;
  accent: string;
  accentText: string;
}> = {
  paper: {
    background: "#f8fafc",
    surface: "#ffffff",
    text: "#111827",
    muted: "#64748b",
    border: "#dbe3ee",
    accent: "#2563eb",
    accentText: "#ffffff",
  },
  sepia: {
    background: "#f4ecd9",
    surface: "#fff8e8",
    text: "#2f2417",
    muted: "#7c6a53",
    border: "#ddcaa8",
    accent: "#8b5e2b",
    accentText: "#fff8e8",
  },
  night: {
    background: "#101418",
    surface: "#171d24",
    text: "#edf2f7",
    muted: "#9aa7b4",
    border: "#2d3845",
    accent: "#7dd3fc",
    accentText: "#071016",
  },
};

type Theme = (typeof themes)[ThemeId];

type FlatSection = {
  chapterIndex: number;
  sectionIndex: number;
  chapterTitle: string;
  section: Section;
};

function flattenBook(book: Book): FlatSection[] {
  return book.chapters.flatMap((chapter, chapterIndex) =>
    chapter.sections.map((section, sectionIndex) => ({
      chapterIndex,
      sectionIndex,
      chapterTitle: chapter.title,
      section,
    })),
  );
}

function sectionBody(section: Section) {
  return (
    section.content.trim() ||
    section.summary.trim() ||
    section.intent.trim() ||
    "This section has no readable content yet. Generate or edit it in the authoring app, export the JSON, then import it here."
  );
}

function splitParagraphs(content: string) {
  return content
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function sourceResources(book: Book): Resource[] {
  const resources: Resource[] = [];
  if (book.source?.localHtmlPath) {
    resources.push({ id: "book-local-html", type: "link", label: "Offline Text", value: book.source.localHtmlPath });
  }
  if (book.source?.localPdfPath) {
    resources.push({ id: "book-local-pdf", type: "pdf", label: "Offline PDF", value: book.source.localPdfPath });
  }
  if (book.source?.url) {
    resources.push({ id: "book-source", type: "link", label: "Source", value: book.source.url });
  }
  if (book.source?.pdfUrl && !book.source.localPdfPath) {
    resources.push({ id: "book-pdf", type: "pdf", label: "PDF", value: book.source.pdfUrl });
  }
  return resources;
}

function uniqueResources(resources: Resource[]) {
  const seen = new Set<string>();
  return resources.filter((resource) => {
    const key = `${resource.label}:${resource.value}`;
    if (!resource.value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function readingResourcesForBook(book: Book, section: Section) {
  const sectionResources = book.source?.localPdfPath
    ? section.resources.filter((resource) => resource.type !== "pdf" || resource.value !== book.source?.pdfUrl)
    : section.resources;

  return uniqueResources([...sectionResources, ...sourceResources(book)]);
}

function buildNotebookContext(book: Book) {
  return (book.aiNotes ?? [])
    .slice(0, 8)
    .map((note, index) => {
      const source = note.sourceSectionTitle ? ` (${note.sourceSectionTitle})` : "";
      return `${index + 1}. ${note.title}${source}: ${note.content.slice(0, 900)}`;
    })
    .join("\n\n");
}

function noteKindForMode(mode: AssistMode): AiNoteKind {
  if (mode === "paper") return "paper";
  if (mode === "concept") return "concept";
  if (mode === "summary") return "summary";
  if (mode === "method") return "method";
  if (mode === "critique") return "critique";
  if (mode === "custom") return "question";
  return "section";
}

function noteTitleForMode(mode: AssistMode, section: Section, question: string) {
  const cleanQuestion = question.trim().replace(/\s+/g, " ");
  if (mode === "paper") return "Paper Explanation";
  if (mode === "concept") return cleanQuestion ? `Concept: ${cleanQuestion.slice(0, 72)}` : "Concept Explanation";
  if (mode === "custom") return cleanQuestion ? `Question: ${cleanQuestion.slice(0, 72)}` : "Question";
  if (mode === "summary") return `Summary: ${section.title}`;
  if (mode === "method") return `Method: ${section.title}`;
  if (mode === "critique") return `Critique: ${section.title}`;
  return `Study Notes: ${section.title}`;
}

export default function App() {
  const [books, setBooks] = useState<Book[]>([sampleBook]);
  const [storedBookIds, setStoredBookIds] = useState<string[]>([]);
  const [activeBookId, setActiveBookId] = useState(sampleBook.id);
  const [chapterIndex, setChapterIndex] = useState(0);
  const [sectionIndex, setSectionIndex] = useState(0);
  const [themeId, setThemeId] = useState<ThemeId>("sepia");
  const [fontSize, setFontSize] = useState(19);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addMode, setAddMode] = useState<AddMode>("paper");
  const [importText, setImportText] = useState("");
  const [paperInput, setPaperInput] = useState("");
  const [paperBusy, setPaperBusy] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [webUrl, setWebUrl] = useState("");
  const [webTitle, setWebTitle] = useState("Source");
  const [assistOpen, setAssistOpen] = useState(false);
  const [assistMode, setAssistMode] = useState<AssistMode>("augment");
  const [assistQuestion, setAssistQuestion] = useState("");
  const [assistEndpoint, setAssistEndpoint] = useState(defaultReaderSettings.assistEndpoint);
  const [assistApiKey, setAssistApiKey] = useState("");
  const [assistModel, setAssistModel] = useState(defaultReaderSettings.assistModel);
  const [assistAnswer, setAssistAnswer] = useState("");
  const [assistBusy, setAssistBusy] = useState(false);

  const theme = themes[themeId];

  const refreshBooks = async () => {
    try {
      const storedBooks = await loadStoredBooks();
      setBooks([sampleBook, ...storedBooks.filter((book) => book.id !== sampleBook.id)]);
      setStoredBookIds(storedBooks.map((book) => book.id));
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : String(error));
    }
  };

  useEffect(() => {
    refreshBooks();
    loadReaderSettings().then((settings) => {
      setAssistEndpoint(settings.assistEndpoint);
      setAssistModel(settings.assistModel);
    });
  }, []);

  const activeBook = books.find((book) => book.id === activeBookId) ?? books[0] ?? sampleBook;
  const flatSections = useMemo(() => flattenBook(activeBook), [activeBook]);
  const activeChapter = activeBook.chapters[Math.min(chapterIndex, activeBook.chapters.length - 1)];
  const activeSection =
    activeChapter?.sections[Math.min(sectionIndex, activeChapter.sections.length - 1)] ??
    flatSections[0]?.section;
  const activeFlatIndex = Math.max(
    0,
    flatSections.findIndex(
      (entry) => entry.chapterIndex === chapterIndex && entry.sectionIndex === sectionIndex,
    ),
  );
  const progressLabel = `${Math.min(activeFlatIndex + 1, flatSections.length)} / ${flatSections.length}`;
  const contentParagraphs = splitParagraphs(sectionBody(activeSection));
  const readingResources = readingResourcesForBook(activeBook, activeSection);
  const aiNoteCount = activeBook.aiNotes?.length ?? 0;

  const openBook = (book: Book) => {
    setActiveBookId(book.id);
    setChapterIndex(0);
    setSectionIndex(0);
    setLibraryOpen(false);
    setStatusText("");
  };

  const moveSection = (delta: number) => {
    const next = flatSections[activeFlatIndex + delta];
    if (!next) return;
    setChapterIndex(next.chapterIndex);
    setSectionIndex(next.sectionIndex);
  };

  const importBook = async () => {
    try {
      const parsed = normalizeBook(JSON.parse(importText));
      await saveStoredBook(parsed);
      setImportText("");
      setAddOpen(false);
      await refreshBooks();
      openBook(parsed);
      setStatusText(`Imported "${parsed.title}".`);
    } catch (error) {
      Alert.alert("Import failed", error instanceof Error ? error.message : String(error));
    }
  };

  const importPaper = async () => {
    setPaperBusy(true);
    try {
      const parsed = await importPaperFromInput(paperInput);
      await saveStoredBook(parsed);
      setPaperInput("");
      setAddOpen(false);
      await refreshBooks();
      openBook(parsed);
      setStatusText(`Imported paper "${parsed.title}". ${offlineSummary(parsed)}`);
    } catch (error) {
      Alert.alert("Paper import failed", error instanceof Error ? error.message : String(error));
    } finally {
      setPaperBusy(false);
    }
  };

  const removeBook = async (book: Book) => {
    if (!storedBookIds.includes(book.id)) return;
    await deleteStoredBook(book.id);
    await refreshBooks();
    if (book.id === activeBookId) {
      openBook(sampleBook);
    }
  };

  const openResource = (resource: Resource) => {
    setWebTitle(resource.label || "Source");
    setWebUrl(resource.value);
  };

  const runAssist = async () => {
    setAssistBusy(true);
    try {
      const endpoint = assistEndpoint.trim();
      const model = assistModel.trim() || defaultReaderSettings.assistModel;
      await saveReaderSettings({
        assistEndpoint: endpoint,
        assistModel: model,
      });
      const savedSourceText = await readBookSourceText(activeBook);
      const savedNotesContext = buildNotebookContext(activeBook);
      const prompt = buildAssistPrompt(
        activeBook,
        activeChapter,
        activeSection,
        assistMode,
        assistQuestion,
        savedSourceText,
        savedNotesContext,
      );
      if (!endpoint.trim()) {
        setAssistAnswer(localAssistFallback(prompt));
      } else {
        const answer = await runOpenAiCompatibleAssist({
          endpoint,
          apiKey: assistApiKey,
          model,
          prompt,
        });
        setAssistAnswer(answer);
      }
    } catch (error) {
      setAssistAnswer(error instanceof Error ? error.message : String(error));
    } finally {
      setAssistBusy(false);
    }
  };

  const saveAssistAsNote = async () => {
    const answer = assistAnswer.trim();
    if (!answer || activeBook.id === sampleBook.id) return;

    const note: AiNote = {
      id: `ai-note-${Date.now()}`,
      kind: noteKindForMode(assistMode),
      title: noteTitleForMode(assistMode, activeSection, assistQuestion),
      content: answer,
      createdAt: new Date().toISOString(),
      sourceSectionId: activeSection.id,
      sourceSectionTitle: activeSection.title,
      question: assistQuestion.trim() || undefined,
      model: assistModel.trim() || defaultReaderSettings.assistModel,
      tags: [assistMode, ...activeSection.keywords.slice(0, 3)],
    };

    const updatedBook: Book = {
      ...activeBook,
      aiNotes: [note, ...(activeBook.aiNotes ?? [])],
    };

    await saveStoredBook(updatedBook);
    setBooks((current) => current.map((book) => book.id === updatedBook.id ? updatedBook : book));
    setStoredBookIds((current) => current.includes(updatedBook.id) ? current : [...current, updatedBook.id]);
    setActiveBookId(updatedBook.id);
    setAssistOpen(false);
    setStatusText("Saved AI note into the paper notebook.");
  };

  const removeAiNote = async (noteId: string) => {
    if (activeBook.id === sampleBook.id) return;
    const updatedBook: Book = {
      ...activeBook,
      aiNotes: (activeBook.aiNotes ?? []).filter((note) => note.id !== noteId),
    };

    await saveStoredBook(updatedBook);
    setBooks((current) => current.map((book) => book.id === updatedBook.id ? updatedBook : book));
    setActiveBookId(updatedBook.id);
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <StatusBar barStyle={themeId === "night" ? "light-content" : "dark-content"} />
      <View style={[styles.header, { borderColor: theme.border }]}>
        <View style={styles.headerTitleBlock}>
          <Text style={[styles.eyebrow, { color: theme.muted }]}>BookForge Reader</Text>
          <Text numberOfLines={2} style={[styles.headerTitle, { color: theme.text }]}>
            {activeBook.title}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <AppButton label="Library" onPress={() => setLibraryOpen(true)} theme={theme} variant="ghost" compact />
          <AppButton label="Add" onPress={() => setAddOpen(true)} theme={theme} compact />
        </View>
      </View>

      <ScrollView
        style={styles.reader}
        contentContainerStyle={styles.readerContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.chapterTitle, { color: theme.muted }]}>
          {activeChapter?.title ?? "Chapter"}
        </Text>
        <Text style={[styles.sectionTitle, { color: theme.text }]}>
          {activeSection.title}
        </Text>

        <View style={styles.metaRow}>
          <Pill text={activeSection.persona} theme={theme} />
          {activeBook.source?.type ? <Pill text={activeBook.source.type} theme={theme} /> : null}
          {activeSection.durationMinutes ? (
            <Pill text={`${activeSection.durationMinutes} min`} theme={theme} />
          ) : null}
          {activeSection.keywords.slice(0, 3).map((keyword) => (
            <Pill key={keyword} text={keyword} theme={theme} />
          ))}
        </View>

        <View style={[styles.readingSurface, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          {contentParagraphs.map((paragraph, index) => (
            <Text
              key={`${activeSection.id}-${index}`}
              style={[styles.paragraph, { color: theme.text, fontSize, lineHeight: Math.round(fontSize * 1.58) }]}
            >
              {paragraph}
            </Text>
          ))}
        </View>

        {readingResources.length ? (
          <View style={styles.resourcePanel}>
            <Text style={[styles.resourceTitle, { color: theme.muted }]}>Sources</Text>
            <View style={styles.resourceButtons}>
              {readingResources.map((resource) => (
                <AppButton
                  key={`${resource.label}-${resource.value}`}
                  label={resource.label || resource.type}
                  onPress={() => openResource(resource)}
                  theme={theme}
                  variant="ghost"
                  compact
                />
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>

      <View style={[styles.footer, { borderColor: theme.border, backgroundColor: theme.background }]}>
        <View style={styles.footerTopRow}>
          <AppButton label="Prev" onPress={() => moveSection(-1)} disabled={activeFlatIndex <= 0} theme={theme} variant="ghost" />
          <Text style={[styles.progress, { color: theme.muted }]}>{progressLabel}</Text>
          <AppButton label="Next" onPress={() => moveSection(1)} disabled={activeFlatIndex >= flatSections.length - 1} theme={theme} />
        </View>
        <View style={styles.controlsRow}>
          <AppButton label="Assist" onPress={() => setAssistOpen(true)} theme={theme} />
          <AppButton label={aiNoteCount ? `Notes ${aiNoteCount}` : "Notes"} onPress={() => setNotesOpen(true)} theme={theme} variant="ghost" />
          <AppButton label="A-" onPress={() => setFontSize((value) => Math.max(15, value - 1))} theme={theme} variant="ghost" compact />
          <AppButton label="A+" onPress={() => setFontSize((value) => Math.min(28, value + 1))} theme={theme} variant="ghost" compact />
          {(["paper", "sepia", "night"] as ThemeId[]).map((id) => (
            <AppButton
              key={id}
              label={id}
              onPress={() => setThemeId(id)}
              theme={theme}
              variant={themeId === id ? "solid" : "ghost"}
              compact
            />
          ))}
        </View>
        {statusText ? <Text style={[styles.status, { color: theme.muted }]}>{statusText}</Text> : null}
      </View>

      <LibraryModal
        books={books}
        storedBookIds={storedBookIds}
        activeBookId={activeBookId}
        onClose={() => setLibraryOpen(false)}
        onOpen={openBook}
        onRemove={removeBook}
        open={libraryOpen}
        theme={theme}
      />

      <AddReadingModal
        addMode={addMode}
        importBook={importBook}
        importPaper={importPaper}
        importText={importText}
        onClose={() => setAddOpen(false)}
        open={addOpen}
        paperBusy={paperBusy}
        paperInput={paperInput}
        setAddMode={setAddMode}
        setImportText={setImportText}
        setPaperInput={setPaperInput}
        theme={theme}
      />

      <AssistModal
        answer={assistAnswer}
        apiKey={assistApiKey}
        busy={assistBusy}
        endpoint={assistEndpoint}
        mode={assistMode}
        model={assistModel}
        onClose={() => setAssistOpen(false)}
        onRun={runAssist}
        open={assistOpen}
        question={assistQuestion}
        setApiKey={setAssistApiKey}
        setEndpoint={setAssistEndpoint}
        setMode={setAssistMode}
        setModel={setAssistModel}
        setQuestion={setAssistQuestion}
        onSaveAnswer={saveAssistAsNote}
        canSaveAnswer={activeBook.id !== sampleBook.id && Boolean(assistAnswer.trim())}
        theme={theme}
      />

      <NotesModal
        book={activeBook}
        onClose={() => setNotesOpen(false)}
        onRemove={removeAiNote}
        open={notesOpen}
        theme={theme}
      />

      <Modal animationType="slide" visible={Boolean(webUrl)} presentationStyle="fullScreen">
        <SafeAreaView style={[styles.webShell, { backgroundColor: theme.background }]}>
          <View style={[styles.webHeader, { borderColor: theme.border }]}>
            <Text numberOfLines={1} style={[styles.webTitle, { color: theme.text }]}>{webTitle}</Text>
            <AppButton label="Close" onPress={() => setWebUrl("")} theme={theme} variant="ghost" compact />
          </View>
          {webUrl ? (
            <WebView
              originWhitelist={["*"]}
              source={{ uri: webUrl }}
              startInLoadingState
              renderLoading={() => (
                <View style={styles.webLoading}>
                  <ActivityIndicator />
                </View>
              )}
            />
          ) : null}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function offlineSummary(book: Book) {
  const saved = [
    book.source?.localPdfPath ? "PDF" : "",
    book.source?.localHtmlPath ? "HTML" : "",
    book.source?.localTextPath ? "text" : "",
  ].filter(Boolean);

  return saved.length ? `Offline saved: ${saved.join(", ")}.` : "Source links are online only.";
}

function noteDateLabel(note: AiNote) {
  const date = new Date(note.createdAt);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString();
}

function AppButton({
  compact,
  disabled,
  label,
  onPress,
  theme,
  variant = "solid",
}: {
  compact?: boolean;
  disabled?: boolean;
  label: string;
  onPress: () => void;
  theme: Theme;
  variant?: "solid" | "ghost";
}) {
  const solid = variant === "solid";
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        compact ? styles.buttonCompact : null,
        {
          backgroundColor: solid ? theme.accent : "transparent",
          borderColor: solid ? theme.accent : theme.border,
          opacity: disabled ? 0.38 : pressed ? 0.75 : 1,
        },
      ]}
    >
      <Text style={[styles.buttonText, { color: solid ? theme.accentText : theme.text }]}>
        {label}
      </Text>
    </Pressable>
  );
}

function Pill({ text, theme }: { text: string; theme: Theme }) {
  return (
    <View style={[styles.pill, { borderColor: theme.border, backgroundColor: theme.surface }]}>
      <Text style={[styles.pillText, { color: theme.muted }]}>{text}</Text>
    </View>
  );
}

function AddReadingModal({
  addMode,
  importBook,
  importPaper,
  importText,
  onClose,
  open,
  paperBusy,
  paperInput,
  setAddMode,
  setImportText,
  setPaperInput,
  theme,
}: {
  addMode: AddMode;
  importBook: () => void;
  importPaper: () => void;
  importText: string;
  onClose: () => void;
  open: boolean;
  paperBusy: boolean;
  paperInput: string;
  setAddMode: (mode: AddMode) => void;
  setImportText: (value: string) => void;
  setPaperInput: (value: string) => void;
  theme: Theme;
}) {
  return (
    <Modal animationType="slide" visible={open} presentationStyle="pageSheet">
      <SafeAreaView style={[styles.modalShell, { backgroundColor: theme.background }]}>
        <View style={styles.modalHeader}>
          <Text style={[styles.modalTitle, { color: theme.text }]}>Add Reading</Text>
          <AppButton label="Close" onPress={onClose} theme={theme} variant="ghost" />
        </View>
        <View style={styles.segmentRow}>
          <AppButton label="Paper" onPress={() => setAddMode("paper")} theme={theme} variant={addMode === "paper" ? "solid" : "ghost"} />
          <AppButton label="JSON" onPress={() => setAddMode("json")} theme={theme} variant={addMode === "json" ? "solid" : "ghost"} />
        </View>

        {addMode === "paper" ? (
          <View style={styles.modalBody}>
            <Text style={[styles.helperText, { color: theme.muted }]}>
              Paste an arXiv URL, arXiv ID, DOI landing page, or open-journal paper URL. The app saves metadata, a readable text snapshot, and the PDF when the source allows it.
            </Text>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setPaperInput}
              placeholder="https://arxiv.org/abs/1706.03762"
              placeholderTextColor={theme.muted}
              style={[styles.singleInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }]}
              value={paperInput}
            />
            <AppButton label={paperBusy ? "Importing..." : "Import Paper"} onPress={importPaper} disabled={!paperInput.trim() || paperBusy} theme={theme} />
          </View>
        ) : (
          <View style={styles.modalBody}>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              multiline
              onChangeText={setImportText}
              placeholder="Paste exported BookForge JSON"
              placeholderTextColor={theme.muted}
              style={[styles.importInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }]}
              textAlignVertical="top"
              value={importText}
            />
            <AppButton label="Import JSON" onPress={importBook} disabled={!importText.trim()} theme={theme} />
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

function AssistModal({
  answer,
  apiKey,
  busy,
  endpoint,
  mode,
  model,
  onClose,
  onRun,
  open,
  question,
  setApiKey,
  setEndpoint,
  setMode,
  setModel,
  setQuestion,
  onSaveAnswer,
  canSaveAnswer,
  theme,
}: {
  answer: string;
  apiKey: string;
  busy: boolean;
  endpoint: string;
  mode: AssistMode;
  model: string;
  onClose: () => void;
  onRun: () => void;
  open: boolean;
  question: string;
  setApiKey: (value: string) => void;
  setEndpoint: (value: string) => void;
  setMode: (value: AssistMode) => void;
  setModel: (value: string) => void;
  setQuestion: (value: string) => void;
  onSaveAnswer: () => void;
  canSaveAnswer: boolean;
  theme: Theme;
}) {
  const modes: AssistMode[] = ["paper", "concept", "augment", "summary", "kids", "method", "critique", "custom"];

  return (
    <Modal animationType="slide" visible={open} presentationStyle="pageSheet">
      <SafeAreaView style={[styles.modalShell, { backgroundColor: theme.background }]}>
        <View style={styles.modalHeader}>
          <Text style={[styles.modalTitle, { color: theme.text }]}>Assist</Text>
          <AppButton label="Close" onPress={onClose} theme={theme} variant="ghost" />
        </View>
        <ScrollView contentContainerStyle={styles.assistContent} keyboardShouldPersistTaps="handled">
          <Text style={[styles.helperText, { color: theme.muted }]}>
            Defaults to LM Studio through Tailscale with google/gemma-4-12b-qat. Edit these values when you want a different local server or model.
          </Text>
          <View style={styles.modeGrid}>
            {modes.map((entry) => (
              <AppButton
                key={entry}
                label={entry}
                onPress={() => setMode(entry)}
                theme={theme}
                variant={mode === entry ? "solid" : "ghost"}
                compact
              />
            ))}
          </View>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setEndpoint}
            placeholder="http://100.66.32.111:1235/v1"
            placeholderTextColor={theme.muted}
            style={[styles.singleInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }]}
            value={endpoint}
          />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setModel}
            placeholder="Model"
            placeholderTextColor={theme.muted}
            style={[styles.singleInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }]}
            value={model}
          />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setApiKey}
            placeholder="API key (optional for local servers)"
            placeholderTextColor={theme.muted}
            secureTextEntry
            style={[styles.singleInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }]}
            value={apiKey}
          />
          <TextInput
            multiline
            onChangeText={setQuestion}
            placeholder="Optional question, e.g. what is the paper's main claim?"
            placeholderTextColor={theme.muted}
            style={[styles.questionInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }]}
            textAlignVertical="top"
            value={question}
          />
          <View style={styles.assistActions}>
            <AppButton label={busy ? "Thinking..." : "Run Assist"} onPress={onRun} disabled={busy} theme={theme} />
            <AppButton label="Save Note" onPress={onSaveAnswer} disabled={!canSaveAnswer || busy} theme={theme} variant="ghost" />
          </View>
          {answer ? (
            <View style={[styles.assistAnswer, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Text style={[styles.assistAnswerText, { color: theme.text }]}>{answer}</Text>
            </View>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function NotesModal({
  book,
  onClose,
  onRemove,
  open,
  theme,
}: {
  book: Book;
  onClose: () => void;
  onRemove: (noteId: string) => void;
  open: boolean;
  theme: Theme;
}) {
  const notes = book.aiNotes ?? [];

  return (
    <Modal animationType="slide" visible={open} presentationStyle="pageSheet">
      <SafeAreaView style={[styles.modalShell, { backgroundColor: theme.background }]}>
        <View style={styles.modalHeader}>
          <Text style={[styles.modalTitle, { color: theme.text }]}>Notes</Text>
          <AppButton label="Close" onPress={onClose} theme={theme} variant="ghost" />
        </View>
        <ScrollView contentContainerStyle={styles.notesList}>
          {notes.length ? notes.map((note) => (
            <View key={note.id} style={[styles.noteCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <View style={styles.noteHeader}>
                <View style={styles.noteTitleBlock}>
                  <Text style={[styles.noteTitle, { color: theme.text }]}>{note.title}</Text>
                  <Text style={[styles.noteMeta, { color: theme.muted }]}>
                    {[note.kind, note.sourceSectionTitle, note.model, noteDateLabel(note)].filter(Boolean).join(" - ")}
                  </Text>
                </View>
                <AppButton label="Delete" onPress={() => onRemove(note.id)} theme={theme} variant="ghost" compact />
              </View>
              {note.question ? (
                <Text style={[styles.noteQuestion, { borderLeftColor: theme.border, color: theme.muted }]}>{note.question}</Text>
              ) : null}
              <Text style={[styles.noteContent, { color: theme.text }]}>{note.content}</Text>
            </View>
          )) : (
            <View style={[styles.emptyNotes, { borderColor: theme.border }]}>
              <Text style={[styles.helperText, { color: theme.muted }]}>
                Run Assist with LM Studio, then save explanations, concepts, and references here.
              </Text>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function LibraryModal({
  activeBookId,
  books,
  onClose,
  onOpen,
  onRemove,
  open,
  storedBookIds,
  theme,
}: {
  activeBookId: string;
  books: Book[];
  onClose: () => void;
  onOpen: (book: Book) => void;
  onRemove: (book: Book) => void;
  open: boolean;
  storedBookIds: string[];
  theme: Theme;
}) {
  return (
    <Modal animationType="slide" visible={open} presentationStyle="pageSheet">
      <SafeAreaView style={[styles.modalShell, { backgroundColor: theme.background }]}>
        <View style={styles.modalHeader}>
          <Text style={[styles.modalTitle, { color: theme.text }]}>Library</Text>
          <AppButton label="Close" onPress={onClose} theme={theme} variant="ghost" />
        </View>
        <ScrollView contentContainerStyle={styles.libraryList}>
          {books.map((book) => {
            const stored = storedBookIds.includes(book.id);
            return (
              <View
                key={book.id}
                style={[styles.libraryItem, { backgroundColor: theme.surface, borderColor: theme.border }]}
              >
                <View style={styles.libraryItemText}>
                  <Text style={[styles.libraryTitle, { color: theme.text }]}>{book.title}</Text>
                  <Text numberOfLines={2} style={[styles.libraryMeta, { color: theme.muted }]}>
                    {book.audience || "Reader"} - {book.chapters.length} chapters
                    {book.source?.type ? ` - ${book.source.type}` : ""}
                    {book.id === activeBookId ? " - Open" : ""}
                  </Text>
                </View>
                <View style={styles.libraryActions}>
                  <AppButton label="Read" onPress={() => onOpen(book)} theme={theme} compact />
                  {stored ? (
                    <AppButton label="Delete" onPress={() => onRemove(book)} theme={theme} variant="ghost" compact />
                  ) : null}
                </View>
              </View>
            );
          })}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  header: {
    alignItems: "center",
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerTitleBlock: {
    flex: 1,
    paddingRight: 12,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0,
    textTransform: "uppercase",
  },
  headerTitle: {
    fontSize: 19,
    fontWeight: "800",
    letterSpacing: 0,
    lineHeight: 23,
    marginTop: 2,
  },
  headerActions: {
    flexDirection: "row",
    gap: 8,
  },
  reader: {
    flex: 1,
  },
  readerContent: {
    padding: 16,
    paddingBottom: 26,
  },
  chapterTitle: {
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0,
    marginBottom: 6,
    textTransform: "uppercase",
  },
  sectionTitle: {
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: 0,
    lineHeight: 34,
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12,
  },
  pill: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  pillText: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0,
    textTransform: "capitalize",
  },
  readingSurface: {
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 18,
    paddingHorizontal: 18,
    paddingVertical: 20,
  },
  paragraph: {
    fontWeight: "400",
    letterSpacing: 0,
    marginBottom: 18,
  },
  resourcePanel: {
    marginTop: 14,
  },
  resourceTitle: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0,
    marginBottom: 8,
    textTransform: "uppercase",
  },
  resourceButtons: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  footer: {
    borderTopWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
  },
  footerTopRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  progress: {
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0,
  },
  controlsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 10,
  },
  status: {
    fontSize: 12,
    marginTop: 8,
  },
  button: {
    alignItems: "center",
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 38,
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  buttonCompact: {
    minHeight: 34,
    paddingHorizontal: 11,
  },
  buttonText: {
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 0,
    textTransform: "capitalize",
  },
  modalShell: {
    flex: 1,
    padding: 16,
  },
  modalHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: 0,
  },
  modalBody: {
    flex: 1,
    gap: 14,
  },
  segmentRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 14,
  },
  helperText: {
    fontSize: 14,
    lineHeight: 20,
  },
  singleInput: {
    borderRadius: 8,
    borderWidth: 1,
    fontSize: 15,
    minHeight: 46,
    paddingHorizontal: 12,
  },
  questionInput: {
    borderRadius: 8,
    borderWidth: 1,
    fontSize: 15,
    minHeight: 92,
    padding: 12,
  },
  importInput: {
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    fontFamily: "Menlo",
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 14,
    padding: 12,
  },
  libraryList: {
    gap: 10,
    paddingBottom: 24,
  },
  libraryItem: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 14,
  },
  libraryItemText: {
    marginBottom: 12,
  },
  libraryTitle: {
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: 0,
  },
  libraryMeta: {
    fontSize: 13,
    marginTop: 4,
  },
  libraryActions: {
    flexDirection: "row",
    gap: 8,
  },
  notesList: {
    gap: 12,
    paddingBottom: 32,
  },
  noteCard: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 14,
  },
  noteHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
  },
  noteTitleBlock: {
    flex: 1,
  },
  noteTitle: {
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: 0,
  },
  noteMeta: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
  },
  noteQuestion: {
    borderLeftWidth: 2,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 12,
    paddingLeft: 10,
  },
  noteContent: {
    fontSize: 14,
    lineHeight: 21,
    marginTop: 12,
  },
  emptyNotes: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 16,
  },
  assistContent: {
    gap: 12,
    paddingBottom: 32,
  },
  modeGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  assistActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  assistAnswer: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 14,
  },
  assistAnswerText: {
    fontFamily: "Menlo",
    fontSize: 13,
    lineHeight: 19,
  },
  webShell: {
    flex: 1,
  },
  webHeader: {
    alignItems: "center",
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  webTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: 0,
    paddingRight: 12,
  },
  webLoading: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
});
