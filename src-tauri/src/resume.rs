//! Read-only launch inspection and exact local project-folder recovery.
use crate::{error, shell_quote, AppState, CommandResult};
use serde::Serialize;
use std::{
    collections::BTreeMap,
    path::Path,
    process::{Command, Stdio},
    time::{Duration, Instant},
};

pub const MAPPINGS: &str = "resume_project_mappings";

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Reason {
    UnsupportedAgent,
    UnsupportedChild,
    UnknownProject,
    MissingFolder,
    MissingExecutable,
    InspectionUnknown,
    RemoteEnvironmentUnchecked,
}

#[derive(Serialize)]
pub struct Readiness {
    pub supported: bool,
    pub ready: bool,
    pub host: Option<String>,
    pub original_directory: Option<String>,
    pub directory: Option<String>,
    pub program: Option<String>,
    pub args: Vec<String>,
    pub command: Option<String>,
    pub reasons: Vec<Reason>,
}

pub struct Plan {
    pub directory: String,
    pub host: Option<String>,
    pub command: String,
}

fn valid_path(path: &str) -> bool {
    !path.is_empty()
        && path.chars().count() <= 4096
        && !path.contains('\0')
        && Path::new(path).is_absolute()
}

pub fn local_home() -> String {
    let home = ronda_core::scanner::Scanner::default_home();
    if home.is_dir() {
        home
    } else {
        std::env::temp_dir()
    }
    .to_string_lossy()
    .into_owned()
}

pub fn mappings(raw: Option<String>) -> CommandResult<BTreeMap<String, String>> {
    let values: BTreeMap<String, String> =
        serde_json::from_str(raw.as_deref().unwrap_or("{}")).map_err(error)?;
    if values.len() > 256
        || values
            .iter()
            .any(|(from, to)| !valid_path(from) || !valid_path(to))
    {
        return Err("invalid project-folder mappings".into());
    }
    Ok(values)
}

/// Resolves a session's current local project folder without checking or starting its agent.
pub fn project_directory(state: &AppState, key: &str) -> CommandResult<String> {
    if key.is_empty() || key.chars().count() > 4096 || key.contains('\0') {
        return Err("invalid session key".into());
    }
    let (meta, saved) = {
        let store = state.store.lock().map_err(error)?;
        let meta = store
            .get_session(key)
            .map_err(error)?
            .ok_or("unknown session")?;
        if meta.host.is_some() {
            return Err("Remote project folders cannot be opened locally".into());
        }
        if meta.parent_key.is_some() {
            return Err("Subagent sessions do not have an openable project folder".into());
        }
        (meta, store.pref_get(MAPPINGS).map_err(error)?)
    };
    let original = meta
        .project_path
        .filter(|path| !path.is_empty())
        .ok_or("Project folder is unknown")?;
    let directory = mappings(saved)?.get(&original).cloned().unwrap_or(original);
    checked_project_directory(&directory)
}

fn checked_project_directory(directory: &str) -> CommandResult<String> {
    if !valid_path(directory) {
        return Err("Project folder must be an absolute local path".into());
    }
    let path =
        std::fs::canonicalize(directory).map_err(|_| "Project folder is missing or unavailable")?;
    if !path.is_dir() {
        return Err("Project folder is missing or unavailable".into());
    }
    path.into_os_string()
        .into_string()
        .map_err(|_| "Project folder path cannot be represented as text".into())
}

#[cfg(not(target_os = "windows"))]
pub fn login_shell() -> String {
    std::env::var("SHELL")
        .ok()
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| {
            if cfg!(target_os = "macos") {
                "/bin/zsh"
            } else {
                "/bin/sh"
            }
            .into()
        })
}

/// No agent or SSH invocation. Shell startup and lookup have a bounded wait; uncertainty
/// blocks execution rather than being presented as a missing executable.
fn lookup(mut command: Command, timeout: Duration) -> Option<bool> {
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                return match status.code() {
                    Some(0) => Some(true),
                    Some(10) => Some(false),
                    _ => None,
                }
            }
            Ok(None) if started.elapsed() < timeout => {
                std::thread::sleep(Duration::from_millis(10))
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn executable_in_shell(
    shell: &str,
    program: &str,
    directory: &str,
    timeout: Duration,
) -> Option<bool> {
    let mut command = Command::new(shell);
    command.args([
        "-l",
        "-i",
        "-c",
        "command -v \"$1\" >/dev/null 2>&1 && exit 0; exit 10",
        "ronda-readiness",
        program,
    ]);
    command.current_dir(directory);
    lookup(command, timeout)
}

fn executable(program: &str, directory: &str) -> Option<bool> {
    #[cfg(not(target_os = "windows"))]
    {
        executable_in_shell(&login_shell(), program, directory, Duration::from_secs(2))
    }
    #[cfg(target_os = "windows")]
    {
        executable_in_powershell(program, directory, Duration::from_secs(5))
    }
}

#[cfg(target_os = "windows")]
fn executable_in_powershell(program: &str, directory: &str, timeout: Duration) -> Option<bool> {
    let mut command = Command::new("powershell.exe");
    command.args(["-NoLogo", "-NonInteractive", "-Command", &format!(
        "if (Get-Command -Name {} -CommandType Application -ErrorAction SilentlyContinue) {{ exit 0 }}; exit 10", crate::powershell_quote(program))]);
    command.current_dir(directory);
    lookup(command, timeout)
}

pub fn inspect(state: &AppState, key: &str) -> CommandResult<Readiness> {
    inspect_with(state, key, executable)
}

fn inspect_with(
    state: &AppState,
    key: &str,
    lookup_program: fn(&str, &str) -> Option<bool>,
) -> CommandResult<Readiness> {
    if key.is_empty() || key.chars().count() > 4096 || key.contains('\0') {
        return Err("invalid session key".into());
    }
    let (meta, saved) = {
        let store = state.store.lock().map_err(error)?;
        (
            store
                .get_session(key)
                .map_err(error)?
                .ok_or("unknown session")?,
            store.pref_get(MAPPINGS).map_err(error)?,
        )
    };
    let mut result = Readiness {
        supported: false,
        ready: false,
        host: meta.host.clone(),
        original_directory: None,
        directory: None,
        program: None,
        args: vec![],
        command: None,
        reasons: vec![],
    };
    if meta.parent_key.is_some() {
        result.reasons.push(Reason::UnsupportedChild);
        return Ok(result);
    }
    let Some(spec) = state
        .scanner
        .adapter(meta.agent)
        .and_then(|adapter| adapter.resume(&meta))
    else {
        result.reasons.push(Reason::UnsupportedAgent);
        return Ok(result);
    };
    result.supported = true;
    result.program = Some(spec.program.clone());
    result.args = spec.args.clone();
    let Some(original) = spec
        .cwd
        .or(meta.project_path)
        .filter(|value| !value.is_empty())
    else {
        result.reasons.push(Reason::UnknownProject);
        return Ok(result);
    };
    let saved = if meta.host.is_none() {
        mappings(saved)?
    } else {
        BTreeMap::new()
    };
    let directory = if meta.host.is_none() {
        saved
            .get(&original)
            .cloned()
            .unwrap_or_else(|| original.clone())
    } else {
        original.clone()
    };
    if directory.contains('\0') {
        return Err("invalid project directory".into());
    }
    result.original_directory = Some(original);
    result.directory = Some(directory.clone());
    let remote_command = format!(
        "cd {} && {}",
        shell_quote(&directory),
        std::iter::once(shell_quote(&spec.program))
            .chain(spec.args.iter().map(|arg| shell_quote(arg)))
            .collect::<Vec<_>>()
            .join(" ")
    );
    #[cfg(not(target_os = "windows"))]
    let command = remote_command.clone();
    #[cfg(target_os = "windows")]
    let command = format!(
        "Set-Location -LiteralPath {}; if ($?) {{ & {} }}",
        crate::powershell_quote(&directory),
        std::iter::once(crate::powershell_quote(&spec.program))
            .chain(spec.args.iter().map(|arg| crate::powershell_quote(arg)))
            .collect::<Vec<_>>()
            .join(" ")
    );
    result.command = Some(if let Some(host) = &meta.host {
        #[cfg(not(target_os = "windows"))]
        {
            format!(
                "ssh -t {} {}",
                shell_quote(host),
                shell_quote(&remote_command)
            )
        }
        #[cfg(target_os = "windows")]
        {
            format!(
                "& ssh -t {} {}",
                crate::powershell_quote(host),
                crate::powershell_quote(&remote_command)
            )
        }
    } else {
        command
    });
    if meta.host.is_some() {
        result.reasons.push(Reason::RemoteEnvironmentUnchecked);
    } else if !valid_path(&directory) || !Path::new(&directory).is_dir() {
        result.reasons.push(Reason::MissingFolder);
    }
    let local_directory = if meta.host.is_none() && Path::new(&directory).is_dir() {
        directory.clone()
    } else {
        local_home()
    };
    match lookup_program(
        if meta.host.is_some() {
            "ssh"
        } else {
            &spec.program
        },
        &local_directory,
    ) {
        Some(true) => {}
        Some(false) => result.reasons.push(Reason::MissingExecutable),
        None => result.reasons.push(Reason::InspectionUnknown),
    }
    result.ready = result
        .reasons
        .iter()
        .all(|reason| matches!(reason, Reason::RemoteEnvironmentUnchecked));
    Ok(result)
}

pub fn plan(state: &AppState, key: &str) -> CommandResult<Plan> {
    let readiness = inspect(state, key)?;
    if !readiness.ready {
        return Err(format!("resume unavailable: {:?}", readiness.reasons));
    }
    Ok(Plan {
        directory: readiness.directory.ok_or("project directory is unknown")?,
        host: readiness.host,
        command: readiness.command.ok_or("resume command unavailable")?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn folder_validation_accepts_unicode_and_spaces_but_rejects_missing_and_files() {
        let root = std::env::temp_dir().join(format!("ronda folder ' ü ; {}", std::process::id()));
        let file = root.with_extension("txt");
        fs::create_dir_all(&root).unwrap();
        fs::write(&file, "synthetic").unwrap();

        assert_eq!(
            checked_project_directory(root.to_str().unwrap()).unwrap(),
            fs::canonicalize(&root).unwrap().to_string_lossy()
        );
        assert_eq!(
            checked_project_directory(root.join("missing").to_str().unwrap()).unwrap_err(),
            "Project folder is missing or unavailable"
        );
        assert_eq!(
            checked_project_directory(file.to_str().unwrap()).unwrap_err(),
            "Project folder is missing or unavailable"
        );
        assert!(checked_project_directory("relative/folder").is_err());
        fs::remove_file(file).unwrap();
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn open_folder_resolves_mappings_and_rejects_remote_child_and_unknown_sessions() {
        let root = std::env::temp_dir().join(format!("ronda open folder ü {}", std::process::id()));
        let mapped = root.join("mapped folder");
        fs::create_dir_all(&mapped).unwrap();
        let state = AppState {
            store: std::sync::Mutex::new(ronda_core::Store::open(&root.join("index.db")).unwrap()),
            scan_gate: std::sync::Mutex::new(()),
            scanner: ronda_core::scanner::Scanner::new(root.clone()),
        };
        let mut meta = ronda_core::SessionMeta {
            key: "codex:open-folder".into(),
            native_id: "open-folder".into(),
            agent: ronda_core::AgentId::Codex,
            host: None,
            parent_key: None,
            title: "Fixture".into(),
            project_path: Some(root.join("original folder").to_string_lossy().into_owned()),
            source_path: "synthetic".into(),
            created_at: 1,
            updated_at: 1,
            model: None,
            source: None,
            tokens: None,
            archived: false,
            metadata_only: false,
            can_delete: false,
            starred: false,
            pinned: false,
        };
        let insert = |meta: &ronda_core::SessionMeta| {
            state
                .store
                .lock()
                .unwrap()
                .upsert(
                    &ronda_core::models::ParsedSession {
                        meta: meta.clone(),
                        messages: vec![],
                    },
                    "fixture",
                )
                .unwrap();
        };
        insert(&meta);
        let mappings = BTreeMap::from([(
            meta.project_path.clone().unwrap(),
            mapped.to_string_lossy().into_owned(),
        )]);
        state
            .store
            .lock()
            .unwrap()
            .pref_set(MAPPINGS, &serde_json::to_string(&mappings).unwrap())
            .unwrap();
        assert_eq!(
            project_directory(&state, &meta.key).unwrap(),
            fs::canonicalize(&mapped).unwrap().to_string_lossy()
        );

        meta.host = Some(String::new());
        insert(&meta);
        assert!(project_directory(&state, &meta.key)
            .unwrap_err()
            .contains("Remote"));
        meta.host = None;
        meta.parent_key = Some("codex:parent".into());
        insert(&meta);
        assert!(project_directory(&state, &meta.key)
            .unwrap_err()
            .contains("Subagent"));
        meta.parent_key = None;
        meta.project_path = None;
        insert(&meta);
        assert!(project_directory(&state, &meta.key)
            .unwrap_err()
            .contains("unknown"));
        drop(state);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn lookup_uses_shell_path_never_runs_agent_and_distinguishes_missing_from_unknown() {
        let root = std::env::temp_dir().join(format!("ronda resume ' ü ; {}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        #[cfg(unix)]
        {
            let marker = root.join("agent-ran");
            let program = root.join("only-in-login-path");
            fs::write(
                &program,
                format!(
                    "#!/bin/sh\ntouch {}\n",
                    shell_quote(marker.to_str().unwrap())
                ),
            )
            .unwrap();
            fs::set_permissions(&program, fs::Permissions::from_mode(0o755)).unwrap();
            let shell = root.join("login-shell");
            fs::write(
                &shell,
                format!(
                    "#!/bin/sh\nshift 3\nPATH={}:/usr/bin:/bin /bin/sh -c \"$1\" \"$2\" \"$3\"\n",
                    shell_quote(root.to_str().unwrap())
                ),
            )
            .unwrap();
            fs::set_permissions(&shell, fs::Permissions::from_mode(0o755)).unwrap();
            assert_eq!(
                executable_in_shell(
                    shell.to_str().unwrap(),
                    "only-in-login-path",
                    root.to_str().unwrap(),
                    Duration::from_secs(2)
                ),
                Some(true)
            );
            assert_eq!(
                executable_in_shell(
                    shell.to_str().unwrap(),
                    "ronda-uninstalled-proof",
                    root.to_str().unwrap(),
                    Duration::from_secs(2)
                ),
                Some(false)
            );
            assert_eq!(
                executable_in_shell(
                    "/ronda-missing-shell",
                    "sh",
                    root.to_str().unwrap(),
                    Duration::from_secs(2)
                ),
                None
            );
            assert!(!marker.exists());
            fs::write(&shell, "#!/bin/sh\nexec /bin/sleep 5\n").unwrap();
            let start = Instant::now();
            assert_eq!(
                executable_in_shell(
                    shell.to_str().unwrap(),
                    "sh",
                    root.to_str().unwrap(),
                    Duration::from_millis(40)
                ),
                None
            );
            assert!(start.elapsed() < Duration::from_secs(1));
        }
        #[cfg(windows)]
        {
            let windows_paths = BTreeMap::from([
                (
                    r"C:\moved ' ü ; project".to_string(),
                    root.to_str().unwrap().to_string(),
                ),
                (
                    r"\\server\share\moved ' ü ; project".to_string(),
                    root.to_str().unwrap().to_string(),
                ),
            ]);
            assert_eq!(
                mappings(Some(serde_json::to_string(&windows_paths).unwrap())).unwrap(),
                windows_paths
            );
            assert!(!valid_path(r"C:relative"));
            assert!(!valid_path(r"\rooted-without-drive"));
            // Resolution semantics are separate from the production deadline: cold CI
            // PowerShell can legitimately exceed five seconds and report unknown.
            assert_eq!(
                executable_in_powershell(
                    "powershell.exe",
                    root.to_str().unwrap(),
                    Duration::from_secs(30)
                ),
                Some(true)
            );
            assert_eq!(
                executable_in_powershell(
                    "ronda-missing-proof.exe",
                    root.to_str().unwrap(),
                    Duration::from_secs(30)
                ),
                Some(false)
            );
            let mut sleeping = Command::new("powershell.exe");
            sleeping.args(["-NoProfile", "-Command", "Start-Sleep -Seconds 5; exit 0"]);
            assert_eq!(lookup(sleeping, Duration::from_millis(40)), None);
        }
        let map = BTreeMap::from([(
            root.to_str().unwrap().to_string(),
            root.to_str().unwrap().to_string(),
        )]);
        assert_eq!(
            mappings(Some(serde_json::to_string(&map).unwrap())).unwrap(),
            map
        );
        assert!(mappings(Some("{\"relative\":\"/tmp\"}".into())).is_err());
        let state = AppState {
            store: std::sync::Mutex::new(ronda_core::Store::open(&root.join("index.db")).unwrap()),
            scan_gate: std::sync::Mutex::new(()),
            scanner: ronda_core::scanner::Scanner::new(root.clone()),
        };
        let mut meta = ronda_core::SessionMeta {
            key: "codex:same".into(),
            native_id: "same; ü '".into(),
            agent: ronda_core::AgentId::Codex,
            host: None,
            parent_key: None,
            title: "Fixture".into(),
            project_path: Some(root.join("moved").to_str().unwrap().into()),
            source_path: "synthetic".into(),
            created_at: 1,
            updated_at: 1,
            model: None,
            source: None,
            tokens: None,
            archived: false,
            metadata_only: false,
            can_delete: false,
            starred: false,
            pinned: false,
        };
        let insert = |meta: &ronda_core::SessionMeta| {
            state
                .store
                .lock()
                .unwrap()
                .upsert(
                    &ronda_core::models::ParsedSession {
                        meta: meta.clone(),
                        messages: vec![],
                    },
                    "fixture",
                )
                .unwrap();
        };
        insert(&meta);
        let read = || inspect_with(&state, "codex:same", |_, _| Some(true)).unwrap();
        assert!(matches!(read().reasons.as_slice(), [Reason::MissingFolder]));
        let mapping = BTreeMap::from([(
            meta.project_path.clone().unwrap(),
            root.to_str().unwrap().to_string(),
        )]);
        state
            .store
            .lock()
            .unwrap()
            .pref_set(MAPPINGS, &serde_json::to_string(&mapping).unwrap())
            .unwrap();
        let mapped = read();
        assert!(mapped.ready);
        assert_eq!(mapped.directory.as_deref(), root.to_str());
        #[cfg(not(target_os = "windows"))]
        let quoted = shell_quote(&meta.native_id);
        #[cfg(target_os = "windows")]
        let quoted = crate::powershell_quote(&meta.native_id);
        #[cfg(not(target_os = "windows"))]
        let quoted_directory = shell_quote(root.to_str().unwrap());
        #[cfg(target_os = "windows")]
        let quoted_directory = crate::powershell_quote(root.to_str().unwrap());
        let command = mapped.command.unwrap();
        assert!(command.contains(&quoted));
        assert!(command.contains(&quoted_directory));
        meta.host = Some("box".into());
        insert(&meta);
        let remote = read();
        assert!(remote.ready);
        assert_eq!(remote.directory, meta.project_path);
        assert!(matches!(
            remote.reasons.as_slice(),
            [Reason::RemoteEnvironmentUnchecked]
        ));
        meta.host = None;
        meta.parent_key = Some("codex:parent".into());
        insert(&meta);
        assert!(matches!(
            read().reasons.as_slice(),
            [Reason::UnsupportedChild]
        ));
        assert!(plan(&state, "codex:same").is_err());
        meta.parent_key = None;
        meta.project_path = None;
        insert(&meta);
        assert!(matches!(
            read().reasons.as_slice(),
            [Reason::UnknownProject]
        ));
        meta.agent = ronda_core::AgentId::Dsh;
        let dsh = state
            .scanner
            .adapter(meta.agent)
            .unwrap()
            .resume(&meta)
            .unwrap();
        assert_eq!(dsh.args.first().map(String::as_str), Some("--no-install"));
        meta.agent = ronda_core::AgentId::Gemini;
        insert(&meta);
        assert!(matches!(
            read().reasons.as_slice(),
            [Reason::UnsupportedAgent]
        ));
        assert!(inspect_with(&state, "", |_, _| Some(true)).is_err());
        drop(state);
        fs::remove_dir_all(root).unwrap();
    }
}
