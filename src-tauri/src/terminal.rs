//! Embedded terminals: resume a session inside a pseudo-terminal the page renders with xterm.js.

use std::{
    collections::HashMap,
    io::{Read, Write},
    sync::{
        atomic::{AtomicU32, Ordering},
        Mutex,
    },
};

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;

use crate::{error, CommandResult};

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn portable_pty::ChildKiller + Send + Sync>,
}

#[derive(Default)]
pub struct Terminals {
    next: AtomicU32,
    sessions: Mutex<HashMap<u32, Session>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "event")]
pub enum TerminalEvent {
    Exit { code: Option<u32> },
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        rows: rows.max(2),
        cols: cols.max(10),
        pixel_width: 0,
        pixel_height: 0,
    }
}

/// The command a login shell runs: the resume command, then an interactive shell in the same
/// place so the tab stays useful after the agent exits.
fn command(plan_command: &str, directory: &str) -> CommandBuilder {
    #[cfg(not(target_os = "windows"))]
    {
        let shell = std::env::var("SHELL")
            .ok()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "/bin/zsh".into());
        let mut cmd = CommandBuilder::new(&shell);
        // A login, interactive shell loads the user's PATH (apps opened from Finder get a bare one).
        cmd.args([
            "-l",
            "-i",
            "-c",
            &format!("{plan_command}; exec {} -l", crate::shell_quote(&shell)),
        ]);
        cmd.cwd(directory);
        cmd
    }
    #[cfg(target_os = "windows")]
    {
        let mut cmd = CommandBuilder::new("powershell.exe");
        cmd.args(["-NoLogo", "-NoExit", "-Command", plan_command]);
        cmd.cwd(directory);
        cmd
    }
}

impl Terminals {
    pub fn open(
        &self,
        plan_command: &str,
        directory: &str,
        cols: u16,
        rows: u16,
        // Receives each chunk of output; returning false stops reading.
        mut output: impl FnMut(Vec<u8>) -> bool + Send + 'static,
        on_exit: impl FnOnce(TerminalEvent) + Send + 'static,
    ) -> CommandResult<u32> {
        let pair = native_pty_system()
            .openpty(size(cols, rows))
            .map_err(error)?;
        let mut cmd = command(plan_command, directory);
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env("TERM_PROGRAM", "Ronda");
        if std::env::var_os("LANG").is_none() {
            cmd.env("LANG", "en_US.UTF-8");
        }
        let mut child: Box<dyn Child + Send + Sync> =
            pair.slave.spawn_command(cmd).map_err(error)?;
        drop(pair.slave);

        let mut reader = pair.master.try_clone_reader().map_err(error)?;
        let writer = pair.master.take_writer().map_err(error)?;
        let killer = child.clone_killer();
        let id = self.next.fetch_add(1, Ordering::Relaxed) + 1;
        self.sessions.lock().map_err(error)?.insert(
            id,
            Session {
                master: pair.master,
                writer,
                killer,
            },
        );

        std::thread::spawn(move || {
            let mut buffer = [0u8; 16 * 1024];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) | Err(_) => break,
                    Ok(read) => {
                        if !output(buffer[..read].to_vec()) {
                            break;
                        }
                    }
                }
            }
        });
        std::thread::spawn(move || {
            let code = child.wait().ok().map(|status| status.exit_code());
            on_exit(TerminalEvent::Exit { code });
        });
        Ok(id)
    }

    pub fn write(&self, id: u32, data: &[u8]) -> CommandResult<()> {
        let mut sessions = self.sessions.lock().map_err(error)?;
        let session = sessions.get_mut(&id).ok_or("terminal is closed")?;
        session.writer.write_all(data).map_err(error)?;
        session.writer.flush().map_err(error)
    }

    pub fn resize(&self, id: u32, cols: u16, rows: u16) -> CommandResult<()> {
        let sessions = self.sessions.lock().map_err(error)?;
        let session = sessions.get(&id).ok_or("terminal is closed")?;
        session.master.resize(size(cols, rows)).map_err(error)
    }

    pub fn close(&self, id: u32) -> CommandResult<()> {
        if let Some(mut session) = self.sessions.lock().map_err(error)?.remove(&id) {
            let _ = session.killer.kill();
        }
        Ok(())
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::sync::{mpsc, Arc};
    use std::time::{Duration, Instant};

    #[test]
    fn runs_command_in_pty_forwards_input_and_reports_exit() {
        std::env::set_var("SHELL", "/bin/sh");
        let terminals = Terminals::default();
        let seen = Arc::new(Mutex::new(Vec::new()));
        let sink = seen.clone();
        let (exited, exit) = mpsc::channel();
        let dir = std::env::temp_dir();
        let id = terminals
            .open(
                "printf 'ready\\n'; read reply; echo \"got:$reply\"",
                dir.to_str().unwrap(),
                80,
                24,
                move |chunk| {
                    sink.lock().unwrap().extend(chunk);
                    true
                },
                move |event| {
                    let _ = exited.send(event);
                },
            )
            .unwrap();
        let text = || String::from_utf8_lossy(&seen.lock().unwrap()).to_string();
        let wait_for = |needle: &str| {
            let start = Instant::now();
            while !text().contains(needle) {
                assert!(
                    start.elapsed() < Duration::from_secs(10),
                    "missing {needle:?} in {:?}",
                    text()
                );
                std::thread::sleep(Duration::from_millis(20));
            }
        };
        wait_for("ready");
        terminals.resize(id, 100, 30).unwrap();
        terminals.write(id, b"hello\n").unwrap();
        wait_for("got:hello");
        // The wrapper execs a login shell after the command; end it too.
        terminals.write(id, b"exit 3\n").unwrap();
        let TerminalEvent::Exit { code } = exit.recv_timeout(Duration::from_secs(10)).unwrap();
        assert_eq!(code, Some(3));
        terminals.close(id).unwrap();
    }
}
