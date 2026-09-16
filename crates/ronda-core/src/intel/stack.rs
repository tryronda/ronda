//! Detects the technologies a session works with, from the files it touches and the commands it runs.
use super::tools::{ToolEvent, ToolKind};
use std::collections::{BTreeMap, HashSet};
use std::path::Path;

const EXTENSIONS: &[(&str, &str)] = &[
    ("ts", "TypeScript"),
    ("tsx", "TypeScript"),
    ("mts", "TypeScript"),
    ("cts", "TypeScript"),
    ("js", "JavaScript"),
    ("jsx", "JavaScript"),
    ("mjs", "JavaScript"),
    ("cjs", "JavaScript"),
    ("rs", "Rust"),
    ("py", "Python"),
    ("go", "Go"),
    ("rb", "Ruby"),
    ("java", "Java"),
    ("kt", "Kotlin"),
    ("kts", "Kotlin"),
    ("swift", "Swift"),
    ("c", "C"),
    ("h", "C"),
    ("cc", "C++"),
    ("cpp", "C++"),
    ("hpp", "C++"),
    ("cs", "C#"),
    ("php", "PHP"),
    ("sql", "SQL"),
    ("css", "CSS"),
    ("scss", "CSS"),
    ("html", "HTML"),
    ("vue", "Vue"),
    ("svelte", "Svelte"),
    ("ex", "Elixir"),
    ("exs", "Elixir"),
    ("dart", "Dart"),
    ("sh", "Shell"),
    ("zsh", "Shell"),
    ("tf", "Terraform"),
    ("prisma", "Prisma"),
    ("lua", "Lua"),
    ("zig", "Zig"),
    ("scala", "Scala"),
    ("astro", "Astro"),
];

// Matched against a file's name; the first entry that fits wins.
const FILES: &[(&str, &str)] = &[
    ("package.json", "Node.js"),
    ("Cargo.toml", "Rust"),
    ("pyproject.toml", "Python"),
    ("requirements.txt", "Python"),
    ("go.mod", "Go"),
    ("Gemfile", "Ruby"),
    ("Dockerfile", "Docker"),
    ("docker-compose", "Docker"),
    ("compose.yaml", "Docker"),
    ("tailwind.config", "Tailwind CSS"),
    ("vite.config", "Vite"),
    ("next.config", "Next.js"),
    ("tauri.conf", "Tauri"),
    ("bun.lock", "Bun"),
    ("pnpm-lock", "pnpm"),
    ("schema.prisma", "Prisma"),
    ("drizzle.config", "Drizzle"),
    ("wrangler.", "Cloudflare Workers"),
    ("vercel.json", "Vercel"),
    ("pubspec.yaml", "Flutter"),
    ("build.gradle", "Gradle"),
];

const COMMANDS: &[(&str, &str)] = &[
    ("bun", "Bun"),
    ("bunx", "Bun"),
    ("cargo", "Rust"),
    ("rustc", "Rust"),
    ("npm", "Node.js"),
    ("npx", "Node.js"),
    ("node", "Node.js"),
    ("pnpm", "pnpm"),
    ("yarn", "Yarn"),
    ("deno", "Deno"),
    ("python", "Python"),
    ("python3", "Python"),
    ("pip", "Python"),
    ("uv", "Python"),
    ("poetry", "Python"),
    ("pytest", "Python"),
    ("go", "Go"),
    ("ruby", "Ruby"),
    ("bundle", "Ruby"),
    ("rails", "Rails"),
    ("docker", "Docker"),
    ("kubectl", "Kubernetes"),
    ("terraform", "Terraform"),
    ("psql", "PostgreSQL"),
    ("sqlite3", "SQLite"),
    ("redis-cli", "Redis"),
    ("swift", "Swift"),
    ("xcodebuild", "Xcode"),
    ("gradle", "Gradle"),
    ("mvn", "Maven"),
    ("dotnet", ".NET"),
    ("flutter", "Flutter"),
    ("mix", "Elixir"),
    ("php", "PHP"),
    ("composer", "PHP"),
    ("vitest", "Vitest"),
    ("jest", "Jest"),
    ("playwright", "Playwright"),
    ("prisma", "Prisma"),
    ("wrangler", "Cloudflare Workers"),
    ("vercel", "Vercel"),
    ("supabase", "Supabase"),
    ("tauri", "Tauri"),
    ("vite", "Vite"),
    ("next", "Next.js"),
    ("tsc", "TypeScript"),
];

/// The programs a shell command runs, past `cd`, env assignments, and wrappers like `bash -lc`.
pub fn programs(command: &str) -> Vec<String> {
    command
        .split(['&', '|', ';', '\n', '(', ')'])
        .filter_map(|part| {
            let mut words = part.split_whitespace().map(|w| w.trim_matches(['"', '\'']));
            loop {
                let word = words.next()?;
                if word.contains('=')
                    || matches!(word, "sudo" | "time" | "env" | "exec" | "then" | "do")
                {
                    continue;
                }
                let name = word.rsplit('/').next().unwrap_or(word);
                if matches!(name, "bash" | "zsh" | "sh") {
                    continue;
                }
                if name.starts_with('-') {
                    continue;
                }
                return Some(name.to_owned());
            }
        })
        .collect()
}

/// Weight per technology: distinct files plus commands that point to it.
pub fn detect(events: &[ToolEvent]) -> BTreeMap<String, u32> {
    let mut hits = BTreeMap::<String, u32>::new();
    let mut seen_files = HashSet::new();
    for event in events {
        if let Some(path) = event
            .path
            .as_deref()
            .filter(|p| seen_files.insert(p.to_owned()))
        {
            let path = Path::new(path);
            let name = path
                .file_name()
                .map(|n| n.to_string_lossy())
                .unwrap_or_default();
            let ext = path
                .extension()
                .map(|e| e.to_string_lossy().to_ascii_lowercase());
            if let Some((_, tech)) = ext
                .as_deref()
                .and_then(|ext| EXTENSIONS.iter().find(|(e, _)| *e == ext))
            {
                *hits.entry((*tech).into()).or_default() += 1;
                if matches!(ext.as_deref(), Some("tsx" | "jsx")) {
                    *hits.entry("React".into()).or_default() += 1;
                }
            }
            if let Some((_, tech)) = FILES.iter().find(|(f, _)| name.starts_with(f)) {
                *hits.entry((*tech).into()).or_default() += 1;
            }
            if path.components().any(|c| c.as_os_str() == "workflows")
                && path.to_string_lossy().contains(".github")
            {
                *hits.entry("GitHub Actions".into()).or_default() += 1;
            }
        }
        if event.kind == ToolKind::Shell {
            for program in event.command.as_deref().map(programs).unwrap_or_default() {
                if let Some((_, tech)) = COMMANDS.iter().find(|(c, _)| *c == program) {
                    *hits.entry((*tech).into()).or_default() += 1;
                }
            }
        }
    }
    hits
}

#[cfg(test)]
mod tests {
    use super::*;

    fn edit(path: &str) -> ToolEvent {
        ToolEvent {
            seq: 0,
            kind: ToolKind::Edit,
            command: None,
            path: Some(path.into()),
            is_error: false,
            exit_code: None,
        }
    }
    fn shell(command: &str) -> ToolEvent {
        ToolEvent {
            seq: 0,
            kind: ToolKind::Shell,
            command: Some(command.into()),
            path: None,
            is_error: false,
            exit_code: None,
        }
    }

    #[test]
    fn files_and_commands() {
        let hits = detect(&[
            edit("/r/src/App.tsx"),
            edit("/r/src/App.tsx"),
            edit("/r/crates/core/Cargo.toml"),
            edit("/r/.github/workflows/ci.yml"),
            shell("cd site && bun run build && cargo test"),
            shell("FOO=1 /bin/zsh -lc 'pytest -q'"),
        ]);
        assert_eq!(hits.get("TypeScript"), Some(&1));
        assert_eq!(hits.get("React"), Some(&1));
        assert_eq!(hits.get("Rust"), Some(&2));
        assert_eq!(hits.get("Bun"), Some(&1));
        assert_eq!(hits.get("Python"), Some(&1));
        assert_eq!(hits.get("GitHub Actions"), Some(&1));
    }

    #[test]
    fn programs_skip_wrappers() {
        assert_eq!(
            programs("cd repo && NODE_ENV=test npx vitest run | tee out"),
            ["cd", "npx", "tee"]
        );
    }
}
