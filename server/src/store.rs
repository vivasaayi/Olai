use crate::{invalid, ApiError};
use axum::http::StatusCode;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};

#[derive(Clone)]
pub struct Store {
    path: PathBuf,
}

impl Store {
    pub fn open(directory: PathBuf) -> Result<Self, Box<dyn std::error::Error>> {
        fs::create_dir_all(&directory)?;
        let store = Self {
            path: directory.join("library.sqlite"),
        };
        let db = store.connect()?;
        db.execute_batch(
            "PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS records (
                kind TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL,
                revision INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(kind,id));
            CREATE TABLE IF NOT EXISTS assets (
                id TEXT PRIMARY KEY, book_id TEXT NOT NULL, name TEXT NOT NULL,
                mime TEXT NOT NULL, data BLOB NOT NULL);
            CREATE TABLE IF NOT EXISTS exports (
                book_id TEXT NOT NULL, name TEXT NOT NULL, data BLOB NOT NULL,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(book_id,name));
            CREATE TABLE IF NOT EXISTS web_schema_migrations (
                version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
            INSERT OR IGNORE INTO web_schema_migrations(version) VALUES(1);",
        )?;
        Ok(store)
    }
    pub fn backup(source: &Path, destination: &Path) -> Result<(), Box<dyn std::error::Error>> {
        if let Some(parent) = destination.parent().filter(|path| !path.as_os_str().is_empty()) {
            fs::create_dir_all(parent)?;
        }
        let db = Connection::open_with_flags(source, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        let file = fs::OpenOptions::new().write(true).create_new(true).open(destination)?;
        drop(file);
        db.backup(rusqlite::DatabaseName::Main, destination, None)?;
        Ok(())
    }

    fn connect(&self) -> Result<Connection, rusqlite::Error> {
        let db = Connection::open(&self.path)?;
        db.busy_timeout(Duration::from_secs(10))?;
        Ok(db)
    }
    pub async fn run<T: Send + 'static>(
        &self,
        action: impl FnOnce(&mut Connection) -> Result<T, ApiError> + Send + 'static,
    ) -> Result<T, ApiError> {
        let store = self.clone();
        tokio::task::spawn_blocking(move || action(&mut store.connect()?))
            .await
            .map_err(|e| {
                eprintln!("database task: {e}");
                ApiError(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Database task failed".into(),
                )
            })?
    }
    pub async fn list(&self, kind: String) -> Result<Vec<Value>, ApiError> {
        self.run(move |db| {
            let mut statement = db.prepare(
                "SELECT payload, revision FROM records WHERE kind=?1
                 ORDER BY json_extract(payload, '$.updatedAt') DESC",
            )?;
            let rows = statement.query_map([kind], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })?;
            let mut books = Vec::new();
            for row in rows {
                let (text, revision) = row?;
                let mut value: Value = serde_json::from_str(&text)?;
                value["_revision"] = json!(revision);
                books.push(value);
            }
            Ok(books)
        }).await
    }
    pub async fn get(&self, kind: String, id: String) -> Result<Value, ApiError> {
        self.run(move |db| {
            let row: Option<(String, i64)> = db
                .query_row(
                    "SELECT payload,revision FROM records WHERE kind=?1 AND id=?2",
                    params![kind, id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()?;
            let (text, revision) =
                row.ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "Book not found".into()))?;
            let mut value: Value = serde_json::from_str(&text)?;
            value["_revision"] = json!(revision);
            Ok(value)
        })
        .await
    }
    pub async fn save(
        &self,
        kind: String,
        id: String,
        mut value: Value,
    ) -> Result<Value, ApiError> {
        if !value.is_object() {
            return Err(invalid("Book must be an object"));
        }
        self.run(move |db| {
            let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
            let current: Option<i64> = tx.query_row(
                "SELECT revision FROM records WHERE kind=?1 AND id=?2",
                params![kind, id],
                |row| row.get(0),
            ).optional()?;
            let expected = value["_revision"].as_i64().unwrap_or(0);
            if current.unwrap_or(0) != expected {
                return Err(ApiError(
                    StatusCode::CONFLICT,
                    "This book changed in another session. Reload it before saving your changes.".into(),
                ));
            }
            let revision = expected + 1;
            value["_revision"] = json!(revision);
            tx.execute(
                "INSERT INTO records(kind,id,payload,revision) VALUES(?1,?2,?3,?4)
                 ON CONFLICT(kind,id) DO UPDATE SET
                 payload=excluded.payload, revision=excluded.revision",
                params![kind, id, value.to_string(), revision],
            )?;
            tx.commit()?;
            Ok(value)
        }).await
    }
    pub async fn delete(&self, kind: String, id: String, revision: i64) -> Result<(), ApiError> {
        self.run(move |db| {
            let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
            let changed = tx.execute(
                "DELETE FROM records WHERE kind=?1 AND id=?2 AND revision=?3",
                params![kind, id, revision],
            )?;
            if changed == 0 {
                return Err(ApiError(
                    StatusCode::CONFLICT,
                    "Book changed or was deleted. Reload the library.".into(),
                ));
            }
            // Asset ownership belongs to translation records, even when authoring uses the same ID.
            if kind == "translations" {
                tx.execute("DELETE FROM assets WHERE book_id=?1", [&id])?;
                tx.execute("DELETE FROM exports WHERE book_id=?1", [&id])?;
            }
            tx.commit()?;
            Ok(())
        })
        .await
    }
    pub async fn asset_save(
        &self,
        id: String,
        book_id: String,
        name: String,
        mime: String,
        bytes: Vec<u8>,
    ) -> Result<(), ApiError> {
        self.run(move |db| {
            let changed = db.execute(
                "INSERT INTO assets(id,book_id,name,mime,data) VALUES(?1,?2,?3,?4,?5)
                 ON CONFLICT(id) DO UPDATE SET
                 name=excluded.name, mime=excluded.mime, data=excluded.data
                 WHERE assets.book_id=excluded.book_id",
                params![id, book_id, name, mime, bytes],
            )?;
            if changed == 0 {
                return Err(invalid("Asset belongs to another book"));
            }
            Ok(())
        }).await
    }
    pub async fn asset(&self, id: String) -> Result<(String, Vec<u8>), ApiError> {
        self.run(move |db| {
            db.query_row("SELECT mime,data FROM assets WHERE id=?1", [id], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .optional()?
            .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "Asset not found".into()))
        })
        .await
    }
    pub async fn export_save(
        &self,
        id: String,
        name: String,
        bytes: Vec<u8>,
    ) -> Result<(), ApiError> {
        self.run(move |db| {
            db.execute(
                "INSERT INTO exports(book_id,name,data) VALUES(?1,?2,?3)
                 ON CONFLICT(book_id,name) DO UPDATE SET
                 data=excluded.data, updated_at=CURRENT_TIMESTAMP",
                params![id, name, bytes],
            )?;
            Ok(())
        }).await
    }
    pub async fn seed(&self) -> Result<(), ApiError> {
        self.run(|db| {
            let sample = json!({"id":"sample-authoring","title":"Sample — Learning about light","synopsis":"Disposable development sample","audience":"Beginner","tone":"Clear","tags":["sample"],"outline":[{"id":"sample-chapter","type":"chapter","title":"What is light?","intent":"Introduce light","summary":"An introduction","content":"Light carries energy.","keywords":["light"],"persona":"beginner","resources":[],"children":[]}],"createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z"});
            db.execute("INSERT OR IGNORE INTO records(kind,id,payload) VALUES('books','sample-authoring',?1)",[sample.to_string()])?;
            Ok(())
        }).await
    }
    pub async fn import_desktop(&self, source: PathBuf) -> Result<(), ApiError> {
        self.run(move |db| {
            if !source.is_dir() || (!source.join("library.sqlite").is_file() && !source.join("books").is_dir()) {
                return Err(invalid("Choose the desktop bookforge directory containing library.sqlite or books"));
            }
            let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
            let source_db = source.join("library.sqlite");
            if source_db.is_file() {
                let legacy = Connection::open_with_flags(source_db, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
                let mut stmt = legacy.prepare("SELECT payload_json FROM old_book_records")?;
                let rows = stmt.query_map([], |row| row.get::<_,String>(0))?;
                for row in rows {
                    let mut book: Value = serde_json::from_str(&row?)?;
                    let id = crate::required(&book,"id")?.to_string();
                    let existing: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM records WHERE kind='translations' AND id=?1)",[&id],|r| r.get(0))?;
                    if existing { continue; }
                    if let Some(snapshots) = book["pageSnapshots"].as_array_mut() {
                        for snapshot in snapshots {
                            if let Some(path) = snapshot["filePath"].as_str().filter(|p| !p.is_empty()).map(str::to_string) {
                                let bytes = read_legacy_file(&source, &path)?;
                                let asset_id = format!("import-{}", uuid::Uuid::new_v4());
                                let mime = if path.ends_with(".png") {"image/png"} else {"image/jpeg"};
                                tx.execute("INSERT INTO assets(id,book_id,name,mime,data) VALUES(?1,?2,?3,?4,?5)",params![asset_id,id,path,mime,bytes])?;
                                snapshot["filePath"] = json!(format!("/api/assets/{asset_id}"));
                                snapshot["imageDataUrl"] = json!("");
                            }
                        }
                    }
                    let pdf_id = book["pdfBlobId"].as_str().map(str::to_string);
                    if let Some(pdf_id) = pdf_id {
                        let path: Option<String> = legacy.query_row("SELECT file_path FROM old_book_pdf_assets WHERE id=?1",[&pdf_id],|r| r.get(0)).optional()?;
                        let path = path.or_else(|| book["pdfFilePath"].as_str().map(str::to_string)).ok_or_else(|| invalid("Missing legacy PDF path"))?;
                        let bytes = read_legacy_file(&source,&path)?;
                        tx.execute("INSERT INTO assets(id,book_id,name,mime,data) VALUES(?1,?2,'original.pdf','application/pdf',?3)",params![pdf_id,id,bytes])?;
                        book["pdfFilePath"] = json!(format!("/api/assets/{pdf_id}"));
                    }
                    tx.execute("INSERT INTO records(kind,id,payload) VALUES('translations',?1,?2)",params![id,book.to_string()])?;
                }
            }
            let books = source.join("books");
            if books.is_dir() {
                for entry in fs::read_dir(books).map_err(|e| invalid(&e.to_string()))? {
                    let path = entry.map_err(|e| invalid(&e.to_string()))?.path();
                    if path.extension().and_then(|s| s.to_str()) != Some("json") { continue; }
                    let book: Value = serde_json::from_slice(&fs::read(path).map_err(|e| invalid(&e.to_string()))?)?;
                    let id = crate::required(&book,"id")?;
                    tx.execute("INSERT OR IGNORE INTO records(kind,id,payload) VALUES('books',?1,?2)",params![id,book.to_string()])?;
                }
            }
            tx.commit()?;
            Ok(())
        }).await
    }
}
fn read_legacy_file(source: &Path, stored_path: &str) -> Result<Vec<u8>, ApiError> {
    // Desktop records may have been copied from another computer. Resolve their book-relative path locally.
    let direct = PathBuf::from(stored_path);
    let relative = stored_path
        .split_once("/bookforge/")
        .map(|(_, suffix)| source.join(suffix));
    let path = relative.filter(|p| p.is_file()).unwrap_or(direct);
    fs::read(&path).map_err(|e| invalid(&format!("Cannot import {}: {e}", path.display())))
}
