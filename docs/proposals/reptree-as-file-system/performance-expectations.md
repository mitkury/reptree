# Performance Goals & Benchmarks for the RepTree‑Based Virtual File‑System

Date: 2025‑04‑19  
Status: Draft

> This document establishes **quantitative targets** and the assumptions behind them.  
> It complements the design in *Virtual File‑System Layer on Top of RepTree* and the related proposals on state vectors, large‑child optimisation, and Yjs integration.
---

## 1 — Test Hardware Baseline

* Apple M1 / 16 GB RAM, or equivalent 2020‑era laptop  
* NVMe SSD (~3 GB/s sequential read)  
* Node ≥ 20

All numbers below assume **release builds** with snapshots & logs stored on the local SSD.  
Remote blob fetches are excluded—those are network‑bound.

---

## 2 — Startup / Load Targets

| Scenario | Dataset | Goal |
|----------|---------|------|
| **Cold start** (first run) | FS tree = 100 k vertices, 3 MB gz snapshot, 200 kB ops tail | **\< 70 ms** to the first interactive paint |
| **Sub‑doc open** (`file‑tree`) | 20 k vertices, 600 kB snapshot | **\< 20 ms** to fully hydrated `RepTree` |
| **Mount preload** | same as above, background thread | Does not block UI; ≤ 20% idle CPU |

---

## 3 — Memory Footprint

| Component | Budget |
|-----------|--------|
| Core FS tree (loaded permanently) | ≤ 10 MB RSS |
| Each cached sub‑tree (`file‑tree`) | ≤ 5 MB RSS |
| **MAX_OPEN = 20** (default) | ≤ 120 MB total |

LRU eviction keeps RSS stable regardless of workspace size. Hybrid child storage avoids ballooning for directories with 10⁴ + children.

---

## 4 — Latency Targets (Hot Path)

| Operation | Payload | Target (p95) |
|-----------|---------|--------------|
| Path lookup (`/a/b/c`) | depth ≤ 10 | **\< 30 µs** |
| Add / move vertex | single op | **\< 50 µs** |
| Burst edit | 1 000 ops txn | **\< 3 ms** total |
| Large dir listing | 30 k children | **\< 25 ms** |

All figures measured with Node’s `perf_hooks.performance.now()` inside the same process.

---

## 5 — Sync & Networking

* **State‑vector handshake**: 1 RTT, payload ≤ 1 kB no matter workspace size.
* **Delta after 1 h offline (10 k ops)**:  
  * Transfer ≤ 100 kB compressed.  
  * Apply time ≤ 8 ms (`array.push` + map updates).

---

## 6 — Persistence Throughput

| Action | Trigger | Target |
|--------|---------|--------|
| Snapshot flush | every 2 k ops *or* 1 MB log | Background, ≤ 30 ms |
| Crash‑recovery replay | 10 k ops tail | **\< 40 ms** |

CRC‑32 footer per chunk guarantees corruption detection without costly checksums.

---

## 7 — Scaling Limits & De‑gradation

| Dimension | Soft limit | Mitigation |
|-----------|------------|------------|
| Children per vertex | 100 k | B‑tree storage + paging (proposal) |
| Ops per single tree | 5 M | Reduce `OPS_PER_SNAPSHOT` to 1 k; compact during idle |
| Concurrent cached trees | `MAX_OPEN` env var | Automatic LRU eviction |

Beyond soft limits the system still functions but latency rises linearly.

---

## 8 — Benchmark Methodology

1. **Synthetic generator**: expand `tests/fuzzyTests.ts` to create FS trees of configurable size, then measure:  
   ```bash
   node bench/fuzz-startup.js --vertices 100000 --ops-tail 20000
   ```
2. **Real‑world traces**: record live op streams and replay in a headless benchmark runner.
3. CI budget: run the **p50** subset (< 3 s total) on every pull request; run full p95 suite nightly.

---

## 9 — Future Work

* Automate **profiling flamegraphs** to catch regressions.  
* Add **Bloom‑filter cache** for “does peer have this tree?” queries (research).  
* Investigate **WebAssembly snapshot codec** for 2× faster (de)compression.

---

### TL;DR

With the current design the virtual FS should feel **instant** for everyday projects and scales into the low‑million‑node range with linear—yet still acceptable—costs in RAM and CPU.

