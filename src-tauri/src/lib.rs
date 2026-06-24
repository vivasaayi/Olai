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
            old_book_sqlite_available,
            old_book_sqlite_list_records,
            old_book_sqlite_save_record,
            old_book_sqlite_save_pdf_asset,
            old_book_sqlite_get_pdf_asset,
            old_book_sqlite_get_file_data_url,
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

use dirs_next::data_local_dir;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
// use std::io::copy; // previously used for simple copy; replaced by chunked copy for progress
use base64::{engine::general_purpose, Engine as _};
use reqwest::blocking::Client;
use rusqlite::{params, Connection, Transaction};
use serde_json::Value;
use std::fs::File;
use std::io::{Read, Write};
use std::process::Command;
use tauri::Emitter;

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

fn bookforge_dir() -> Result<PathBuf, String> {
    let mut p = data_local_dir().ok_or("app_data_dir not found".to_string())?;
    p.push("bookforge");
    Ok(p)
}

fn old_book_book_dir(book_id: &str) -> Result<PathBuf, String> {
    let mut p = bookforge_dir()?;
    p.push("books");
    p.push(safe_path_segment(book_id));
    Ok(p)
}

fn sqlite_path() -> Result<PathBuf, String> {
    let mut p = bookforge_dir()?;
    fs::create_dir_all(&p).map_err(|e| format!("create bookforge dir: {}", e))?;
    p.push("library.sqlite");
    Ok(p)
}

fn open_library_db() -> Result<Connection, String> {
    let conn =
        Connection::open(sqlite_path()?).map_err(|e| format!("open library sqlite: {}", e))?;
    migrate_library_db(&conn)?;
    Ok(conn)
}

fn migrate_library_db(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS old_book_records (
      id TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS old_book_pdf_assets (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      saved_at TEXT NOT NULL,
      FOREIGN KEY(book_id) REFERENCES old_book_records(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS old_book_page_snapshots (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      page_number INTEGER NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      image_data_url TEXT,
      file_path TEXT,
      created_at TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      UNIQUE(book_id, page_number),
      FOREIGN KEY(book_id) REFERENCES old_book_records(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS old_book_snapshot_jobs (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      current_page INTEGER NOT NULL,
      total_pages INTEGER NOT NULL,
      phase TEXT NOT NULL,
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      FOREIGN KEY(book_id) REFERENCES old_book_records(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS old_book_translations (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      page_number INTEGER NOT NULL,
      complexity TEXT NOT NULL,
      language TEXT NOT NULL,
      section_title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      UNIQUE(book_id, page_number, complexity, language),
      FOREIGN KEY(book_id) REFERENCES old_book_records(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS old_book_translation_memory (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      source_term TEXT NOT NULL,
      translated_term TEXT NOT NULL,
      approved INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      FOREIGN KEY(book_id) REFERENCES old_book_records(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS old_book_translation_jobs (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      current_page INTEGER NOT NULL,
      total_pages INTEGER NOT NULL,
      phase TEXT NOT NULL,
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      FOREIGN KEY(book_id) REFERENCES old_book_records(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS old_book_questions (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      page_number INTEGER NOT NULL,
      question TEXT NOT NULL,
      created_at TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      FOREIGN KEY(book_id) REFERENCES old_book_records(id) ON DELETE CASCADE
    );

    INSERT OR IGNORE INTO schema_migrations(version, name) VALUES (1, 'old_book_library');
    ",
    )
    .map_err(|e| format!("migrate library sqlite: {}", e))
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
    let mut p = old_book_book_dir(book_id)?;
    p.push("snapshots");
    Ok(p)
}

#[tauri::command]
fn old_book_snapshot_dir(book_id: String) -> Result<String, String> {
    let dir = old_book_snapshots_dir(&book_id)?;
    fs::create_dir_all(&dir).map_err(|e| format!("create snapshot dir: {}", e))?;
    Ok(dir.to_string_lossy().into_owned())
}

#[tauri::command]
fn save_old_book_snapshot(
    book_id: String,
    page_number: u32,
    image_data_url: String,
) -> Result<String, String> {
    let (header, base64_data) = image_data_url
        .split_once(',')
        .ok_or_else(|| "snapshot image must be a data URL".to_string())?;

    let extension = if header.contains("image/png") {
        "png"
    } else {
        "jpg"
    };
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredPdfAsset {
    base64: String,
    file_name: String,
    mime_type: String,
    size_bytes: u64,
    file_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredFileAsset {
    data_url: String,
}

fn json_string_field(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(|entry| entry.as_str())
        .unwrap_or("")
        .to_string()
}

fn json_i64_field(value: &Value, key: &str) -> i64 {
    value
        .get(key)
        .and_then(|entry| {
            entry
                .as_i64()
                .or_else(|| entry.as_u64().map(|number| number as i64))
        })
        .unwrap_or(0)
}

fn json_bool_field(value: &Value, key: &str) -> i64 {
    if value
        .get(key)
        .and_then(|entry| entry.as_bool())
        .unwrap_or(false)
    {
        1
    } else {
        0
    }
}

fn json_array_field<'a>(value: &'a Value, key: &str) -> Vec<&'a Value> {
    value
        .get(key)
        .and_then(|entry| entry.as_array())
        .map(|entries| entries.iter().collect())
        .unwrap_or_default()
}

fn sync_old_book_detail_tables(
    tx: &Transaction<'_>,
    book_id: &str,
    payload: &Value,
) -> Result<(), String> {
    for table in [
        "old_book_page_snapshots",
        "old_book_snapshot_jobs",
        "old_book_translations",
        "old_book_translation_memory",
        "old_book_translation_jobs",
        "old_book_questions",
    ] {
        tx.execute(
            &format!("DELETE FROM {} WHERE book_id = ?1", table),
            params![book_id],
        )
        .map_err(|e| format!("clear {}: {}", table, e))?;
    }

    for (index, snapshot) in json_array_field(payload, "pageSnapshots")
        .into_iter()
        .enumerate()
    {
        let id = json_string_field(snapshot, "id");
        let id = if id.is_empty() {
            format!("{}-snapshot-{}", book_id, index + 1)
        } else {
            id
        };
        let payload_json =
            serde_json::to_string(snapshot).map_err(|e| format!("snapshot json: {}", e))?;
        tx.execute(
      "INSERT INTO old_book_page_snapshots
        (id, book_id, page_number, width, height, image_data_url, file_path, created_at, payload_json)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
      params![
        id,
        book_id,
        json_i64_field(snapshot, "pageNumber"),
        json_i64_field(snapshot, "width"),
        json_i64_field(snapshot, "height"),
        json_string_field(snapshot, "imageDataUrl"),
        json_string_field(snapshot, "filePath"),
        json_string_field(snapshot, "createdAt"),
        payload_json,
      ],
    )
    .map_err(|e| format!("insert snapshot: {}", e))?;
    }

    for (index, translation) in json_array_field(payload, "translations")
        .into_iter()
        .enumerate()
    {
        let id = json_string_field(translation, "id");
        let id = if id.is_empty() {
            format!("{}-translation-{}", book_id, index + 1)
        } else {
            id
        };
        let payload_json =
            serde_json::to_string(translation).map_err(|e| format!("translation json: {}", e))?;
        tx.execute(
            "INSERT INTO old_book_translations
        (id, book_id, page_number, complexity, language, section_title, created_at, payload_json)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                id,
                book_id,
                json_i64_field(translation, "pageNumber"),
                json_string_field(translation, "complexity"),
                json_string_field(translation, "language"),
                json_string_field(translation, "sectionTitle"),
                json_string_field(translation, "createdAt"),
                payload_json,
            ],
        )
        .map_err(|e| format!("insert translation: {}", e))?;
    }

    for (index, job) in json_array_field(payload, "snapshotJobs")
        .into_iter()
        .enumerate()
    {
        let id = json_string_field(job, "id");
        let id = if id.is_empty() {
            format!("{}-snapshot-job-{}", book_id, index + 1)
        } else {
            id
        };
        let payload_json =
            serde_json::to_string(job).map_err(|e| format!("snapshot job json: {}", e))?;
        tx.execute(
      "INSERT INTO old_book_snapshot_jobs
        (id, book_id, kind, status, current_page, total_pages, phase, started_at, updated_at, payload_json)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
      params![
        id,
        book_id,
        json_string_field(job, "kind"),
        json_string_field(job, "status"),
        json_i64_field(job, "currentPage"),
        json_i64_field(job, "totalPages"),
        json_string_field(job, "phase"),
        json_string_field(job, "startedAt"),
        json_string_field(job, "updatedAt"),
        payload_json,
      ],
    )
    .map_err(|e| format!("insert snapshot job: {}", e))?;
    }

    for (index, entry) in json_array_field(payload, "translationMemory")
        .into_iter()
        .enumerate()
    {
        let id = json_string_field(entry, "id");
        let id = if id.is_empty() {
            format!("{}-memory-{}", book_id, index + 1)
        } else {
            id
        };
        let payload_json =
            serde_json::to_string(entry).map_err(|e| format!("translation memory json: {}", e))?;
        tx.execute(
            "INSERT INTO old_book_translation_memory
        (id, book_id, source_term, translated_term, approved, created_at, updated_at, payload_json)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                id,
                book_id,
                json_string_field(entry, "sourceTerm"),
                json_string_field(entry, "translatedTerm"),
                json_bool_field(entry, "approved"),
                json_string_field(entry, "createdAt"),
                json_string_field(entry, "updatedAt"),
                payload_json,
            ],
        )
        .map_err(|e| format!("insert translation memory: {}", e))?;
    }

    for (index, job) in json_array_field(payload, "translationJobs")
        .into_iter()
        .enumerate()
    {
        let id = json_string_field(job, "id");
        let id = if id.is_empty() {
            format!("{}-job-{}", book_id, index + 1)
        } else {
            id
        };
        let payload_json =
            serde_json::to_string(job).map_err(|e| format!("translation job json: {}", e))?;
        tx.execute(
      "INSERT INTO old_book_translation_jobs
        (id, book_id, kind, status, current_page, total_pages, phase, started_at, updated_at, payload_json)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
      params![
        id,
        book_id,
        json_string_field(job, "kind"),
        json_string_field(job, "status"),
        json_i64_field(job, "currentPage"),
        json_i64_field(job, "totalPages"),
        json_string_field(job, "phase"),
        json_string_field(job, "startedAt"),
        json_string_field(job, "updatedAt"),
        payload_json,
      ],
    )
    .map_err(|e| format!("insert translation job: {}", e))?;
    }

    for (index, question) in json_array_field(payload, "questions")
        .into_iter()
        .enumerate()
    {
        let id = json_string_field(question, "id");
        let id = if id.is_empty() {
            format!("{}-question-{}", book_id, index + 1)
        } else {
            id
        };
        let payload_json =
            serde_json::to_string(question).map_err(|e| format!("question json: {}", e))?;
        tx.execute(
            "INSERT INTO old_book_questions
        (id, book_id, page_number, question, created_at, payload_json)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                id,
                book_id,
                json_i64_field(question, "pageNumber"),
                json_string_field(question, "question"),
                json_string_field(question, "createdAt"),
                payload_json,
            ],
        )
        .map_err(|e| format!("insert question: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
fn old_book_sqlite_available() -> Result<bool, String> {
    open_library_db().map(|_| true)
}

#[tauri::command]
fn old_book_sqlite_list_records() -> Result<Vec<String>, String> {
    let conn = open_library_db()?;
    let mut stmt = conn
        .prepare("SELECT payload_json FROM old_book_records ORDER BY updated_at DESC")
        .map_err(|e| format!("prepare old book list: {}", e))?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| format!("query old book list: {}", e))?;

    let mut records = Vec::new();
    for row in rows {
        records.push(row.map_err(|e| format!("read old book row: {}", e))?);
    }
    Ok(records)
}

#[tauri::command]
fn old_book_sqlite_save_record(payload: String) -> Result<(), String> {
    let value: Value =
        serde_json::from_str(&payload).map_err(|e| format!("parse old book payload: {}", e))?;
    let id = json_string_field(&value, "id");
    if id.is_empty() {
        return Err("old book record is missing id".into());
    }
    let created_at = json_string_field(&value, "createdAt");
    let updated_at = json_string_field(&value, "updatedAt");

    let mut conn = open_library_db()?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("start old book transaction: {}", e))?;
    tx.execute(
        "INSERT INTO old_book_records (id, payload_json, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(id) DO UPDATE SET
       payload_json = excluded.payload_json,
       created_at = excluded.created_at,
       updated_at = excluded.updated_at",
        params![id, payload, created_at, updated_at],
    )
    .map_err(|e| format!("save old book record: {}", e))?;
    sync_old_book_detail_tables(&tx, &json_string_field(&value, "id"), &value)?;
    tx.commit()
        .map_err(|e| format!("commit old book record: {}", e))
}

#[tauri::command]
fn old_book_sqlite_save_pdf_asset(
    book_id: String,
    pdf_blob_id: String,
    file_name: String,
    pdf_base64: String,
) -> Result<String, String> {
    if book_id.trim().is_empty() || pdf_blob_id.trim().is_empty() {
        return Err("book id and pdf blob id are required".into());
    }

    let bytes = general_purpose::STANDARD
        .decode(pdf_base64)
        .map_err(|e| format!("decode PDF: {}", e))?;
    let book_dir = old_book_book_dir(&book_id)?;
    fs::create_dir_all(&book_dir).map_err(|e| format!("create old book dir: {}", e))?;
    let mut file_path = book_dir;
    file_path.push("original.pdf");
    fs::write(&file_path, &bytes).map_err(|e| format!("write PDF: {}", e))?;

    let conn = open_library_db()?;
    conn.execute(
    "INSERT INTO old_book_pdf_assets (id, book_id, file_name, file_path, mime_type, size_bytes, saved_at)
     VALUES (?1, ?2, ?3, ?4, 'application/pdf', ?5, CURRENT_TIMESTAMP)
     ON CONFLICT(id) DO UPDATE SET
       book_id = excluded.book_id,
       file_name = excluded.file_name,
       file_path = excluded.file_path,
       mime_type = excluded.mime_type,
       size_bytes = excluded.size_bytes,
       saved_at = excluded.saved_at",
    params![
      pdf_blob_id,
      book_id,
      file_name,
      file_path.to_string_lossy().to_string(),
      bytes.len() as i64,
    ],
  )
  .map_err(|e| format!("save PDF asset row: {}", e))?;

    Ok(file_path.to_string_lossy().into_owned())
}

#[tauri::command]
fn old_book_sqlite_get_pdf_asset(pdf_blob_id: String) -> Result<Option<StoredPdfAsset>, String> {
    let conn = open_library_db()?;
    let mut stmt = conn
    .prepare("SELECT file_name, file_path, mime_type, size_bytes FROM old_book_pdf_assets WHERE id = ?1")
    .map_err(|e| format!("prepare PDF asset lookup: {}", e))?;
    let mut rows = stmt
        .query(params![pdf_blob_id])
        .map_err(|e| format!("query PDF asset: {}", e))?;

    let Some(row) = rows
        .next()
        .map_err(|e| format!("read PDF asset row: {}", e))?
    else {
        let mut fallback_stmt = conn
            .prepare("SELECT payload_json FROM old_book_records WHERE json_extract(payload_json, '$.pdfBlobId') = ?1 LIMIT 1")
            .map_err(|e| format!("prepare PDF payload fallback: {}", e))?;
        let mut fallback_rows = fallback_stmt
            .query(params![pdf_blob_id])
            .map_err(|e| format!("query PDF payload fallback: {}", e))?;
        let Some(fallback_row) = fallback_rows
            .next()
            .map_err(|e| format!("read PDF payload fallback row: {}", e))?
        else {
            return Ok(None);
        };
        let payload_json: String = fallback_row
            .get(0)
            .map_err(|e| format!("read PDF payload json: {}", e))?;
        let payload: Value = serde_json::from_str(&payload_json)
            .map_err(|e| format!("parse PDF payload json: {}", e))?;
        let file_path = json_string_field(&payload, "pdfFilePath");
        if file_path.is_empty() {
            return Ok(None);
        }
        let file_name = json_string_field(&payload, "pdfFileName");
        let bytes = fs::read(&file_path).map_err(|e| format!("read PDF file: {}", e))?;
        return Ok(Some(StoredPdfAsset {
            base64: general_purpose::STANDARD.encode(&bytes),
            file_name: if file_name.is_empty() {
                "original.pdf".into()
            } else {
                file_name
            },
            mime_type: "application/pdf".into(),
            size_bytes: bytes.len() as u64,
            file_path,
        }));
    };

    let file_name: String = row
        .get(0)
        .map_err(|e| format!("read PDF file name: {}", e))?;
    let file_path: String = row.get(1).map_err(|e| format!("read PDF path: {}", e))?;
    let mime_type: String = row
        .get(2)
        .map_err(|e| format!("read PDF MIME type: {}", e))?;
    let size_bytes: i64 = row.get(3).map_err(|e| format!("read PDF size: {}", e))?;
    let bytes = fs::read(&file_path).map_err(|e| format!("read PDF file: {}", e))?;

    Ok(Some(StoredPdfAsset {
        base64: general_purpose::STANDARD.encode(bytes),
        file_name,
        mime_type,
        size_bytes: size_bytes.max(0) as u64,
        file_path,
    }))
}

#[tauri::command]
fn old_book_sqlite_get_file_data_url(file_path: String) -> Result<StoredFileAsset, String> {
    let path = PathBuf::from(&file_path);
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let mime_type = match extension.as_str() {
        "png" => "image/png",
        "webp" => "image/webp",
        _ => "image/jpeg",
    };
    let bytes = fs::read(&path).map_err(|e| format!("read asset file: {}", e))?;

    Ok(StoredFileAsset {
        data_url: format!(
            "data:{};base64,{}",
            mime_type,
            general_purpose::STANDARD.encode(bytes)
        ),
    })
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
        let n = resp
            .read(&mut buffer)
            .map_err(|e| format!("read chunk: {}", e))?;
        if n == 0 {
            break;
        }
        file.write_all(&buffer[..n])
            .map_err(|e| format!("write: {}", e))?;
        downloaded += n as u64;
        // emit progress to frontend
        let payload =
            serde_json::json!({"model_id": info.id, "downloaded": downloaded, "total": total});
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
                        return Err(format!(
                            "inference failed: {}",
                            String::from_utf8_lossy(&out.stderr)
                        ));
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
    if file_name.contains('/') || file_name.contains('\\') || file_name == "." || file_name == ".."
    {
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
fn suggest_outline_topics(
    endpoint: String,
    model: String,
    prompt: String,
) -> Result<String, String> {
    let url = router_chat_url(&endpoint)?;
    let model_name = if model.trim().is_empty() {
        "default"
    } else {
        model.trim()
    };
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

    if response.status() == reqwest::StatusCode::BAD_REQUEST
        || response.status() == reqwest::StatusCode::UNPROCESSABLE_ENTITY
    {
        response = client
            .post(&url)
            .json(&base_payload)
            .send()
            .map_err(|e| format!("router request: {}", e))?;
    }

    let status = response.status();
    let body = response
        .text()
        .map_err(|e| format!("router response read: {}", e))?;
    if !status.is_success() {
        return Err(format!("router request failed: {} {}", status, body));
    }

    let parsed: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| format!("router response json: {}", e))?;
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
