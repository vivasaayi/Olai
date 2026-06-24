#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
      app_data_dir,
      save_book,
      load_book,
      list_books,
      delete_book,
      suggest_outline_topics,
      list_available_models,
      download_model,
      list_local_models,
      chat_with_model,
      save_old_book_snapshot,
      old_book_snapshot_dir,
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
use tauri::Emitter;
use reqwest::blocking::Client;
use std::process::Command;
use base64::{engine::general_purpose, Engine as _};

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

fn safe_path_segment(value: &str) -> String {
  let sanitized: String = value
    .chars()
    .map(|ch| {
      if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
        ch
      } else {
        '-'
      }
    })
    .collect();

  let trimmed = sanitized.trim_matches('-');
  if trimmed.is_empty() {
    "old-book".into()
  } else {
    trimmed.into()
  }
}

fn old_book_snapshots_dir(book_id: &str) -> Result<PathBuf, String> {
  let mut p = data_local_dir().ok_or("app_data_dir not found".to_string())?;
  p.push("bookforge");
  p.push("old-book-snapshots");
  p.push(safe_path_segment(book_id));
  Ok(p)
}

#[tauri::command]
fn old_book_snapshot_dir(book_id: String) -> Result<String, String> {
  let dir = old_book_snapshots_dir(&book_id)?;
  fs::create_dir_all(&dir).map_err(|e| format!("create snapshot dir: {}", e))?;
  Ok(dir.to_string_lossy().into_owned())
}

#[tauri::command]
fn save_old_book_snapshot(book_id: String, page_number: u32, image_data_url: String) -> Result<String, String> {
  let (header, base64_data) = image_data_url
    .split_once(',')
    .ok_or_else(|| "snapshot image must be a data URL".to_string())?;

  let extension = if header.contains("image/png") { "png" } else { "jpg" };
  let bytes = general_purpose::STANDARD
    .decode(base64_data)
    .map_err(|e| format!("decode snapshot image: {}", e))?;

  let dir = old_book_snapshots_dir(&book_id)?;
  fs::create_dir_all(&dir).map_err(|e| format!("create snapshot dir: {}", e))?;

  let mut file_path = dir;
  file_path.push(format!("page-{:04}.{}", page_number, extension));
  fs::write(&file_path, bytes).map_err(|e| format!("write snapshot file: {}", e))?;

  Ok(file_path.to_string_lossy().into_owned())
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
    let _ = app.emit("model-download-progress", payload);
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
fn delete_book(file_name: String) -> Result<(), String> {
  if file_name.contains('/') || file_name.contains('\\') || file_name == "." || file_name == ".." {
    return Err("invalid book file name".into());
  }

  let mut path = books_dir()?;
  path.push(file_name);
  if path.exists() {
    fs::remove_file(path).map_err(|e| format!("delete_file: {}", e))?;
  }
  Ok(())
}

fn router_chat_url(endpoint: &str) -> Result<String, String> {
  let trimmed = endpoint.trim().trim_end_matches('/');
  if trimmed.is_empty() {
    return Err("router endpoint is required".into());
  }

  let client_endpoint = trimmed.replace("://0.0.0.0", "://localhost");
  if client_endpoint.ends_with("/chat/completions") {
    Ok(client_endpoint)
  } else if client_endpoint.ends_with("/v1") {
    Ok(format!("{}/chat/completions", client_endpoint))
  } else {
    Ok(format!("{}/v1/chat/completions", client_endpoint))
  }
}

#[tauri::command]
fn suggest_outline_topics(endpoint: String, model: String, prompt: String) -> Result<String, String> {
  let url = router_chat_url(&endpoint)?;
  let model_name = if model.trim().is_empty() { "default" } else { model.trim() };
  let client = Client::builder()
    .user_agent("bookforge-designer/0.1")
    .build()
    .map_err(|e| format!("client build: {}", e))?;

  let base_payload = serde_json::json!({
    "model": model_name,
    "messages": [
      {
        "role": "system",
        "content": "You are a book outline architect. Return only strict JSON. Do not include markdown."
      },
      {
        "role": "user",
        "content": prompt
      }
    ],
    "temperature": 0.4
  });

  let payload_with_format = {
    let mut value = base_payload.clone();
    value["response_format"] = serde_json::json!({ "type": "json_object" });
    value
  };

  let mut response = client
    .post(&url)
    .json(&payload_with_format)
    .send()
    .map_err(|e| format!("router request: {}", e))?;

  if response.status() == reqwest::StatusCode::BAD_REQUEST || response.status() == reqwest::StatusCode::UNPROCESSABLE_ENTITY {
    response = client
      .post(&url)
      .json(&base_payload)
      .send()
      .map_err(|e| format!("router request: {}", e))?;
  }

  let status = response.status();
  let body = response.text().map_err(|e| format!("router response read: {}", e))?;
  if !status.is_success() {
    return Err(format!("router request failed: {} {}", status, body));
  }

  let parsed: serde_json::Value = serde_json::from_str(&body).map_err(|e| format!("router response json: {}", e))?;
  parsed
    .get("choices")
    .and_then(|choices| choices.get(0))
    .and_then(|choice| choice.get("message"))
    .and_then(|message| message.get("content"))
    .and_then(|content| content.as_str())
    .map(|content| content.to_string())
    .ok_or_else(|| "router response did not include choices[0].message.content".into())
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
