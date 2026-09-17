use notify::Watcher;
use ronda_core::{
    intel::report::Intelligence,
    scanner::{Location, ScanReport, Scanner},
    Insights, ProjectInfo, SearchHit, SessionMeta, SessionQuery, Store, TranscriptMessage,
};
use serde::Serialize;
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, Mutex},
};
use tauri::{Emitter, Manager, State};

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
) -> CommandResult<Intelligence> {
    off_main(state, move |state| {
        state
            .store
            .lock()
            .map_err(error)?
            .intelligence(since, project.as_deref())
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

#[tauri::command]
async fn terminal_open(
    state: State<'_, Shared>,
    terminals: State<'_, terminal::Terminals>,
    key: String,
    cols: u16,
    rows: u16,
    output: tauri::ipc::Channel<tauri::ipc::InvokeResponseBody>,
    events: tauri::ipc::Channel<terminal::TerminalEvent>,
) -> CommandResult<u32> {
    let plan = off_main(state, move |state| resume_plan(state, &key)).await?;
    let command = match &plan.host {
        Some(host) => format!(
            "ssh -t {} {}",
            shell_quote(host),
            shell_quote(&plan.command)
        ),
        None => plan.command.clone(),
    };
    // A remote session's directory lives on the host; start the local shell somewhere that exists.
    let directory = if plan.host.is_some() || !Path::new(&plan.directory).is_dir() {
        std::env::var("HOME").unwrap_or_else(|_| "/".into())
    } else {
        plan.directory.clone()
    };
    terminals.open(
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
    )
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

/// How to resume a session: where, with what, and the equivalent POSIX shell command.
struct ResumePlan {
    directory: String,
    program: String,
    args: Vec<String>,
    host: Option<String>,
    /// `cd <dir> && <program> <args…>`, quoted for a POSIX shell.
    command: String,
}

fn resume_plan(state: &AppState, key: &str) -> CommandResult<ResumePlan> {
    let meta = state
        .store
        .lock()
        .map_err(error)?
        .get_session(key)
        .map_err(error)?
        .ok_or("unknown session")?;
    let spec = state
        .scanner
        .adapter(meta.agent)
        .and_then(|a| a.resume(&meta))
        .ok_or("resume is unavailable for this agent")?;
    let directory = spec
        .cwd
        .clone()
        .or(meta.project_path.clone())
        .ok_or("project directory is unknown")?;
    let command = std::iter::once(shell_quote(&spec.program))
        .chain(spec.args.iter().map(|a| shell_quote(a)))
        .collect::<Vec<_>>()
        .join(" ");
    let command = format!("cd {} && {command}", shell_quote(&directory));
    Ok(ResumePlan {
        directory,
        program: spec.program,
        args: spec.args,
        host: meta.host,
        command,
    })
}

#[tauri::command]
async fn resume_session(state: State<'_, Shared>, key: String) -> CommandResult<String> {
    off_main(state, move |state| {
        let ResumePlan {
            directory,
            program,
            args,
            host,
            command,
        } = resume_plan(state, &key)?;
        #[cfg(target_os = "windows")]
        let (directory, spec) = (
            directory.as_str(),
            ronda_core::ResumeSpec {
                program,
                args,
                cwd: None,
            },
        );
        #[cfg(not(target_os = "windows"))]
        let _ = (directory, program, args);
        if let Some(host) = &host {
            #[cfg(target_os = "windows")]
            return Ok(format!(
                "ssh -t {} {}",
                powershell_quote(host),
                powershell_quote(&command)
            ));
            #[cfg(not(target_os = "windows"))]
            return Ok(format!(
                "ssh -t {} {}",
                shell_quote(host),
                shell_quote(&command)
            ));
        }
        #[cfg(target_os = "macos")]
        {
            let script = format!(
                "tell application \"Terminal\" to do script \"{}\"",
                command.replace('\\', "\\\\").replace('"', "\\\"")
            );
            std::process::Command::new("osascript")
                .args(["-e", &script])
                .spawn()
                .map_err(error)?;
        }
        #[cfg(target_os = "linux")]
        {
            std::process::Command::new("x-terminal-emulator")
                .args(["-e", "sh", "-lc", &command])
                .spawn()
                .map_err(error)?;
        }
        #[cfg(target_os = "windows")]
        {
            let terminal = std::process::Command::new("wt.exe")
                .args(["-d", directory, &spec.program])
                .args(&spec.args)
                .spawn();
            if terminal.is_err() {
                let args = spec
                    .args
                    .iter()
                    .map(|arg| powershell_quote(arg))
                    .collect::<Vec<_>>()
                    .join(",");
                let mut script = format!(
                    "Start-Process -FilePath {} -WorkingDirectory {}",
                    powershell_quote(&spec.program),
                    powershell_quote(directory)
                );
                if !args.is_empty() {
                    script.push_str(&format!(" -ArgumentList @({args})"));
                }
                std::process::Command::new("powershell.exe")
                    .args(["-NoProfile", "-Command", &script])
                    .spawn()
                    .map_err(error)?;
            }
        }
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
async fn set_pref(state: State<'_, Shared>, key: String, value: String) -> CommandResult<()> {
    off_main(state, move |state| {
        state
            .store
            .lock()
            .map_err(error)?
            .pref_set(&key, &value)
            .map_err(error)
    })
    .await
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
            get_session,
            get_transcript,
            search_sessions,
            list_projects,
            get_insights,
            get_intelligence,
            list_locations,
            scan,
            set_session_flags,
            export_session,
            trash_session,
            resume_session,
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
