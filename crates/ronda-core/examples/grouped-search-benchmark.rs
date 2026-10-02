//! Measures the actual grouped desktop query on an index created by scripts/benchmark.py.
use ronda_core::{SearchSort, SessionQuery, Store};
use std::{path::Path, time::Instant};

fn main() -> anyhow::Result<()> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    anyhow::ensure!(
        (3..=4).contains(&args.len()),
        "usage: grouped-search-benchmark DB QUERY RUNS [FILTER_JSON]"
    );
    let runs: usize = args[2].parse()?;
    anyhow::ensure!(runs > 0, "RUNS must be positive");
    let store = Store::open_existing_read_only(Path::new(&args[0]))?;
    let filter = if let Some(json) = args.get(3) {
        serde_json::from_str(json)?
    } else {
        SessionQuery::default()
    };
    filter.validate()?;
    let page = store.session_page(&filter, 0, 100)?;
    let options = store.library_options()?;
    let mut pages = Vec::with_capacity(runs);
    let mut facets = Vec::with_capacity(runs);
    let first = store.search_grouped(&args[1], &filter, SearchSort::Relevance, 0, 50)?;
    anyhow::ensure!(
        first.total_sessions > 0,
        "fixture query returned no sessions"
    );
    let mut samples = Vec::with_capacity(runs);
    for _ in 0..runs {
        let start = Instant::now();
        let result = store.search_grouped(&args[1], &filter, SearchSort::Relevance, 0, 50)?;
        samples.push(start.elapsed().as_secs_f64() * 1000.0);
        let start = Instant::now();
        let next_page = store.session_page(&filter, 0, 100)?;
        pages.push(start.elapsed().as_secs_f64() * 1000.0);
        anyhow::ensure!(next_page.total == page.total, "unstable library count");
        let start = Instant::now();
        let next_options = store.library_options()?;
        facets.push(start.elapsed().as_secs_f64() * 1000.0);
        anyhow::ensure!(
            next_options.projects.len() == options.projects.len(),
            "unstable option count"
        );
        anyhow::ensure!(
            result.total_sessions == first.total_sessions,
            "unstable session count"
        );
    }
    samples.sort_by(f64::total_cmp);
    pages.sort_by(f64::total_cmp);
    facets.sort_by(f64::total_cmp);
    let p50 = samples[runs / 2];
    let p95 = samples[(runs * 95).div_ceil(100) - 1];
    println!(
        "{}",
        serde_json::json!({
            "runs":runs,"p50_ms":p50,"p95_ms":p95,"total_sessions":first.total_sessions,
            "total_message_matches":first.total_message_matches,"returned_sessions":first.groups.len(),
            "p95_under_100_ms":p95 < 100.0,
            "filter":filter,
            "library_page":{"p50_ms":pages[runs/2],"p95_ms":pages[(runs*95).div_ceil(100)-1],"total_sessions":page.total,"returned_sessions":page.items.len()},
            "library_options":{"p50_ms":facets[runs/2],"p95_ms":facets[(runs*95).div_ceil(100)-1],"projects":options.projects.len(),"models":options.models.len(),"hosts":options.hosts.len()},
            "scope":"warm grouped query on one read-only connection; excludes process startup and UI paint"
        })
    );
    Ok(())
}
