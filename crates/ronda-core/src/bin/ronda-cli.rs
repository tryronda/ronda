use ronda_core::{
    query::{self, FindErrorArgs, InsightsArgs, ListArgs, SearchArgs, ShowArgs},
    scanner::Scanner,
    Store,
};
use std::{
    env,
    io::{self, Write},
    path::PathBuf,
    process::ExitCode,
};

fn help() -> &'static str {
    "ronda-cli search QUERY [--project PATH] [--agent ID] [--since WHEN] [--limit N]\n\
     ronda-cli sessions [--project PATH] [--agent ID] [--since WHEN] [--starred] [--limit N]\n\
     ronda-cli show KEY [--subagent ID|*] [--from SEQ] [--messages N] [--chars N] [--message-chars N] [--tools] [--thinking]\n\
     ronda-cli projects [--since WHEN] [--limit N]\n\
     ronda-cli insights [--project PATH] [--since WHEN|all]  (default: 30d)\n\
     ronda-cli errors ERROR_TEXT\n\
     ronda-cli setup | index\n\
     Global: --db PATH, --help, --version. Use -- before a query beginning with -.\n"
}

fn take_global(mut args: Vec<String>) -> Result<(PathBuf, Vec<String>), String> {
    let mut db = Store::default_path();
    let mut i = 0;
    while i < args.len() {
        if args[i] == "--" {
            break;
        }
        if args[i] == "--db" {
            if i + 1 >= args.len() {
                return Err("--db needs a path".into());
            }
            db = PathBuf::from(args.remove(i + 1));
            args.remove(i);
        } else if let Some(path) = args[i].strip_prefix("--db=") {
            db = PathBuf::from(path);
            args.remove(i);
        } else {
            i += 1;
        }
    }
    Ok((db, args))
}
fn option_value(args: &[String], i: &mut usize, flag: &str) -> Result<Option<String>, String> {
    let arg = &args[*i];
    if arg == flag {
        *i += 1;
        return args
            .get(*i)
            .cloned()
            .map(Some)
            .ok_or_else(|| format!("{flag} needs a value"));
    }
    Ok(arg.strip_prefix(&format!("{flag}=")).map(str::to_string))
}
fn usize_value(s: String, flag: &str) -> Result<usize, String> {
    s.parse()
        .map_err(|_| format!("{flag} needs a nonnegative integer"))
}
fn i64_value(s: String, flag: &str) -> Result<i64, String> {
    s.parse().map_err(|_| format!("{flag} needs an integer"))
}

fn parse_list(args: &[String], positional: bool) -> Result<(ListArgs, Vec<String>), String> {
    let mut filter = ListArgs::default();
    let mut rest = Vec::new();
    let mut i = 0;
    let mut end = false;
    while i < args.len() {
        if args[i] == "--" {
            end = true;
            i += 1;
            continue;
        }
        if !end {
            let mut matched = false;
            for flag in ["--project", "--agent", "--since", "--limit"] {
                if let Some(v) = option_value(args, &mut i, flag)? {
                    match flag {
                        "--project" => filter.project = Some(v),
                        "--agent" => filter.agents.push(v),
                        "--since" => filter.since = Some(v),
                        _ => filter.limit = Some(usize_value(v, flag)?),
                    }
                    matched = true;
                    break;
                }
            }
            if matched {
                i += 1;
                continue;
            }
            if args[i] == "--starred" {
                filter.starred = true;
                i += 1;
                continue;
            }
            if args[i].starts_with('-') {
                return Err(format!("unknown option: {}", args[i]));
            }
        }
        rest.push(args[i].clone());
        i += 1;
    }
    if !positional && !rest.is_empty() {
        return Err(format!("unexpected argument: {}", rest[0]));
    }
    Ok((filter, rest))
}

fn parse_show(args: &[String]) -> Result<ShowArgs, String> {
    let mut show = ShowArgs::default();
    let mut i = 0;
    while i < args.len() {
        if args[i] == "--tools" {
            show.include_tools = true;
            i += 1;
            continue;
        }
        if args[i] == "--thinking" {
            show.include_thinking = true;
            i += 1;
            continue;
        }
        let mut matched = false;
        for flag in [
            "--subagent",
            "--from",
            "--messages",
            "--chars",
            "--message-chars",
        ] {
            if let Some(v) = option_value(args, &mut i, flag)? {
                match flag {
                    "--subagent" => show.subagent = Some(v),
                    "--from" => show.from_seq = Some(i64_value(v, flag)?),
                    "--messages" => show.max_messages = Some(usize_value(v, flag)?),
                    "--chars" => show.max_chars = Some(usize_value(v, flag)?),
                    _ => show.max_message_chars = Some(usize_value(v, flag)?),
                }
                matched = true;
                break;
            }
        }
        if matched {
            i += 1;
            continue;
        }
        if args[i].starts_with('-') {
            return Err(format!("unknown option: {}", args[i]));
        }
        if !show.key.is_empty() {
            return Err("show accepts one key".into());
        }
        show.key = args[i].clone();
        i += 1;
    }
    if show.key.is_empty() {
        return Err("show needs a session key".into());
    }
    Ok(show)
}

fn setup(db: &std::path::Path) -> String {
    let exe = env::current_exe().unwrap_or_else(|_| PathBuf::from("ronda-cli"));
    let mcp = exe.with_file_name(if cfg!(windows) {
        "ronda-mcp.exe"
    } else {
        "ronda-mcp"
    });
    format!("Ronda CLI: {}\nIndex: {}\n\nAdd to AGENTS.md or CLAUDE.md:\nBefore asking for repository history, run `{} sessions --project \"$PWD\"`, then `{} show <key>`. Search prior decisions with `{} search <query>`.\n\nMCP: {}\n",
        exe.display(), db.display(), exe.display(), exe.display(), exe.display(), mcp.display())
}

fn run() -> Result<String, (u8, String)> {
    let args: Vec<_> = env::args().skip(1).collect();
    let (db, args) = take_global(args).map_err(|e| (2, e))?;
    if args.is_empty() || args.iter().any(|s| s == "--help" || s == "-h") {
        return Ok(help().into());
    }
    if args.iter().any(|s| s == "--version" || s == "-V") {
        return Ok(format!("ronda-cli {}\n", env!("CARGO_PKG_VERSION")));
    }
    let (command, rest) = (&args[0], &args[1..]);
    if command == "setup" {
        if !rest.is_empty() {
            return Err((2, "setup takes no arguments".into()));
        }
        return Ok(setup(&db));
    }
    if command == "index" {
        if !rest.is_empty() {
            return Err((2, "index takes no arguments".into()));
        }
        if db.exists() {
            return Ok(format!(
                "Index already exists at {}; Ronda maintains it.\n",
                db.display()
            ));
        }
        let mut store = Store::open(&db).map_err(|e| (1, e.to_string()))?;
        let report = Scanner::new(Scanner::default_home())
            .scan(&mut store, true)
            .map_err(|e| (1, e.to_string()))?;
        return Ok(format!(
            "Indexed {} of {} discovered sessions ({} errors).\n",
            report.indexed,
            report.discovered,
            report.errors.len()
        ));
    }
    let store = Store::open_existing_read_only(&db).map_err(|e| {
        (
            2,
            format!(
                "index unavailable at {}: {e}; launch Ronda or run `ronda-cli index`",
                db.display()
            ),
        )
    })?;
    match command.as_str() {
        "search" => {
            let (filter, words) = parse_list(rest, true).map_err(|e| (2, e))?;
            if words.is_empty() {
                return Err((2, "search needs a query".into()));
            }
            query::search(
                &store,
                &SearchArgs {
                    query: words.join(" "),
                    filter,
                },
            )
            .map_err(|e| (1, e.to_string()))
        }
        "sessions" => {
            let (filter, _) = parse_list(rest, false).map_err(|e| (2, e))?;
            query::list_sessions(&store, &filter).map_err(|e| (1, e.to_string()))
        }
        "show" => {
            let show = parse_show(rest).map_err(|e| (2, e))?;
            query::get_session(&store, &show).map_err(|e| (1, e.to_string()))
        }
        "projects" => {
            let (filter, _) = parse_list(rest, false).map_err(|e| (2, e))?;
            if filter.project.is_some() || !filter.agents.is_empty() || filter.starred {
                return Err((2, "projects only accepts --since and --limit".into()));
            }
            query::list_projects(&store, filter.since.as_deref(), filter.limit)
                .map_err(|e| (1, e.to_string()))
        }
        "insights" => {
            let (filter, _) = parse_list(rest, false).map_err(|e| (2, e))?;
            if !filter.agents.is_empty() || filter.starred || filter.limit.is_some() {
                return Err((2, "insights only accepts --project and --since".into()));
            }
            query::insights(
                &store,
                &InsightsArgs {
                    project: filter.project,
                    since: filter.since,
                },
            )
            .map_err(|e| (1, e.to_string()))
        }
        "errors" => {
            if rest.is_empty() {
                return Err((2, "errors needs the error text".into()));
            }
            let words: Vec<&str> = rest
                .iter()
                .map(String::as_str)
                .filter(|w| *w != "--")
                .collect();
            query::find_error(
                &store,
                &FindErrorArgs {
                    error: words.join(" "),
                },
            )
            .map_err(|e| (1, e.to_string()))
        }
        _ => Err((2, format!("unknown command: {command}"))),
    }
}

fn main() -> ExitCode {
    match run() {
        Ok(output) => {
            let mut stdout = io::stdout().lock();
            let output = if output.ends_with('\n') {
                output
            } else {
                format!("{output}\n")
            };
            match stdout.write_all(output.as_bytes()) {
                Ok(()) => ExitCode::SUCCESS,
                Err(e) if e.kind() == io::ErrorKind::BrokenPipe => ExitCode::SUCCESS,
                Err(e) => {
                    eprintln!("ronda-cli: {e}");
                    ExitCode::from(1)
                }
            }
        }
        Err((code, e)) => {
            eprintln!("ronda-cli: {e}");
            ExitCode::from(code)
        }
    }
}
