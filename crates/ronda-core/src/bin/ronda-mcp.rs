use ronda_core::{
    query::{self, FindErrorArgs, InsightsArgs, ListArgs, SearchArgs, ShowArgs},
    Store,
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
}

fn tools() -> Value {
    json!([
        {"name":"ronda_search","description":"Search indexed coding-agent sessions and return message references.","inputSchema":{"type":"object","properties":{"query":{"type":"string"},"project":{"type":"string"},"agents":{"type":"array","items":{"type":"string"}},"since":{"type":"string"},"limit":{"type":"integer"}},"required":["query"]}},
        {"name":"ronda_list_sessions","description":"List recent sessions by project, agent, or time.","inputSchema":{"type":"object","properties":{"project":{"type":"string"},"agents":{"type":"array","items":{"type":"string"}},"since":{"type":"string"},"limit":{"type":"integer"},"starred":{"type":"boolean"}}}},
        {"name":"ronda_get_session","description":"Read a paginated transcript by session key or ronda:// reference; select an indexed child with subagent, or use * to list children.","inputSchema":{"type":"object","properties":{"key":{"type":"string"},"subagent":{"type":"string"},"from_seq":{"type":"integer"},"max_messages":{"type":"integer"},"max_chars":{"type":"integer"},"max_message_chars":{"type":"integer"},"include_tools":{"type":"boolean"},"include_thinking":{"type":"boolean"}},"required":["key"]}},
        {"name":"ronda_list_projects","description":"List indexed projects with session counts.","inputSchema":{"type":"object","properties":{"since":{"type":"string"},"limit":{"type":"integer"}}}},
        {"name":"ronda_insights","description":"Summarize coding sessions: where time went, agent failures, recurring errors, tech stack, and how sessions ended. since defaults to 30d; use all for all time.","inputSchema":{"type":"object","properties":{"project":{"type":"string"},"since":{"type":"string"}}}},
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

fn answer(store: &Store, name: &str, args: Value) -> Result<String, CallError> {
    if !args.is_object() {
        return Err(CallError::Invalid("arguments must be an object".into()));
    }
    match name {
        "ronda_search" => {
            let a: SearchArgs = parsed(args)?;
            query::validate_since(a.filter.since.as_deref())
                .map_err(|e| CallError::Invalid(e.to_string()))?;
            query::search(store, &a).map_err(|e| CallError::Tool(e.to_string()))
        }
        "ronda_list_sessions" => {
            let a: ListArgs = parsed(args)?;
            query::validate_since(a.since.as_deref())
                .map_err(|e| CallError::Invalid(e.to_string()))?;
            query::list_sessions(store, &a).map_err(|e| CallError::Tool(e.to_string()))
        }
        "ronda_get_session" => {
            if args.get("key").is_none() {
                return Err(CallError::Tool("missing session key".into()));
            }
            query::get_session(store, &parsed::<ShowArgs>(args)?)
                .map_err(|e| CallError::Tool(e.to_string()))
        }
        "ronda_list_projects" => {
            let a: ProjectsArgs = parsed(args)?;
            query::validate_since(a.since.as_deref())
                .map_err(|e| CallError::Invalid(e.to_string()))?;
            query::list_projects(store, a.since.as_deref(), a.limit)
                .map_err(|e| CallError::Tool(e.to_string()))
        }
        "ronda_insights" => {
            let a: InsightsArgs = parsed(args)?;
            if a.since.as_deref() != Some("all") {
                query::validate_since(a.since.as_deref())
                    .map_err(|e| CallError::Invalid(e.to_string()))?;
            }
            query::insights(store, &a).map_err(|e| CallError::Tool(e.to_string()))
        }
        "ronda_find_error" => query::find_error(store, &parsed::<FindErrorArgs>(args)?)
            .map_err(|e| CallError::Tool(e.to_string())),
        _ => Err(CallError::Invalid(format!("unknown tool: {name}"))),
    }
}

fn reply(store: &Store, req: Value) -> Option<Value> {
    let id = req.get("id")?.clone();
    let method = req.get("method").and_then(Value::as_str).unwrap_or("");
    let result = match method {
        "initialize" => {
            json!({"protocolVersion":"2025-03-26","capabilities":{"tools":{}},"serverInfo":{"name":"ronda-mcp","version":env!("CARGO_PKG_VERSION")}})
        }
        "ping" => json!({}),
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
        let response = match serde_json::from_str::<Value>(&line) {
            Ok(request) => reply(&store, request),
            Err(e) => Some(
                json!({"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":e.to_string()}}),
            ),
        };
        if let Some(response) = response {
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
        let list = reply(
            &store,
            json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}),
        )
        .unwrap();
        assert_eq!(list["result"]["tools"].as_array().unwrap().len(), 6);
        let no_reply = reply(
            &store,
            json!({"jsonrpc":"2.0","method":"notifications/initialized"}),
        );
        assert!(no_reply.is_none());
        drop(store);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn invalid_parameters_are_protocol_errors_but_missing_key_is_tool_error() {
        let path = std::env::temp_dir().join(format!("ronda-mcp-errors-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let store = Store::open(&path).unwrap();
        for (name, arguments) in [
            ("ronda_search", json!({"query": 4})),
            ("ronda_list_sessions", json!({"since": "yesterdayish"})),
            ("unknown_tool", json!({})),
        ] {
            let response = reply(&store, json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":name,"arguments":arguments}})).unwrap();
            assert_eq!(response["error"]["code"], -32602);
        }
        let missing = reply(&store, json!({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"ronda_get_session","arguments":{}}})).unwrap();
        assert_eq!(missing["result"]["isError"], true);
        drop(store);
        let _ = std::fs::remove_file(&path);
    }
}
