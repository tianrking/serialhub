//! Local microbenchmark, not a hardware or end-to-end throughput test.
//! Run with: cargo run --locked --example ledger_query_bench

use std::{hint::black_box, time::Instant};

use serialhub::ledger::{EventPayload, EventQuery, Ledger, MemoryOptions};

fn main() {
    let ledger = Ledger::memory(MemoryOptions::default()).unwrap();
    for _ in 0..65_536 {
        ledger.append(1, EventPayload::rx(b"sample")).unwrap();
    }
    let query = EventQuery {
        after_seq: 65_336,
        limit: 200,
        ..EventQuery::default()
    };
    for _ in 0..100 {
        black_box(ledger.query(query.clone()));
    }
    let started = Instant::now();
    for _ in 0..2_000 {
        black_box(ledger.query(query.clone()));
    }
    println!(
        "2000 recent-page queries: {:.2} ms",
        started.elapsed().as_secs_f64() * 1000.0
    );
}
