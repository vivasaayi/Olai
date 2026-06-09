import * as FileSystem from "expo-file-system";

export type ReaderSettings = {
  assistEndpoint: string;
  assistModel: string;
};

export const defaultReaderSettings: ReaderSettings = {
  assistEndpoint: "http://100.66.32.111:1235/v1",
  assistModel: "google/gemma-4-12b-qat",
};

const legacyDefaultEndpoints = new Set([
  "http://192.168.1.152:1234/v1",
  "http://192.168.1.152:1235/v1",
  "http://rajans-macbook-pro:1235/v1",
  "http://rajans-macbook-pro:1234/v1",
  "http://rajans-macbook-pro.local:1234/v1",
]);

const legacyDefaultModels = new Set([
  "local-model",
]);

function settingsPath() {
  if (!FileSystem.documentDirectory) {
    throw new Error("Device document storage is unavailable.");
  }
  return `${FileSystem.documentDirectory}reader-settings.json`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readEndpoint(value: unknown) {
  const endpoint = typeof value === "string" ? value.trim() : "";
  return endpoint && !legacyDefaultEndpoints.has(endpoint) ? endpoint : defaultReaderSettings.assistEndpoint;
}

function readModel(value: unknown) {
  const model = typeof value === "string" ? value.trim() : "";
  return model && !legacyDefaultModels.has(model) ? model : defaultReaderSettings.assistModel;
}

export async function loadReaderSettings(): Promise<ReaderSettings> {
  const path = settingsPath();
  const info = await FileSystem.getInfoAsync(path);
  if (!info.exists) {
    return defaultReaderSettings;
  }

  try {
    const raw = asRecord(JSON.parse(await FileSystem.readAsStringAsync(path)));
    return {
      assistEndpoint: readEndpoint(raw.assistEndpoint),
      assistModel: readModel(raw.assistModel),
    };
  } catch {
    return defaultReaderSettings;
  }
}

export async function saveReaderSettings(settings: ReaderSettings) {
  await FileSystem.writeAsStringAsync(settingsPath(), JSON.stringify(settings, null, 2));
}
