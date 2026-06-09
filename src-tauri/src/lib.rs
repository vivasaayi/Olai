#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
      save_book,
      load_book,
      list_books,
      list_available_models,
      download_model,
      list_local_models,
      chat_with_model,
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

use std::fs;
use std::path::PathBuf;
use dirs_next::data_local_dir;
use serde::{Deserialize, Serialize};
// use std::io::copy; // previously used for simple copy; replaced by chunked copy for progress
use std::fs::File;
use std::io::{Read, Write};
use tauri::Manager;
use reqwest::blocking::Client;
use std::process::Command;

#[tauri::command]
fn app_data_dir() -> Result<String, String> {
  data_local_dir()
    .ok_or_else(|| "failed to find app data dir".into())
    .map(|p| p.to_string_lossy().into_owned())
}

fn books_dir() -> Result<PathBuf, String> {
  let mut p = data_local_dir().ok_or("app_data_dir not found".to_string())?;
  p.push("bookforge");
  p.push("books");
  Ok(p)
}

#[derive(Serialize, Deserialize)]
struct ModelInfo {
  id: String,
  name: String,
  url: String,
  description: String,
  size_mb: Option<f64>,
}

#[tauri::command]
fn list_available_models() -> Result<Vec<ModelInfo>, String> {
  // Mobile-first demo models (small/quantized) — urls are placeholders for a real model host
  Ok(vec![
    ModelInfo {
      id: "tiny-llama".into(),
      name: "Tiny Llama (demo)".into(),
      url: "https://example.com/models/tiny-llama.bin".into(),
      description: "Very small llama variant (demo).".into(),
      size_mb: Some(14.2),
    },
    ModelInfo {
      id: "alpaca-mini".into(),
      name: "Alpaca-Mini (demo)".into(),
      url: "https://example.com/models/alpaca-mini.bin".into(),
      description: "Small instruction-tuned model suitable for mobile.".into(),
      size_mb: Some(22.7),
    },
  ])
}

fn models_dir() -> Result<PathBuf, String> {
  let mut p = data_local_dir().ok_or("app_data_dir not found".to_string())?;
  p.push("bookforge");
  p.push("models");
  Ok(p)
}

#[tauri::command]
fn list_local_models() -> Result<Vec<String>, String> {
  let dir = models_dir()?;
  let mut out = Vec::new();
  if dir.exists() {
    for entry in fs::read_dir(dir).map_err(|e| format!("read_dir: {}", e))? {
      let p = entry.map_err(|e| format!("entry: {}", e))?.path();
      if let Some(name) = p.file_name() {
        out.push(name.to_string_lossy().into_owned());
      }
    }
  }
  Ok(out)
}

#[tauri::command]
fn download_model(app: tauri::AppHandle, model_id: String) -> Result<String, String> {
  let models = list_available_models()?;
  let maybe = models.into_iter().find(|m| m.id == model_id);
  let info = maybe.ok_or(format!("model not found: {}", model_id))?;

  let dir = models_dir()?;
  fs::create_dir_all(&dir).map_err(|e| format!("create dir: {}", e))?;
  let mut target = dir;
  target.push(format!("{}.bin", info.id));

  // simple blocking download
  let client = Client::builder()
    .user_agent("bookforge-agent/0.1")
    .build()
    .map_err(|e| format!("client build: {}", e))?;

  let mut resp = client
    .get(&info.url)
    .send()
    .map_err(|e| format!("download send: {}", e))?
    .error_for_status()
    .map_err(|e| format!("download http: {}", e))?;

  let total = resp.content_length().unwrap_or(0);
  let mut file = File::create(&target).map_err(|e| format!("create file: {}", e))?;
  let mut buffer = [0u8; 8192];
  let mut downloaded: u64 = 0;
  loop {
    let n = resp.read(&mut buffer).map_err(|e| format!("read chunk: {}", e))?;
    if n == 0 {
      break;
    }
    file.write_all(&buffer[..n]).map_err(|e| format!("write: {}", e))?;
    downloaded += n as u64;
    // emit progress to frontend
    let payload = serde_json::json!({"model_id": info.id, "downloaded": downloaded, "total": total});
    let _ = <tauri::AppHandle as tauri::Manager>::emit_all(&app, "model-download-progress", payload);
  }

  Ok(target.file_name().unwrap().to_string_lossy().into_owned())
}

// A toy local LLM runner - replace with real inference core later
#[tauri::command]
fn chat_with_model(model_name: String, prompt: String) -> Result<String, String> {
  // Try to run a local native runner if present (e.g., a llama.cpp binary) for the downloaded model
  if let Ok(mut model_path) = models_dir() {
    let file_name = if model_name.ends_with(".bin") {
      model_name.clone()
    } else {
      format!("{}.bin", model_name)
    };
    model_path.push(file_name);
    if model_path.exists() {
      // Prefer a bundled inference binary under bookforge/bin, then fallback to PATH `llama`.
      let mut runner = models_dir().unwrap_or_else(|_| PathBuf::from("./"));
      runner.pop(); // move up from models to bookforge
      runner.push("bin");
      runner.push("runner");
      if !runner.exists() {
        runner = PathBuf::from("llama");
      }

      // Construct a simple external command for demonstration; many inference runtimes accept
      // '-m <model>' and '-p <prompt>' or similar flags (llama.cpp main). Adjust to your runtime.
      let prompt_arg = prompt.clone();
      let output = Command::new(runner)
        .arg("-m")
        .arg(model_path.to_string_lossy().to_string())
        .arg("-p")
        .arg(prompt_arg)
        .output();

      match output {
        Ok(out) => {
          if out.status.success() {
            return Ok(String::from_utf8_lossy(&out.stdout).into_owned());
          } else {
            return Err(format!("inference failed: {}", String::from_utf8_lossy(&out.stderr)));
          }
        }
        Err(e) => {
          // fall through to the local stub reply
          log::warn!("failed to spawn runner: {}", e);
        }
      }
    }
  }

  // Fallback: echo prompt with demo reply so the UI demonstrates an end-to-end local invocation
  let reply = format!(
    "[LocalStub: {}] I saw your prompt: {}\nAssistant: This is a demo reply generated locally.",
    model_name, prompt
  );
  Ok(reply)
}

#[tauri::command]
fn save_book(book_id: String, payload: String) -> Result<String, String> {
  let dir = books_dir()?;
  fs::create_dir_all(&dir).map_err(|e| format!("create dir: {}", e))?;
  let mut file = dir;
  if book_id.is_empty() {
    let uuid = uuid::Uuid::new_v4().to_string();
    file.push(format!("{}.json", uuid));
  } else {
    file.push(format!("{}.json", book_id));
  }
  fs::write(&file, payload).map_err(|e| format!("write file: {}", e))?;
  Ok(file.file_name().unwrap().to_string_lossy().into_owned())
}

#[tauri::command]
fn load_book(file_name: String) -> Result<String, String> {
  let mut path = books_dir()?;
  path.push(file_name);
  fs::read_to_string(path).map_err(|e| format!("read_file: {}", e))
}

#[tauri::command]
fn list_books() -> Result<Vec<String>, String> {
  let dir = books_dir()?;
  let mut list = Vec::new();
  if dir.exists() {
    for entry in fs::read_dir(dir).map_err(|e| format!("read_dir: {}", e))? {
      let p = entry.map_err(|e| format!("entry: {}", e))?.path();
      if let Some(name) = p.file_name() {
        list.push(name.to_string_lossy().into_owned());
      }
    }
  }
  Ok(list)
}
