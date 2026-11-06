use ronda_core::{
    query::{self, FindErrorArgs, InsightsArgs, ListArgs, SearchArgs, ShowArgs},
    AgentId, Store,
};
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    env,
    io::{self, BufRead, Write},
    path::PathBuf,
    process::ExitCode,
};

#[derive(Deserialize)]
struct ProjectsArgs {
    since: Option<String>,
    limit: Option<usize>,
    #[serde(default)]
    reverse: bool,
}

const TIME_FORMATS: &str = "a duration such as 30m, 12h, 7d, or 2w (that long ago), a date such as 2026-01-31, a local time such as 2026-01-31 14:30, or an RFC 3339 timestamp";

fn since_property() -> Value {
    json!({"type":"string","description":format!("Only sessions at or after this time: {TIME_FORMATS}.")})
}

fn until_property() -> Value {
    json!({"type":"string","description":format!("Only sessions at or before this time: {TIME_FORMATS}. A bare date includes that whole local day.")})
}

fn limit_property(bounds: (usize, usize)) -> Value {
    json!({"type":"integer","minimum":bounds.0,"maximum":bounds.1,"description":format!("Maximum results, {} to {}; values outside the range are clamped.", bounds.0, bounds.1)})
}

fn size_property(what: &str, bounds: (usize, usize)) -> Value {
    json!({"type":"integer","minimum":bounds.0,"maximum":bounds.1,"description":format!("{what}, {} to {}; values outside the range are clamped.", bounds.0, bounds.1)})
}

fn agents_property() -> Value {
    let ids: Vec<&str> = AgentId::ALL.iter().map(|a| a.as_str()).collect();
    json!({"type":"array","items":{"type":"string"},"description":format!("Only these agents. Valid ids: {}.", ids.join(", "))})
}

fn tools() -> Value {
    json!([
        {"name":"ronda_search","description":"Search indexed coding-agent sessions and return message references.","inputSchema":{"type":"object","properties":{"query":{"type":"string"},"project":{"type":"string"},"agents":agents_property(),"since":since_property(),"until":until_property(),"limit":limit_property(query::SEARCH_LIMIT),"starred":{"type":"boolean"}},"required":["query"]}},
        {"name":"ronda_list_sessions","description":"List recent sessions by project, agent, or time.","inputSchema":{"type":"object","properties":{"project":{"type":"string"},"agents":agents_property(),"since":since_property(),"until":until_property(),"limit":limit_property(query::SESSIONS_LIMIT),"starred":{"type":"boolean"},"reverse":{"type":"boolean"}}}},
        {"name":"ronda_get_session","description":"Read a paginated transcript by session key or ronda:// reference; select an indexed child with subagent, or use * to list children.","inputSchema":{"type":"object","properties":{"key":{"type":"string"},"subagent":{"type":"string"},"from_seq":{"type":"integer","minimum":0,"description":"Message sequence number to start from."},"max_messages":size_property("Maximum messages to return", query::SHOW_MESSAGES),"max_chars":size_property("Maximum characters in the whole transcript", query::SHOW_CHARS),"max_message_chars":size_property("Maximum characters per message", query::SHOW_MESSAGE_CHARS),"include_tools":{"type":"boolean"},"include_thinking":{"type":"boolean"}},"required":["key"]}},
        {"name":"ronda_list_projects","description":"List indexed projects with session counts.","inputSchema":{"type":"object","properties":{"since":since_property(),"limit":limit_property(query::PROJECTS_LIMIT),"reverse":{"type":"boolean"}}}},
        {"name":"ronda_insights","description":"Summarize coding sessions: where time went, agent failures, recurring errors, tech stack, and how sessions ended. since defaults to 30d; use all for all time.","inputSchema":{"type":"object","properties":{"project":{"type":"string"},"since":{"type":"string","description":format!("Start of the range, default 30d: all for all time, {TIME_FORMATS}.")}}}},
        {"name":"ronda_find_error","description":"Before fixing an error, check whether earlier sessions hit the same one and how they ended. Pass the error message or failing output.","inputSchema":{"type":"object","properties":{"error":{"type":"string"}},"required":["error"]}}
    ])
}

enum CallError {
    Invalid(String),
    Tool(String),
}

fn parsed<T: DeserializeOwned>(args: Value) -> Result<T, CallError> {
    serde_json::from_value(args).map_err(|e| CallError::Invalid(e.to_string()))
}

fn validate_filter(a: &ListArgs) -> Result<(), CallError> {
    let invalid = |e: anyhow::Error| CallError::Invalid(e.to_string());
    query::validate_project(a.project.as_deref()).map_err(invalid)?;
    query::validate_agents(&a.agents).map_err(invalid)?;
    query::validate_since(a.since.as_deref()).map_err(invalid)?;
    query::validate_until(a.until.as_deref()).map_err(invalid)
}

fn reject_unknown_arguments(name: &str, args: &Value) -> Result<(), CallError> {
    let roster = tools();
    let Some(properties) = roster
        .as_array()
        .and_then(|all| all.iter().find(|t| t["name"] == name))
        .and_then(|t| t["inputSchema"]["properties"].as_object())
    else {
        return Ok(());
    };
    let Some(given) = args.as_object() else {
        return Ok(());
    };
    match given.keys().find(|k| !properties.contains_key(*k)) {
        Some(unknown) => Err(CallError::Invalid(format!(
            "unknown argument `{unknown}`; valid: {}",
            properties.keys().cloned().collect::<Vec<_>>().join(", ")
        ))),
        None => Ok(()),
    }
}

/// Puts a `Note:` line for each clamped size argument ahead of the tool text.
fn with_notes(notes: Vec<Option<String>>, text: String) -> String {
    let notes: String = notes
        .into_iter()
        .flatten()
        .map(|note| format!("Note: {note}\n"))
        .collect();
    if notes.is_empty() {
        text
    } else {
        format!("{notes}\n{text}")
    }
}

fn answer(store: &Store, name: &str, args: Value) -> Result<String, CallError> {
    if !args.is_object() {
        return Err(CallError::Invalid("arguments must be an object".into()));
    }
    reject_unknown_arguments(name, &args)?;
    match name {
        "ronda_search" => {
            let a: SearchArgs = parsed(args)?;
            query::validate_search_text(&a.query).map_err(|e| CallError::Invalid(e.to_string()))?;
            validate_filter(&a.filter)?;
            query::validate_window(a.filter.since.as_deref(), a.filter.until.as_deref())
                .map_err(|e| CallError::Invalid(e.to_string()))?;
            let notes = vec![query::clamp_note(
                "limit",
                a.filter.limit,
                query::SEARCH_LIMIT,
            )];
            query::search(store, &a)
                .map(|text| with_notes(notes, text))
                .map_err(|e| CallError::Tool(e.to_string()))
        }
        "ronda_list_sessions" => {
            let a: ListArgs = parsed(args)?;
            validate_filter(&a)?;
            let notes = vec![query::clamp_note("limit", a.limit, query::SESSIONS_LIMIT)];
            query::list_sessions(store, &a)
                .map(|text| with_notes(notes, text))
                .map_err(|e| CallError::Tool(e.to_string()))
        }
        "ronda_get_session" => {
            let key = args.get("key").and_then(Value::as_str);
            if key.is_none_or(|k| k.trim().is_empty()) {
                return Err(CallError::Invalid("missing session key".into()));
            }
            let a = parsed::<ShowArgs>(args)?;
            if a.from_seq.is_some_and(|n| n < 0) {
                return Err(CallError::Invalid(
                    "from_seq must be a nonnegative integer".into(),
                ));
            }
            let notes = vec![
                query::clamp_note("max_messages", a.max_messages, query::SHOW_MESSAGES),
                query::clamp_note("max_chars", a.max_chars, query::SHOW_CHARS),
                query::clamp_note(
                    "max_message_chars",
                    a.max_message_chars,
                    query::SHOW_MESSAGE_CHARS,
                ),
            ];
            query::get_session(store, &a)
                .map(|text| with_notes(notes, text))
                .map_err(|e| CallError::Tool(e.to_string()))
        }
        "ronda_list_projects" => {
            let a: ProjectsArgs = parsed(args)?;
            query::validate_since(a.since.as_deref())
                .map_err(|e| CallError::Invalid(e.to_string()))?;
            let notes = vec![query::clamp_note("limit", a.limit, query::PROJECTS_LIMIT)];
            query::list_projects_ordered(store, a.since.as_deref(), a.limit, a.reverse)
                .map(|text| with_notes(notes, text))
                .map_err(|e| CallError::Tool(e.to_string()))
        }
        "ronda_insights" => {
            let a: InsightsArgs = parsed(args)?;
            query::validate_project(a.project.as_deref())
                .map_err(|e| CallError::Invalid(e.to_string()))?;
            if a.since.as_deref() != Some("all") {
                query::validate_since(a.since.as_deref())
                    .map_err(|e| CallError::Invalid(e.to_string()))?;
            }
            query::insights(store, &a).map_err(|e| CallError::Tool(e.to_string()))
        }
        "ronda_find_error" => {
            let a: FindErrorArgs = parsed(args)?;
            query::validate_search_text(&a.error).map_err(|e| CallError::Invalid(e.to_string()))?;
            query::find_error(store, &a).map_err(|e| CallError::Tool(e.to_string()))
        }
        _ => Err(CallError::Invalid(format!("unknown tool: {name}"))),
    }
}

const SUPPORTED_PROTOCOLS: [&str; 2] = ["2024-11-05", "2025-03-26"];
const LATEST_PROTOCOL: &str = "2025-03-26";

fn reply(store: &Store, req: Value) -> Option<Value> {
    let id = req.get("id")?.clone();
    let method = req.get("method").and_then(Value::as_str).unwrap_or("");
    let result = match method {
        "initialize" => {
            let protocol = req
                .get("params")
                .and_then(|p| p.get("protocolVersion"))
                .and_then(Value::as_str)
                .filter(|v| SUPPORTED_PROTOCOLS.contains(v))
                .unwrap_or(LATEST_PROTOCOL);
            json!({"protocolVersion":protocol,"capabilities":{"tools":{}},"serverInfo":{"name":"ronda-mcp","version":env!("CARGO_PKG_VERSION")}})
        }
        "ping" => json!({}),
        "resources/list" => json!({"resources":[]}),
        "prompts/list" => json!({"prompts":[]}),
        "resources/templates/list" => json!({"resourceTemplates":[]}),
        "tools/list" => json!({"tools":tools()}),
        "tools/call" => {
            let params = req.get("params").cloned().unwrap_or(Value::Null);
            let name = params.get("name").and_then(Value::as_str).unwrap_or("");
            let args = params
                .get("arguments")
                .cloned()
                .unwrap_or_else(|| json!({}));
            match answer(store, name, args) {
                Ok(text) => json!({"content":[{"type":"text","text":text}]}),
                Err(CallError::Tool(e)) => {
                    json!({"content":[{"type":"text","text":e}],"isError":true})
                }
                Err(CallError::Invalid(e)) => {
                    return Some(
                        json!({"jsonrpc":"2.0","id":id,"error":{"code":-32602,"message":e}}),
                    )
                }
            }
        }
        _ => {
            return Some(
                json!({"jsonrpc":"2.0","id":id,"error":{"code":-32601,"message":format!("method not found: {method}")}}),
            )
        }
    };
    Some(json!({"jsonrpc":"2.0","id":id,"result":result}))
}

fn handle_line(store: &Store, line: &str) -> Option<Value> {
    if line.trim().is_empty() {
        return None;
    }
    match serde_json::from_str::<Value>(line) {
        Ok(request) => reply(store, request),
        Err(e) => {
            Some(json!({"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":e.to_string()}}))
        }
    }
}

fn run() -> Result<(), (u8, String)> {
    let args: Vec<String> = env::args().skip(1).collect();
    let db = match args.as_slice() {
        [] => Store::default_path(),
        [flag, path] if flag == "--db" => PathBuf::from(path),
        [flag] if flag.starts_with("--db=") => PathBuf::from(&flag[5..]),
        _ => return Err((2, "usage: ronda-mcp [--db PATH]".into())),
    };
    let store = Store::open_existing_read_only(&db).map_err(|e| {
        (
            2,
            format!(
                "index unavailable at {}: {e}; launch Ronda or run `ronda-cli index`",
                db.display()
            ),
        )
    })?;
    let stdin = io::stdin();
    let mut stdout = io::stdout().lock();
    for line in stdin.lock().lines() {
        let line = line.map_err(|e| (1, e.to_string()))?;
        if let Some(response) = handle_line(&store, &line) {
            serde_json::to_writer(&mut stdout, &response).map_err(|e| (1, e.to_string()))?;
            stdout.write_all(b"\n").map_err(|e| (1, e.to_string()))?;
            stdout.flush().map_err(|e| (1, e.to_string()))?;
        }
    }
    Ok(())
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err((code, e)) => {
            eprintln!("ronda-mcp: {e}");
            ExitCode::from(code)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn handshake_and_tool_roster() {
        let path = std::env::temp_dir().join(format!("ronda-mcp-test-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let store = Store::open(&path).unwrap();
        let init = reply(
            &store,
            json!({"jsonrpc":"2.0","id":1,"method":"initialize"}),
        )
        .unwrap();
        assert_eq!(init["result"]["serverInfo"]["name"], "ronda-mcp");
        assert_eq!(init["result"]["protocolVersion"], "2025-03-26");
        let list = reply(
            &store,
            json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}),
        )
        .unwrap();
        assert_eq!(list["result"]["tools"].as_array().unwrap().len(), 6);
        for (method, key) in [
            ("resources/list", "resources"),
            ("prompts/list", "prompts"),
            ("resources/templates/list", "resourceTemplates"),
        ] {
            let empty = reply(&store, json!({"jsonrpc":"2.0","id":3,"method":method})).unwrap();
            assert!(empty.get("error").is_none(), "{method}");
            assert_eq!(empty["result"][key], json!([]), "{method}");
        }
        let no_reply = reply(
            &store,
            json!({"jsonrpc":"2.0","method":"notifications/initialized"}),
        );
        assert!(no_reply.is_none());
        drop(store);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn initialize_echoes_supported_protocol_versions() {
        let store = Store::open(std::path::Path::new(":memory:")).unwrap();
        let version = |requested: Value| {
            let req = json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":requested}});
            reply(&store, req).unwrap()["result"]["protocolVersion"].clone()
        };
        assert_eq!(version(json!("2024-11-05")), "2024-11-05");
        assert_eq!(version(json!("2025-03-26")), "2025-03-26");
        assert_eq!(version(json!("bogus")), "2025-03-26");
        assert_eq!(version(json!(7)), "2025-03-26");
    }

    #[test]
    fn tool_schemas_state_formats_ranges_and_agent_ids() {
        let path = std::env::temp_dir().join(format!("ronda-mcp-schema-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let store = Store::open(&path).unwrap();
        let list = reply(
            &store,
            json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}),
        )
        .unwrap();
        let tools = list["result"]["tools"].as_array().unwrap();
        let props = |name: &str| {
            tools.iter().find(|t| t["name"] == name).unwrap()["inputSchema"]["properties"].clone()
        };
        let search = props("ronda_search");
        assert_eq!(search["limit"]["minimum"], 1);
        assert_eq!(search["limit"]["maximum"], 30);
        let agents = search["agents"]["description"].as_str().unwrap();
        for id in AgentId::ALL {
            assert!(agents.contains(id.as_str()), "{agents}");
        }
        assert!(search["agents"].get("enum").is_none() && search["items"].is_null());
        for field in ["since", "until"] {
            let d = search[field]["description"].as_str().unwrap();
            assert!(
                d.contains("30m") && d.contains("2026-01-31") && d.contains("RFC 3339"),
                "{d}"
            );
        }
        let show = props("ronda_get_session");
        assert_eq!(show["max_chars"]["minimum"], 200);
        assert_eq!(show["max_chars"]["maximum"], 100_000);
        assert_eq!(show["max_messages"]["maximum"], 200);
        assert_eq!(show["max_message_chars"]["minimum"], 100);
        assert_eq!(props("ronda_list_sessions")["limit"]["maximum"], 100);
        assert_eq!(props("ronda_list_projects")["limit"]["maximum"], 200);
        drop(store);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn invalid_parameters_and_a_missing_key_are_protocol_errors() {
        let path = std::env::temp_dir().join(format!("ronda-mcp-errors-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let store = Store::open(&path).unwrap();
        for (name, arguments) in [
            ("ronda_search", json!({"query": 4})),
            ("ronda_search", json!({"query": " "})),
            ("ronda_find_error", json!({"error": "  "})),
            ("ronda_list_sessions", json!({"since": "yesterdayish"})),
            ("ronda_list_sessions", json!({"until": "yesterdayish"})),
            ("ronda_list_sessions", json!({"agents": ["nope"]})),
            ("ronda_search", json!({"query": "x", "until": "30x"})),
            ("ronda_search", json!({"query": "x", "agents": ["nope"]})),
            ("ronda_search", json!({"query": "x", "agent": "codex"})),
            ("ronda_list_projects", json!({"project": "/p"})),
            ("ronda_list_sessions", json!({"project": "./x"})),
            ("ronda_search", json!({"query": "x", "project": ".."})),
            ("ronda_insights", json!({"project": "../x"})),
            ("unknown_tool", json!({})),
        ] {
            let response = reply(&store, json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":name,"arguments":arguments}})).unwrap();
            assert_eq!(response["error"]["code"], -32602);
        }
        for (name, arguments) in [
            ("ronda_search", json!({"query": "x", "agents": ["codex"]})),
            ("ronda_list_projects", json!({"limit": 3})),
        ] {
            let ok = reply(&store, json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":name,"arguments":arguments}})).unwrap();
            assert!(ok.get("error").is_none(), "{ok}");
        }
        let missing = reply(&store, json!({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"ronda_get_session","arguments":{}}})).unwrap();
        assert_eq!(missing["error"]["code"], -32602);
        drop(store);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn clamped_arguments_are_noted_in_the_result_text() {
        let path = std::env::temp_dir().join(format!("ronda-mcp-clamp-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let store = Store::open(&path).unwrap();
        let text = |name: &str, arguments: Value| {
            let r = reply(&store, json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":name,"arguments":arguments}})).unwrap();
            r["result"]["content"][0]["text"]
                .as_str()
                .unwrap()
                .to_string()
        };
        let clamped = text("ronda_list_sessions", json!({"limit": 500}));
        assert!(
            clamped.starts_with("Note: limit 500 clamped to 100\n"),
            "{clamped}"
        );
        assert!(!text("ronda_list_sessions", json!({"limit": 3})).contains("Note:"));
        assert!(text("ronda_search", json!({"query": "x", "limit": 500}))
            .contains("Note: limit 500 clamped to 30"));
        assert!(text("ronda_list_projects", json!({"limit": 500}))
            .contains("Note: limit 500 clamped to 200"));
        drop(store);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn blank_lines_are_skipped_and_bad_json_is_a_parse_error() {
        let path = std::env::temp_dir().join(format!("ronda-mcp-lines-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let store = Store::open(&path).unwrap();
        assert!(handle_line(&store, "   ").is_none());
        assert!(handle_line(&store, "").is_none());
        let bad = handle_line(&store, "{bad").unwrap();
        assert_eq!(bad["error"]["code"], -32700);
        drop(store);
        let _ = std::fs::remove_file(&path);
    }
}
