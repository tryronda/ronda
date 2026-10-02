use notify::Watcher;
use ronda_core::bookmarks::{
    BookmarkBackup, BookmarkImport, BookmarkReplacement, BookmarkView, MessageBookmark,
};
use ronda_core::{
    intel::report::{ErrorHistory, Intelligence},
    projects::ProjectOverview,
    related::SessionRelationships,
    scanner::{Location, ScanReport, Scanner},
    GroupedSearch, Insights, LibraryOptions, ProjectInfo, SearchHit, SearchMatches, SearchSort,
    SessionMeta, SessionPage, SessionQuery, Store, TranscriptMessage,
};
use serde::Serialize;
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, Mutex},
};
use tauri::{Emitter, Manager, State};

mod resume;
mod terminal;
#[cfg(target_os = "macos")]
mod traffic_lights;

struct AppState {
    store: Mutex<Store>,
    scan_gate: Mutex<()>,
    scanner: Scanner,
}

type Shared = Arc<AppState>;
type CommandResult<T> = Result<T, String>;

fn error(e: impl std::fmt::Display) -> String {
    e.to_string()
}

fn scan_local(state: &Shared, force: bool) -> CommandResult<ScanReport> {
    let _gate = state.scan_gate.lock().map_err(error)?;
    let mut store = Store::open(&Store::default_path()).map_err(error)?;
    state.scanner.scan(&mut store, force).map_err(error)
}

/// Runs a store read on the blocking pool. Plain `#[tauri::command] fn`s execute on the
/// main thread, so a slow query there freezes the whole window while it runs.
async fn off_main<T: Send + 'static>(
    state: State<'_, Shared>,
    work: impl FnOnce(&AppState) -> CommandResult<T> + Send + 'static,
) -> CommandResult<T> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || work(&state))
        .await
        .map_err(error)?
}

/// Default window size from tauri.conf.json; a restored size below it opens cramped.
const DEFAULT_WINDOW: (f64, f64) = (1180.0, 760.0);

/// Restores the saved window state, except a saved size smaller than the default: that
/// opens the window cramped, so it starts at the default size, centered, instead.
/// The check reads the state file because `restore_state` applies sizes asynchronously.
fn restore_main_window(window: &tauri::WebviewWindow) {
    use tauri_plugin_window_state::{AppHandleExt, StateFlags, WindowExt};
    let saved = window
        .path()
        .app_config_dir()
        .ok()
        .and_then(|dir| std::fs::read_to_string(dir.join(window.app_handle().filename())).ok())
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .and_then(|state| {
            let main = state.get(window.label())?;
            Some((main.get("width")?.as_f64()?, main.get("height")?.as_f64()?))
        });
    // The plugin stores physical pixels; compare in logical ones.
    let scale = window.scale_factor().unwrap_or(1.0);
    let roomy = matches!(saved, Some((w, h)) if w / scale >= DEFAULT_WINDOW.0 && h / scale >= DEFAULT_WINDOW.1);
    if roomy || saved.is_none() {
        let _ = window.restore_state(StateFlags::all());
    } else {
        let _ = window.restore_state(StateFlags::all() - StateFlags::SIZE - StateFlags::POSITION);
        let _ = window.set_size(tauri::LogicalSize::new(DEFAULT_WINDOW.0, DEFAULT_WINDOW.1));
        let _ = window.center();
    }
}

#[tauri::command]
async fn library_options(state: State<'_, Shared>) -> CommandResult<LibraryOptions> {
    off_main(state, move |state| {
        state
            .store
            .lock()
            .map_err(error)?
            .library_options()
            .map_err(error)
    })
    .await
}

#[tauri::command]
async fn session_page(
    state: State<'_, Shared>,
    query: SessionQuery,
    offset: usize,
    limit: usize,
) -> CommandResult<SessionPage> {
    off_main(state, move |state| {
        state
            .store
            .lock()
            .map_err(error)?
            .session_page(&query, offset, limit)
            .map_err(error)
    })
    .await
}

#[tauri::command]
async fn list_sessions(
    state: State<'_, Shared>,
    query: SessionQuery,
) -> CommandResult<Vec<SessionMeta>> {
    off_main(state, move |state| {
        let limit = query.limit;
        let mut sessions = state
            .store
            .lock()
            .map_err(error)?
            .list_sessions(&SessionQuery {
                limit: None,
                ..query
            })
            .map_err(error)?;
        sessions.retain(|session| session.parent_key.is_none());
        if let Some(limit) = limit {
            sessions.truncate(limit);
        }
        Ok(sessions)
    })
    .await
}

#[tauri::command]
async fn get_session(state: State<'_, Shared>, key: String) -> CommandResult<Option<SessionMeta>> {
    off_main(state, move |state| {
        state
            .store
            .lock()
            .map_err(error)?
            .get_session(&key)
            .map_err(error)
    })
    .await
}

#[tauri::command]
async fn get_transcript(
    state: State<'_, Shared>,
    key: String,
) -> CommandResult<Vec<TranscriptMessage>> {
    off_main(state, move |state| {
        state
            .store
            .lock()
            .map_err(error)?
            .get_transcript(&key)
            .map_err(error)
    })
    .await
}

#[tauri::command]
async fn search_sessions(
    state: State<'_, Shared>,
    query: String,
    filter: SessionQuery,
    limit: usize,
) -> CommandResult<Vec<SearchHit>> {
    off_main(state, move |state| {
        state
            .store
            .lock()
            .map_err(error)?
            .search(&query, &filter, limit.min(100))
            .map_err(error)
    })
    .await
}

#[tauri::command]
async fn search_grouped(
    state: State<'_, Shared>,
    query: String,
    filter: SessionQuery,
    sort: SearchSort,
    offset: usize,
    limit: usize,
) -> CommandResult<GroupedSearch> {
    off_main(state, move |state| {
        state
            .store
            .lock()
            .map_err(error)?
            .search_grouped(&query, &filter, sort, offset, limit)
            .map_err(error)
    })
    .await
}

#[tauri::command]
async fn search_session_matches(
    state: State<'_, Shared>,
    query: String,
    filter: SessionQuery,
    key: String,
    offset: usize,
    limit: usize,
) -> CommandResult<SearchMatches> {
    off_main(state, move |state| {
        state
            .store
            .lock()
            .map_err(error)?
            .search_session_matches(&query, &filter, &key, offset, limit)
            .map_err(error)
    })
    .await
}

#[tauri::command]
async fn list_projects(state: State<'_, Shared>) -> CommandResult<Vec<ProjectInfo>> {
    off_main(state, |state| {
        state.store.lock().map_err(error)?.projects().map_err(error)
    })
    .await
}

#[tauri::command]
async fn get_insights(state: State<'_, Shared>) -> CommandResult<Insights> {
    off_main(state, |state| {
        state.store.lock().map_err(error)?.insights().map_err(error)
    })
    .await
}

#[tauri::command]
async fn get_intelligence(
    state: State<'_, Shared>,
    since: Option<i64>,
    project: Option<String>,
    host: Option<String>,
    local_only: Option<bool>,
) -> CommandResult<Intelligence> {
    off_main(state, move |state| {
        state
            .store
            .lock()
            .map_err(error)?
            .intelligence_scoped(
                since,
                project.as_deref(),
                host.as_deref(),
                local_only.unwrap_or(false),
            )
            .map_err(error)
    })
    .await
}

#[tauri::command]
async fn get_session_relationships(
    state: State<'_, Shared>,
    key: String,
) -> CommandResult<SessionRelationships> {
    off_main(state, move |state| {
        state
            .store
            .lock()
            .map_err(error)?
            .session_relationships(&key)
            .map_err(error)
    })
    .await
}

#[tauri::command]
async fn find_error_history(
    state: State<'_, Shared>,
    text: String,
    project: Option<String>,
    host: Option<String>,
    local_only: bool,
    offset: usize,
) -> CommandResult<ErrorHistory> {
    off_main(state, move |state| {
        state
            .store
            .lock()
            .map_err(error)?
            .error_history(
                &text,
                project.as_deref(),
                host.as_deref(),
                local_only,
                offset,
            )
            .map_err(error)
    })
    .await
}

#[tauri::command]
async fn get_project_overview(
    state: State<'_, Shared>,
    project: String,
    host: Option<String>,
    local_only: bool,
) -> CommandResult<ProjectOverview> {
    off_main(state, move |state| {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(error)?
            .as_millis() as i64;
        state
            .store
            .lock()
            .map_err(error)?
            .project_overview(&project, host.as_deref(), local_only, now)
            .map_err(error)
    })
    .await
}

#[tauri::command]
async fn list_locations(state: State<'_, Shared>) -> CommandResult<Vec<Location>> {
    off_main(state, |state| {
        let store = state.store.lock().map_err(error)?;
        state.scanner.locations(&store).map_err(error)
    })
    .await
}

#[tauri::command]
async fn scan(app: tauri::AppHandle, state: State<'_, Shared>) -> CommandResult<ScanReport> {
    let state = state.inner().clone();
    let report = tauri::async_runtime::spawn_blocking(move || {
        let report = scan_local(&state, true)?;
        let hosts = state
            .store
            .lock()
            .map_err(error)?
            .remote_hosts()
            .map_err(error)?;
        for (host, enabled, _, _) in hosts {
            if enabled {
                let _ = sync_host(&state, &host);
            }
        }
        Ok::<_, String>(report)
    })
    .await
    .map_err(error)??;
    app.emit("library-changed", &report).map_err(error)?;
    Ok(report)
}

#[tauri::command]
async fn set_session_flags(
    state: State<'_, Shared>,
    key: String,
    starred: bool,
    pinned: bool,
) -> CommandResult<()> {
    off_main(state, move |state| {
        state
            .store
            .lock()
            .map_err(error)?
            .set_flags(&key, starred, pinned)
            .map_err(error)
    })
    .await
}

#[tauri::command]
async fn list_bookmarks(
    state: State<'_, Shared>,
    query: String,
    filter: SessionQuery,
) -> CommandResult<Vec<BookmarkView>> {
    off_main(state, move |state| {
        state
            .store
            .lock()
            .map_err(error)?
            .list_bookmarks(&query, &filter)
            .map_err(error)
    })
    .await
}

#[tauri::command]
async fn save_bookmark(
    state: State<'_, Shared>,
    app: tauri::AppHandle,
    key: String,
    seq: i64,
    note: String,
    refresh_snapshot: bool,
    expected_updated_at: Option<i64>,
) -> CommandResult<MessageBookmark> {
    let bookmark = off_main(state, move |state| {
        state
            .store
            .lock()
            .map_err(error)?
            .save_bookmark(&key, seq, &note, refresh_snapshot, expected_updated_at)
            .map_err(error)
    })
    .await?;
    app.emit("library-changed", ()).map_err(error)?;
    Ok(bookmark)
}

#[tauri::command]
async fn delete_bookmark(
    state: State<'_, Shared>,
    app: tauri::AppHandle,
    key: String,
    seq: i64,
) -> CommandResult<()> {
    off_main(state, move |state| {
        state
            .store
            .lock()
            .map_err(error)?
            .delete_bookmark(&key, seq)
            .map_err(error)
    })
    .await?;
    app.emit("library-changed", ()).map_err(error)
}

#[tauri::command]
async fn get_bookmark_backup(state: State<'_, Shared>) -> CommandResult<String> {
    off_main(state, move |state| {
        serde_json::to_string_pretty(
            &state
                .store
                .lock()
                .map_err(error)?
                .export_bookmarks()
                .map_err(error)?,
        )
        .map_err(error)
    })
    .await
}

fn write_export(destination: &Path, bytes: &[u8]) -> CommandResult<()> {
    use std::io::Write;
    let name = destination
        .file_name()
        .ok_or("Choose an export filename")?
        .to_string_lossy();
    let temporary = destination.with_file_name(format!(
        ".{name}.{}-{}.tmp",
        std::process::id(),
        chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
    ));
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(error)?;
    let result = (|| {
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        std::fs::rename(&temporary, destination)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result.map_err(error)
}

#[tauri::command]
async fn export_context(destination: PathBuf, text: String) -> CommandResult<()> {
    if text.chars().count() > 100_000 {
        return Err("Context exceeds 100,000 characters; reduce the draft".into());
    }
    tauri::async_runtime::spawn_blocking(move || write_export(&destination, text.as_bytes()))
        .await
        .map_err(error)?
}

#[tauri::command]
async fn export_bookmarks(state: State<'_, Shared>, destination: PathBuf) -> CommandResult<()> {
    off_main(state, move |state| {
        let backup = serde_json::to_vec_pretty(
            &state
                .store
                .lock()
                .map_err(error)?
                .export_bookmarks()
                .map_err(error)?,
        )
        .map_err(error)?;
        write_export(&destination, &backup)
    })
    .await
}

#[tauri::command]
async fn read_bookmark_backup(source: PathBuf) -> CommandResult<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let json = std::fs::read_to_string(source).map_err(error)?;
        BookmarkBackup::parse(&json).map_err(error)?;
        Ok(json)
    })
    .await
    .map_err(error)?
}

#[tauri::command]
async fn import_bookmarks(
    state: State<'_, Shared>,
    app: tauri::AppHandle,
    json: String,
    replacements: Vec<BookmarkReplacement>,
) -> CommandResult<BookmarkImport> {
    let result = off_main(state, move |state| {
        let backup = BookmarkBackup::parse(&json).map_err(error)?;
        state
            .store
            .lock()
            .map_err(error)?
            .import_bookmarks(&backup, &replacements)
            .map_err(error)
    })
    .await?;
    app.emit("library-changed", ()).map_err(error)?;
    Ok(result)
}

#[tauri::command]
async fn export_session(
    state: State<'_, Shared>,
    key: String,
    destination: String,
) -> CommandResult<()> {
    off_main(state, move |state| {
        let store = state.store.lock().map_err(error)?;
        let meta = store
            .get_session(&key)
            .map_err(error)?
            .ok_or("unknown session")?;
        let messages = store.get_transcript(&key).map_err(error)?;
        let mut output = format!(
            "# {}\n\nAgent: {}\nProject: {}\n\n",
            meta.title,
            meta.agent.as_str(),
            meta.project_path.as_deref().unwrap_or("Unknown")
        );
        for message in messages {
            output.push_str(&format!(
                "## {:?} · {}\n\n{}\n\n",
                message.role, message.seq, message.text
            ));
            for tool in message.tool_calls {
                output.push_str(&format!("- Tool: {}\n", tool.name));
            }
        }
        std::fs::write(destination, output).map_err(error)
    })
    .await
}

fn within_root(path: &Path, roots: &[PathBuf]) -> bool {
    let Ok(path) = path.canonicalize() else {
        return false;
    };
    roots
        .iter()
        .filter_map(|root| root.canonicalize().ok())
        .any(|root| path.starts_with(root))
}

#[tauri::command]
async fn trash_session(state: State<'_, Shared>, key: String) -> CommandResult<()> {
    off_main(state, move |state| {
        let mut store = state.store.lock().map_err(error)?;
        let meta = store
            .get_session(&key)
            .map_err(error)?
            .ok_or("unknown session")?;
        if meta.host.is_some() || !meta.can_delete {
            return Err("this session cannot be deleted".into());
        }
        let adapter = state
            .scanner
            .adapter(meta.agent)
            .ok_or("unsupported agent")?;
        let roots: Vec<PathBuf> = state
            .scanner
            .locations(&store)
            .map_err(error)?
            .into_iter()
            .filter(|location| location.enabled && location.agent == meta.agent.as_str())
            .map(|location| PathBuf::from(location.path))
            .collect();
        let paths = adapter.owned_paths(&meta);
        if paths.is_empty() || paths.iter().any(|p| !within_root(p, &roots) || !p.exists()) {
            return Err("session path is outside its data source".into());
        }
        for path in paths {
            trash::delete(&path).map_err(error)?;
        }
        store.tombstone(&key).map_err(error)
    })
    .await
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[cfg(target_os = "windows")]
fn powershell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

const REMOTE_PATHS: &[&str] = &[
    ".claude/projects",
    ".codex/sessions",
    ".codex/archived_sessions",
    ".codex/state_5.sqlite",
    ".qoder/projects",
    ".copilot/session-store.db",
    ".cursor/projects",
    "Library/Application Support/Cursor/User/globalStorage/state.vscdb",
    ".local/share/opencode/opencode.db",
    ".local/share/opencode/opencode-next.db",
    ".kiro/sessions/cli",
    ".gemini/tmp",
    ".pi/agent/sessions",
    ".omp/agent/sessions",
    ".grok/sessions",
    ".kimi-code/sessions",
    ".gemini/antigravity-cli/conversation_summaries.db",
    ".dsh/sessions",
    ".hermes/state.db",
    ".hermes/profiles",
    ".openclaw/agents",
    ".codebuddy/projects",
    ".workbuddy/projects",
];

fn remote_cache(host: &str) -> CommandResult<PathBuf> {
    if host.is_empty()
        || host.starts_with('-')
        || !host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "@._-".contains(c))
    {
        return Err("invalid SSH host".into());
    }
    let key = host
        .as_bytes()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>();
    Ok(Store::default_path()
        .parent()
        .ok_or("missing data directory")?
        .join("remotes")
        .join(key)
        .join("home"))
}

fn sync_host(state: &Shared, host: &str) -> CommandResult<ScanReport> {
    let configured = state
        .store
        .lock()
        .map_err(error)?
        .remote_hosts()
        .map_err(error)?;
    if !configured
        .iter()
        .any(|(name, enabled, _, _)| name == host && *enabled)
    {
        return Err("remote host is not enabled".into());
    }
    let home = remote_cache(host)?;
    let probe = format!(
        "for p in {}; do test -e \"$HOME/$p\" && printf '%s\\n' \"$p\"; done",
        REMOTE_PATHS
            .iter()
            .map(|p| shell_quote(p))
            .collect::<Vec<_>>()
            .join(" ")
    );
    let output = Command::new("ssh")
        .args([
            "-o",
            "BatchMode=yes",
            "-o",
            "ConnectTimeout=10",
            host,
            &probe,
        ])
        .output()
        .map_err(error)?;
    if !output.status.success() {
        let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
        state
            .store
            .lock()
            .map_err(error)?
            .record_remote_sync(host, Some(&message))
            .map_err(error)?;
        return Err(format!("SSH failed: {message}"));
    }
    let found = String::from_utf8_lossy(&output.stdout);
    let present: HashSet<&str> = found.lines().filter(|p| REMOTE_PATHS.contains(p)).collect();
    for relative in REMOTE_PATHS.iter().filter(|p| !present.contains(**p)) {
        let stale = home.join(relative);
        if stale.is_dir() {
            std::fs::remove_dir_all(stale).map_err(error)?;
        } else if stale.is_file() {
            std::fs::remove_file(stale).map_err(error)?;
        }
    }
    for relative in present {
        let local_parent = home
            .join(relative)
            .parent()
            .ok_or("invalid remote path")?
            .to_path_buf();
        std::fs::create_dir_all(&local_parent).map_err(error)?;
        let remote = format!("{}:{}", host, shell_quote(relative));
        let status = Command::new("rsync")
            .args(["-a", "--delete", "-e", "ssh -o BatchMode=yes", &remote])
            .arg(&local_parent)
            .status()
            .map_err(error)?;
        if !status.success() {
            let message = format!("rsync failed for {relative}");
            state
                .store
                .lock()
                .map_err(error)?
                .record_remote_sync(host, Some(&message))
                .map_err(error)?;
            return Err(message);
        }
    }
    let _gate = state.scan_gate.lock().map_err(error)?;
    let mut store = Store::open(&Store::default_path()).map_err(error)?;
    let report = state
        .scanner
        .scan_host(&mut store, &home, Some(host), true)
        .map_err(error)?;
    store.record_remote_sync(host, None).map_err(error)?;
    Ok(report)
}

#[tauri::command]
async fn sync_remote_host(
    app: tauri::AppHandle,
    state: State<'_, Shared>,
    host: String,
) -> CommandResult<ScanReport> {
    let state = state.inner().clone();
    let report = tauri::async_runtime::spawn_blocking(move || sync_host(&state, &host))
        .await
        .map_err(error)??;
    app.emit("library-changed", &report).map_err(error)?;
    Ok(report)
}

#[derive(Serialize)]
struct OpenedTerminal {
    id: u32,
    directory: String,
}

#[tauri::command]
async fn terminal_open(
    state: State<'_, Shared>,
    terminals: State<'_, terminal::Terminals>,
    key: String,
    cols: u16,
    rows: u16,
    output: tauri::ipc::Channel<tauri::ipc::InvokeResponseBody>,
    events: tauri::ipc::Channel<terminal::TerminalEvent>,
) -> CommandResult<OpenedTerminal> {
    let plan = off_main(state, move |state| resume_plan(state, &key)).await?;
    let command = plan.command.clone();
    // A remote session's directory lives on the host; start the local shell somewhere that exists.
    let directory = if plan.host.is_some() {
        resume::local_home()
    } else {
        if !Path::new(&plan.directory).is_dir() {
            return Err("Project folder became unavailable before launch".into());
        }
        plan.directory.clone()
    };
    let id = terminals.open(
        &command,
        &directory,
        cols,
        rows,
        move |chunk| {
            output
                .send(tauri::ipc::InvokeResponseBody::Raw(chunk))
                .is_ok()
        },
        move |event| {
            let _ = events.send(event);
        },
    )?;
    Ok(OpenedTerminal {
        id,
        directory: plan.directory,
    })
}

#[tauri::command]
async fn terminal_write(
    terminals: State<'_, terminal::Terminals>,
    id: u32,
    data: String,
) -> CommandResult<()> {
    terminals.write(id, data.as_bytes())
}

#[tauri::command]
async fn terminal_resize(
    terminals: State<'_, terminal::Terminals>,
    id: u32,
    cols: u16,
    rows: u16,
) -> CommandResult<()> {
    terminals.resize(id, cols, rows)
}

#[tauri::command]
async fn terminal_close(terminals: State<'_, terminal::Terminals>, id: u32) -> CommandResult<()> {
    terminals.close(id)
}

type ResumePlan = resume::Plan;

fn resume_plan(state: &AppState, key: &str) -> CommandResult<ResumePlan> {
    resume::plan(state, key)
}

#[tauri::command]
async fn inspect_resume(state: State<'_, Shared>, key: String) -> CommandResult<resume::Readiness> {
    off_main(state, move |state| resume::inspect(state, &key)).await
}

#[tauri::command]
async fn set_resume_folder(
    state: State<'_, Shared>,
    app: tauri::AppHandle,
    key: String,
    folder: String,
) -> CommandResult<resume::Readiness> {
    let result = off_main(state, move |state| {
        if key.is_empty()
            || key.chars().count() > 4096
            || folder.chars().count() > 4096
            || folder.contains('\0')
            || !Path::new(&folder).is_absolute()
            || !Path::new(&folder).is_dir()
        {
            return Err("Choose an existing absolute project folder".into());
        }
        {
            let store = state.store.lock().map_err(error)?;
            let meta = store
                .get_session(&key)
                .map_err(error)?
                .ok_or("unknown session")?;
            if meta.host.is_some() || meta.parent_key.is_some() {
                return Err("Folder recovery is available for local root sessions only".into());
            }
            let spec = state
                .scanner
                .adapter(meta.agent)
                .and_then(|adapter| adapter.resume(&meta))
                .ok_or("Unsupported agent")?;
            let original = spec
                .cwd
                .or(meta.project_path)
                .ok_or("Project directory is unknown")?;
            let mut values = resume::mappings(store.pref_get(resume::MAPPINGS).map_err(error)?)?;
            values.insert(original, folder);
            let value = serde_json::to_string(&values).map_err(error)?;
            resume::mappings(Some(value.clone()))?;
            store.pref_set(resume::MAPPINGS, &value).map_err(error)?;
        }
        resume::inspect(state, &key)
    })
    .await?;
    let _ = app.emit("library-changed", ());
    Ok(result)
}

#[tauri::command]
async fn resume_session(state: State<'_, Shared>, key: String) -> CommandResult<String> {
    off_main(state, move |state| {
        let ResumePlan {
            directory,
            host,
            command,
        } = resume_plan(state, &key)?;
        if host.is_some() {
            return Ok(command);
        }
        #[cfg(not(target_os = "windows"))]
        let shell = resume::login_shell();
        #[cfg(target_os = "macos")]
        {
            let script = format!(
                "tell application \"Terminal\" to do script \"{}\"",
                format!(
                    "cd {} && {} -l -i -c {}",
                    shell_quote(&directory),
                    shell_quote(&shell),
                    shell_quote(&command)
                )
                .replace('\\', "\\\\")
                .replace('"', "\\\"")
            );
            std::process::Command::new("osascript")
                .args(["-e", &script])
                .spawn()
                .map_err(error)?;
        }
        #[cfg(target_os = "linux")]
        {
            std::process::Command::new("x-terminal-emulator")
                .args(["-e", &shell, "-l", "-i", "-c", &command])
                .current_dir(&directory)
                .spawn()
                .map_err(error)?;
        }
        #[cfg(target_os = "windows")]
        {
            let arguments = ["-NoLogo", "-NoExit", "-Command", &command];
            if std::process::Command::new("wt.exe")
                .args(["-d", &directory, "powershell.exe"])
                .args(arguments)
                .spawn()
                .is_err()
            {
                std::process::Command::new("powershell.exe")
                    .args(arguments)
                    .current_dir(&directory)
                    .spawn()
                    .map_err(error)?;
            }
        }
        #[cfg(not(target_os = "windows"))]
        let _ = directory;
        Ok(command)
    })
    .await
}

#[tauri::command]
async fn get_pref(state: State<'_, Shared>, key: String) -> CommandResult<Option<String>> {
    off_main(state, move |state| {
        state
            .store
            .lock()
            .map_err(error)?
            .pref_get(&key)
            .map_err(error)
    })
    .await
}

#[tauri::command]
async fn set_pref(
    state: State<'_, Shared>,
    app: tauri::AppHandle,
    key: String,
    value: String,
) -> CommandResult<()> {
    let mapping_changed = key == resume::MAPPINGS;
    off_main(state, move |state| {
        if key == resume::MAPPINGS {
            resume::mappings(Some(value.clone()))?;
        }
        state
            .store
            .lock()
            .map_err(error)?
            .pref_set(&key, &value)
            .map_err(error)
    })
    .await?;
    if mapping_changed {
        let _ = app.emit("library-changed", ());
    }
    Ok(())
}

#[derive(Serialize)]
struct RemoteHost {
    host: String,
    enabled: bool,
    last_sync_ms: Option<i64>,
    last_error: Option<String>,
}

#[tauri::command]
async fn list_remote_hosts(state: State<'_, Shared>) -> CommandResult<Vec<RemoteHost>> {
    off_main(state, move |state| {
        state
            .store
            .lock()
            .map_err(error)?
            .remote_hosts()
            .map_err(error)
            .map(|rows| {
                rows.into_iter()
                    .map(|(host, enabled, last_sync_ms, last_error)| RemoteHost {
                        host,
                        enabled,
                        last_sync_ms,
                        last_error,
                    })
                    .collect()
            })
    })
    .await
}

#[tauri::command]
async fn set_remote_host(
    state: State<'_, Shared>,
    host: String,
    enabled: bool,
) -> CommandResult<()> {
    off_main(state, move |state| {
        state
            .store
            .lock()
            .map_err(error)?
            .set_remote_host(&host, enabled)
            .map_err(error)
    })
    .await
}

#[tauri::command]
async fn remove_remote_host(state: State<'_, Shared>, host: String) -> CommandResult<()> {
    off_main(state, move |state| {
        let cache = remote_cache(&host)?;
        let mut store = state.store.lock().map_err(error)?;
        store.remove_remote_host(&host).map_err(error)?;
        store
            .prune_missing(Some(&host), &HashSet::new())
            .map_err(error)?;
        if let Some(parent) = cache.parent() {
            if parent.exists() {
                std::fs::remove_dir_all(parent).map_err(error)?;
            }
        }
        Ok(())
    })
    .await
}

#[tauri::command]
fn check_updates() -> CommandResult<Option<String>> {
    let response = match ureq::get("https://api.github.com/repos/tryronda/ronda/releases/latest")
        .set("User-Agent", "Ronda")
        .call()
    {
        Ok(response) => response,
        Err(ureq::Error::Status(404, _)) => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    let value: serde_json::Value = response.into_json().map_err(error)?;
    Ok(value
        .get("html_url")
        .and_then(|v| v.as_str())
        .map(str::to_string))
}

#[tauri::command]
fn app_paths() -> CommandResult<(String, String, String)> {
    let binary = std::env::current_exe().map_err(error)?;
    let folder = binary.parent().ok_or("missing executable directory")?;
    let extension = if cfg!(windows) { ".exe" } else { "" };
    Ok((
        folder
            .join(format!("ronda-mcp{extension}"))
            .to_string_lossy()
            .into_owned(),
        folder
            .join(format!("ronda-cli{extension}"))
            .to_string_lossy()
            .into_owned(),
        Store::default_path().to_string_lossy().into_owned(),
    ))
}

fn start_watcher(state: Shared, app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let (tx, rx) = std::sync::mpsc::channel();
        let Ok(mut watcher) = notify::recommended_watcher(tx) else {
            return;
        };
        let mut watched = HashSet::new();
        loop {
            let locations = match state.store.lock() {
                Ok(store) => state.scanner.locations(&store).unwrap_or_default(),
                Err(_) => break,
            };
            let desired: HashSet<PathBuf> = locations
                .into_iter()
                .filter(|l| l.enabled)
                .map(|l| PathBuf::from(l.path))
                .filter(|p| p.exists())
                .collect();
            for path in watched.difference(&desired) {
                let _ = watcher.unwatch(path);
            }
            for path in desired.difference(&watched) {
                let mode = if path.is_dir() {
                    notify::RecursiveMode::Recursive
                } else {
                    notify::RecursiveMode::NonRecursive
                };
                let _ = watcher.watch(path, mode);
            }
            watched = desired;
            match rx.recv_timeout(std::time::Duration::from_secs(2)) {
                Ok(_) => {
                    while rx
                        .recv_timeout(std::time::Duration::from_millis(250))
                        .is_ok()
                    {}
                    if let Ok(report) = scan_local(&state, false) {
                        let _ = app.emit("library-changed", report);
                    }
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
    });
}

pub fn run() {
    let store = Store::open(&Store::default_path()).expect("open Ronda index");
    let state = Arc::new(AppState {
        store: Mutex::new(store),
        scan_gate: Mutex::new(()),
        scanner: Scanner::new(Scanner::default_home()),
    });
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .skip_initial_state("main")
                .build(),
        )
        .manage(state)
        .manage(terminal::Terminals::default())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                restore_main_window(&window);
                #[cfg(target_os = "macos")]
                {
                    traffic_lights::hide(&window);
                    let target = window.clone();
                    window.on_window_event(move |event| {
                        if matches!(
                            event,
                            tauri::WindowEvent::Focused(_)
                                | tauri::WindowEvent::Resized(_)
                                | tauri::WindowEvent::ScaleFactorChanged { .. }
                        ) {
                            traffic_lights::hide(&target);
                        }
                    });
                }
            }
            let handle = app.handle().clone();
            let state = handle.state::<Shared>().inner().clone();
            std::thread::spawn(move || {
                let report = scan_local(&state, false);
                let hosts = state
                    .store
                    .lock()
                    .ok()
                    .and_then(|store| store.remote_hosts().ok())
                    .unwrap_or_default();
                for (host, enabled, _, _) in hosts {
                    if enabled {
                        let _ = sync_host(&state, &host);
                    }
                }
                match report {
                    Ok(report) => {
                        let _ = handle.emit("library-changed", report);
                    }
                    Err(error) => {
                        let _ = handle.emit("scan-error", error.to_string());
                    }
                }
            });
            let state = app.state::<Shared>().inner().clone();
            start_watcher(state, app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_sessions,
            session_page,
            library_options,
            get_session,
            get_transcript,
            search_sessions,
            search_grouped,
            search_session_matches,
            list_projects,
            get_insights,
            get_intelligence,
            get_project_overview,
            find_error_history,
            get_session_relationships,
            list_locations,
            scan,
            set_session_flags,
            list_bookmarks,
            save_bookmark,
            delete_bookmark,
            get_bookmark_backup,
            export_bookmarks,
            read_bookmark_backup,
            import_bookmarks,
            export_session,
            export_context,
            trash_session,
            resume_session,
            inspect_resume,
            set_resume_folder,
            terminal_open,
            terminal_write,
            terminal_resize,
            terminal_close,
            get_pref,
            set_pref,
            list_remote_hosts,
            set_remote_host,
            remove_remote_host,
            sync_remote_host,
            check_updates,
            app_paths
        ])
        .run(tauri::generate_context!())
        .expect("run Ronda desktop");
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::{fs, os::unix::fs::PermissionsExt};

    #[test]
    fn context_export_preserves_complete_text_and_cleans_failed_temporary_files() {
        let root =
            std::env::temp_dir().join(format!("ronda context export {}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let destination = root.join("context.md");
        let text = "# Reviewed context\n\n你好 😀\n```rust\nlet answer = 42;\n```\n";
        write_export(&destination, text.as_bytes()).unwrap();
        assert_eq!(fs::read_to_string(&destination).unwrap(), text);
        assert!(tauri::async_runtime::block_on(export_context(
            destination.clone(),
            "😀".repeat(100_001)
        ))
        .is_err());
        assert_eq!(fs::read_to_string(&destination).unwrap(), text);
        let directory = root.join("cannot-replace-directory.md");
        fs::create_dir(&directory).unwrap();
        assert!(write_export(&directory, text.as_bytes()).is_err());
        assert!(directory.is_dir());
        assert_eq!(fs::read_dir(&root).unwrap().count(), 2);
        fs::remove_dir_all(&root).unwrap();
    }

    fn executable(path: &Path, body: &str) {
        fs::write(path, format!("#!/bin/sh\n{body}\n")).unwrap();
        fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
    }

    #[test]
    fn remote_sync_keeps_host_ids_separate_and_reports_failures() {
        let root = std::env::temp_dir().join(format!("ronda remote test {}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let local = root.join("local home");
        let remote = root.join("remote home");
        let bin = root.join("bin");
        fs::create_dir_all(&bin).unwrap();
        for home in [&local, &remote] {
            let source = home.join(".claude/projects/project with spaces/same.jsonl");
            fs::create_dir_all(source.parent().unwrap()).unwrap();
            fs::write(source, "{\"type\":\"user\",\"cwd\":\"/project with spaces\",\"message\":{\"content\":\"Hello\"}}\n").unwrap();
            let child =
                home.join(".claude/projects/project with spaces/same/subagents/agent-review.jsonl");
            fs::create_dir_all(child.parent().unwrap()).unwrap();
            fs::write(
                child,
                "{\"type\":\"user\",\"isSidechain\":true,\"message\":{\"content\":\"Review\"}}\n",
            )
            .unwrap();
        }
        let db = root.join("data/ronda.db");
        let old_db = std::env::var_os("RONDA_DB");
        let old_path = std::env::var_os("PATH");
        std::env::set_var("RONDA_DB", &db);
        std::env::set_var("PATH", &bin);
        std::env::set_var("RONDA_FAKE_REMOTE_HOME", &remote);
        executable(&bin.join("ssh"), "printf '.claude/projects\\n'");
        executable(&bin.join("rsync"), "for last; do :; done\n/bin/cp -R \"$RONDA_FAKE_REMOTE_HOME/.claude/projects\" \"$last/\"");
        let state = Arc::new(AppState {
            store: Mutex::new(Store::open(&db).unwrap()),
            scan_gate: Mutex::new(()),
            scanner: Scanner::new(local.clone()),
        });
        scan_local(&state, true).unwrap();
        state
            .store
            .lock()
            .unwrap()
            .set_remote_host("box", true)
            .unwrap();
        assert_eq!(sync_host(&state, "box").unwrap().indexed, 2);
        let sessions = state
            .store
            .lock()
            .unwrap()
            .list_sessions(&SessionQuery::default())
            .unwrap();
        assert_eq!(sessions.len(), 4);
        assert_ne!(sessions[0].key, sessions[1].key);
        assert!(sessions
            .iter()
            .any(|s| s.host.as_deref() == Some("box") && !s.can_delete));
        assert!(sessions
            .iter()
            .any(|s| s.key == "claude-code:box:same:agent-review"
                && s.parent_key.as_deref() == Some("claude-code:box:same")));
        assert_eq!(
            state.store.lock().unwrap().projects().unwrap()[0].session_count,
            2
        );
        executable(&bin.join("ssh"), "echo authentication failed >&2\nexit 255");
        assert!(sync_host(&state, "box")
            .unwrap_err()
            .contains("authentication failed"));
        assert!(state.store.lock().unwrap().remote_hosts().unwrap()[0]
            .3
            .as_deref()
            .unwrap()
            .contains("authentication failed"));
        fs::remove_file(bin.join("ssh")).unwrap();
        assert!(sync_host(&state, "box").is_err());
        if let Some(value) = old_db {
            std::env::set_var("RONDA_DB", value);
        } else {
            std::env::remove_var("RONDA_DB");
        }
        if let Some(value) = old_path {
            std::env::set_var("PATH", value);
        } else {
            std::env::remove_var("PATH");
        }
        std::env::remove_var("RONDA_FAKE_REMOTE_HOME");
        drop(state);
        fs::remove_dir_all(root).unwrap();
    }
}
