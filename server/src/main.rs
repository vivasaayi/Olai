mod store;

use axum::{
    body::Bytes,
    extract::{DefaultBodyLimit, Path, State},
    http::{header, HeaderMap, Method, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, patch},
    Json, Router,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::{env, path::PathBuf, time::Duration};
use store::Store;
use tower_http::services::{ServeDir, ServeFile};

#[derive(Clone)]
struct AppState {
    store: Store,
    client: reqwest::Client,
    llm_url: String,
}

#[derive(Debug)]
pub struct ApiError(StatusCode, String);
impl std::fmt::Display for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.1)
    }
}
impl std::error::Error for ApiError {}
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({"error": self.1}))).into_response()
    }
}
impl From<rusqlite::Error> for ApiError {
    fn from(error: rusqlite::Error) -> Self {
        eprintln!("database: {error}");
        Self(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Database operation failed".into(),
        )
    }
}
impl From<serde_json::Error> for ApiError {
    fn from(error: serde_json::Error) -> Self {
        Self(StatusCode::BAD_REQUEST, error.to_string())
    }
}
fn invalid(message: &str) -> ApiError {
    ApiError(StatusCode::BAD_REQUEST, message.into())
}
fn required<'a>(value: &'a Value, key: &str) -> Result<&'a str, ApiError> {
    value[key]
        .as_str()
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| invalid(&format!("{key} is required")))
}
fn validate_kind(kind: &str) -> Result<(), ApiError> {
    if matches!(kind, "books" | "translations") {
        Ok(())
    } else {
        Err(ApiError(StatusCode::NOT_FOUND, "Unknown collection".into()))
    }
}

fn app(state: AppState, web: &str) -> Router {
    let api = Router::new()
        .route("/{kind}", get(list_records))
        .route("/{kind}/{id}", get(get_record).put(save_record).delete(delete_record))
        .route("/translations/{id}/position", patch(save_position))
        .route("/assets/{id}", get(get_asset).put(save_asset))
        .route("/exports", get(list_all_exports))
        .route("/exports/{id}", get(list_exports))
        .route("/exports/{id}/{name}", get(get_export).put(save_export))
        .route("/llm-router/v1/models", get(llm_models))
        .route("/llm-router/v1/chat/completions", axum::routing::post(llm_chat))
        .fallback(|| async { ApiError(StatusCode::NOT_FOUND, "API route not found".into()) })
        .layer(DefaultBodyLimit::max(128 * 1024 * 1024));
    Router::new()
        .route("/health", get(health))
        .nest("/api", api)
        .fallback_service(ServeDir::new(web).not_found_service(ServeFile::new(format!("{web}/index.html"))))
        .with_state(state)
}

async fn health(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    state
        .store
        .run(|db| {
            db.query_row("SELECT 1", [], |_| Ok(()))?;
            Ok(())
        })
        .await?;
    Ok(Json(
        json!({"status":"ok", "service":"olai", "schemaVersion":1, "revision":env!("CARGO_PKG_VERSION"), "commit":option_env!("OLAI_BUILD_COMMIT").unwrap_or("development")}),
    ))
}
async fn list_records(
    State(state): State<AppState>,
    Path(kind): Path<String>,
) -> Result<Json<Vec<Value>>, ApiError> {
    validate_kind(&kind)?;
    Ok(Json(state.store.list(kind).await?))
}
async fn get_record(
    State(state): State<AppState>,
    Path((kind, id)): Path<(String, String)>,
) -> Result<Json<Value>, ApiError> {
    validate_kind(&kind)?;
    Ok(Json(state.store.get(kind, id).await?))
}
async fn save_record(
    State(state): State<AppState>,
    Path((kind, id)): Path<(String, String)>,
    Json(value): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    validate_kind(&kind)?;
    if required(&value, "id")? != id {
        return Err(invalid("Book ID must match the URL"));
    }
    required(&value, "title")?;
    Ok(Json(state.store.save(kind, id, value).await?))
}
async fn delete_record(
    State(state): State<AppState>,
    Path((kind, id)): Path<(String, String)>,
    headers: HeaderMap,
) -> Result<StatusCode, ApiError> {
    validate_kind(&kind)?;
    let revision = headers
        .get(header::IF_MATCH)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<i64>().ok())
        .ok_or_else(|| invalid("If-Match revision is required"))?;
    state.store.delete(kind, id, revision).await?;
    Ok(StatusCode::NO_CONTENT)
}
async fn save_position(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(value): Json<Value>,
) -> Result<StatusCode, ApiError> {
    let page = value["pageNumber"]
        .as_u64()
        .filter(|n| *n > 0)
        .ok_or_else(|| invalid("Positive pageNumber is required"))?;
    state.store.run(move |db| {
        let changed = db.execute("UPDATE records SET payload=json_set(payload, '$.pageNumber', ?1) WHERE kind='translations' AND id=?2", rusqlite::params![page, id])?;
        if changed == 0 { return Err(ApiError(StatusCode::NOT_FOUND, "Book not found".into())); }
        Ok(())
    }).await?;
    Ok(StatusCode::NO_CONTENT)
}
async fn save_asset(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(value): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let book_id = required(&value, "bookId")?.to_string();
    let name = required(&value, "fileName")?.to_string();
    let mime = required(&value, "mimeType")?.to_string();
    if !matches!(
        mime.as_str(),
        "application/pdf" | "image/jpeg" | "image/png" | "image/webp"
    ) {
        return Err(invalid("Unsupported asset type"));
    }
    let data = STANDARD
        .decode(required(&value, "base64")?)
        .map_err(|_| invalid("Invalid base64 asset"))?;
    state
        .store
        .asset_save(id.clone(), book_id, name, mime, data)
        .await?;
    Ok(Json(json!({"url":format!("/api/assets/{id}")})))
}
async fn get_asset(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Response, ApiError> {
    let (mime, bytes) = state.store.asset(id).await?;
    Ok((
        [
            (header::CONTENT_TYPE, mime),
            (header::CACHE_CONTROL, "private, no-cache".into()),
        ],
        bytes,
    )
        .into_response())
}
async fn save_export(
    State(state): State<AppState>,
    Path((id, name)): Path<(String, String)>,
    body: Bytes,
) -> Result<Json<Value>, ApiError> {
    if !name.ends_with(".html") || name.contains(['/', '\\']) {
        return Err(invalid("An HTML file name is required"));
    }
    let url = format!("/api/exports/{}/{}", id, name);
    state.store.export_save(id, name, body.to_vec()).await?;
    Ok(Json(json!({"url":url})))
}
async fn get_export(
    State(state): State<AppState>,
    Path((id, name)): Path<(String, String)>,
) -> Result<Response, ApiError> {
    let bytes = state
        .store
        .run(move |db| {
            db.query_row(
                "SELECT data FROM exports WHERE book_id=?1 AND name=?2",
                rusqlite::params![id, name],
                |row| row.get::<_, Vec<u8>>(0),
            )
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => {
                    ApiError(StatusCode::NOT_FOUND, "Export not found".into())
                }
                other => other.into(),
            })
        })
        .await?;
    Ok((
        [
            (header::CONTENT_TYPE, "text/html; charset=utf-8"),
            (header::CONTENT_SECURITY_POLICY, "sandbox allow-scripts"),
        ],
        bytes,
    )
        .into_response())
}
async fn list_all_exports(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    exports(state, None).await
}
async fn list_exports(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    exports(state, Some(id)).await
}
async fn exports(state: AppState, id: Option<String>) -> Result<Json<Value>, ApiError> {
    let files = state.store.run(move |db| {
        let mut stmt = db.prepare("SELECT book_id,name,length(data),updated_at FROM exports WHERE (?1 IS NULL OR book_id=?1) ORDER BY updated_at DESC")?;
        let rows = stmt.query_map([id], |row| {
            let book: String = row.get(0)?;
            let name: String = row.get(1)?;
            Ok(json!({"bookId":book,"fileName":name,"sizeBytes":row.get::<_,i64>(2)?,"updatedAt":row.get::<_,String>(3)?,"url":format!("/api/exports/{book}/{name}")}))
        })?;
        Ok(rows.collect::<Result<Vec<_>,_>>()?)
    }).await?;
    Ok(Json(json!({"files":files})))
}
async fn llm_models(State(state): State<AppState>) -> Result<Response, ApiError> {
    proxy_llm(state, Method::GET, "models", None).await
}
async fn llm_chat(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> Result<Response, ApiError> {
    proxy_llm(state, Method::POST, "chat/completions", Some(body)).await
}
async fn proxy_llm(
    state: AppState,
    method: Method,
    path: &str,
    body: Option<Value>,
) -> Result<Response, ApiError> {
    let mut request = state.client.request(
        method,
        format!("{}/{}", state.llm_url.trim_end_matches('/'), path),
    );
    if let Some(body) = body {
        request = request.json(&body);
    }
    let response = request.send().await.map_err(|e| {
        eprintln!("LLM router: {e}");
        ApiError(
            StatusCode::BAD_GATEWAY,
            "Could not reach the configured LLM router".into(),
        )
    })?;
    let status = response.status();
    let bytes = response.bytes().await.map_err(|_| {
        ApiError(
            StatusCode::BAD_GATEWAY,
            "Could not read the LLM response".into(),
        )
    })?;
    Ok((status, [(header::CONTENT_TYPE, "application/json")], bytes).into_response())
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = env::args().collect();
    if args.get(1).map(String::as_str) == Some("check-health") {
        reqwest::get("http://127.0.0.1:8080/health")
            .await?
            .error_for_status()?;
        return Ok(());
    }
    let data_dir = PathBuf::from(env::var("OLAI_DATA_DIR").unwrap_or_else(|_| "./data".into()));
    let store = Store::open(data_dir)?;
    match args.get(1).map(String::as_str) {
        Some("migrate") => {
            println!("Schema 1 ready");
            return Ok(());
        }
        Some("seed-demo") => {
            store.seed().await?;
            println!("Sample books ready");
            return Ok(());
        }
        Some("import-desktop") => {
            let source = args
                .get(2)
                .ok_or("Usage: olai-server import-desktop /path/to/bookforge")?;
            store.import_desktop(PathBuf::from(source)).await?;
            println!("Desktop books and assets imported");
            return Ok(());
        }
        Some(other) => return Err(format!("Unknown command {other}").into()),
        None => {}
    }
    let state = AppState {
        store,
        client: reqwest::Client::builder()
            .timeout(Duration::from_secs(600))
            .build()?,
        llm_url: env::var("OLAI_LLM_URL").unwrap_or_else(|_| "http://127.0.0.1:1235/v1".into()),
    };
    let address = env::var("OLAI_BIND").unwrap_or_else(|_| "127.0.0.1:8080".into());
    let web = env::var("OLAI_WEB_DIR").unwrap_or_else(|_| "web/dist".into());
    let listener = tokio::net::TcpListener::bind(&address).await?;
    println!("Olai listening on {}", listener.local_addr()?);
    axum::serve(listener, app(state, &web))
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::{to_bytes, Body},
        http::Request,
    };
    use tower::ServiceExt;

    fn fixture() -> (tempfile::TempDir, AppState) {
        let temp = tempfile::tempdir().unwrap();
        let store = Store::open(temp.path().to_path_buf()).unwrap();
        let state = AppState {
            store,
            client: reqwest::Client::new(),
            llm_url: "http://127.0.0.1:1/v1".into(),
        };
        (temp, state)
    }
    #[tokio::test]
    async fn conflicting_sessions_cannot_overwrite_each_other() {
        let (_temp, state) = fixture();
        let value = json!({"id":"book","title":"Original"});
        let saved = state
            .store
            .save("books".into(), "book".into(), value)
            .await
            .unwrap();
        let mut left = saved.clone();
        left["title"] = json!("Left edit");
        let mut right = saved;
        right["title"] = json!("Right edit");
        let store = state.store.clone();
        let (a, b) = tokio::join!(
            state.store.save("books".into(), "book".into(), left),
            store.save("books".into(), "book".into(), right)
        );
        assert_ne!(a.is_ok(), b.is_ok());
        assert_eq!(a.err().or_else(|| b.err()).unwrap().0, StatusCode::CONFLICT);
    }
    #[tokio::test]
    async fn revision_survives_restart_and_stale_delete_is_rejected() {
        let (temp, state) = fixture();
        state
            .store
            .save(
                "books".into(),
                "book".into(),
                json!({"id":"book","title":"Saved"}),
            )
            .await
            .unwrap();
        let reopened = Store::open(temp.path().to_path_buf()).unwrap();
        assert_eq!(
            reopened.get("books".into(), "book".into()).await.unwrap()["_revision"],
            1
        );
        assert_eq!(
            reopened
                .delete("books".into(), "book".into(), 0)
                .await
                .unwrap_err()
                .0,
            StatusCode::CONFLICT
        );
        reopened
            .delete("books".into(), "book".into(), 1)
            .await
            .unwrap();
    }
    #[tokio::test]
    async fn asset_bytes_are_shared_across_sessions() {
        let (_temp, state) = fixture();
        state
            .store
            .asset_save(
                "pdf".into(),
                "book".into(),
                "source.pdf".into(),
                "application/pdf".into(),
                b"%PDF-test".to_vec(),
            )
            .await
            .unwrap();
        let response = app(state, "/missing")
            .oneshot(
                Request::builder()
                    .uri("/api/assets/pdf")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[header::CONTENT_TYPE], "application/pdf");
        assert_eq!(
            to_bytes(response.into_body(), 1024).await.unwrap(),
            &b"%PDF-test"[..]
        );
    }
    #[tokio::test]
    async fn invalid_routes_and_bad_ids_do_not_save_records() {
        let (_temp, state) = fixture();
        let router = app(state, "/missing");
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/unknown")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        let response = router
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri("/api/books/a")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(r#"{"id":"b","title":"Wrong ID"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }
    #[tokio::test]
    async fn desktop_import_is_retryable_and_preserves_variants_and_assets() {
        let (_temp, state) = fixture();
        let desktop = tempfile::tempdir().unwrap();
        std::fs::create_dir(desktop.path().join("books")).unwrap();
        let source = desktop.path().join("original.pdf");
        std::fs::write(&source, b"%PDF-legacy").unwrap();
        let legacy = rusqlite::Connection::open(desktop.path().join("library.sqlite")).unwrap();
        legacy.execute_batch("CREATE TABLE old_book_records(payload_json TEXT); CREATE TABLE old_book_pdf_assets(id TEXT,file_path TEXT);").unwrap();
        let book = json!({"id":"legacy","title":"Legacy","pdfBlobId":"legacy-pdf","pdfFilePath":source.to_str(),"translations":[{"language":"ta","paragraphs":["தமிழ்"],"model":"a"},{"language":"ta","paragraphs":["தமிழ்"],"model":"b"}],"pageSnapshots":[]});
        legacy
            .execute(
                "INSERT INTO old_book_records VALUES(?1)",
                [book.to_string()],
            )
            .unwrap();
        state
            .store
            .import_desktop(desktop.path().to_path_buf())
            .await
            .unwrap();
        state
            .store
            .import_desktop(desktop.path().to_path_buf())
            .await
            .unwrap();
        let books = state.store.list("translations".into()).await.unwrap();
        assert_eq!(books.len(), 1);
        assert_eq!(books[0]["translations"].as_array().unwrap().len(), 2);
        assert_eq!(
            state.store.asset("legacy-pdf".into()).await.unwrap().1,
            b"%PDF-legacy"
        );
    }
}

#[cfg(test)]
mod proxy_tests {
    use super::*;
    use axum::{
        body::{to_bytes, Body},
        http::Request,
    };
    use tower::ServiceExt;

    #[tokio::test]
    async fn proxy_uses_configured_provider_and_preserves_response_status() {
        let provider = Router::new()
            .route(
                "/v1/models",
                get(|| async { Json(json!({"data":[{"id":"fixture-model"}]})) }),
            )
            .route(
                "/v1/chat/completions",
                axum::routing::post(|Json(body): Json<Value>| async move {
                    (
                        StatusCode::TOO_MANY_REQUESTS,
                        Json(json!({"error":"retry later","model":body["model"]})),
                    )
                }),
            );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let task = tokio::spawn(async move { axum::serve(listener, provider).await.unwrap() });
        let temp = tempfile::tempdir().unwrap();
        let state = AppState {
            store: Store::open(temp.path().into()).unwrap(),
            client: reqwest::Client::new(),
            llm_url: format!("http://{address}/v1"),
        };
        let router = app(state, "/missing");
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/llm-router/v1/models")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert!(
            String::from_utf8(to_bytes(response.into_body(), 4096).await.unwrap().to_vec())
                .unwrap()
                .contains("fixture-model")
        );
        let response = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/llm-router/v1/chat/completions")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(r#"{"model":"fixture-model","messages":[]}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
        task.abort();
    }
}
