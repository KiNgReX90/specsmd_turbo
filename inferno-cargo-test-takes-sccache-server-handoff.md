# Handoff: the flow's real cargo test starts the machine's sccache server on its own throwaway cache

Found 2026-11-18 on Delta, the machine Skoft_CRA's intents build from. For as long as the server stood, every Rust build on the machine compiled against an empty cache.

## What is wrong

`run-mutate-cargo.test.cjs:109`, "a real cargo batch shares its build across the switches and gives honest verdicts", runs `run.cjs mutate` on a small crate with real cargo. Its environment is the process's own plus `XDG_CACHE_HOME: <temp>/cache`, which keeps the flow's own cache out of the real one.

A host may give cargo a rustc wrapper that is sccache, in `~/.cargo/config.toml`. sccache is one server per machine on one port, started by the first compile that finds none, and it takes its settings from that compile's environment. Its local cache folder is `$XDG_CACHE_HOME/sccache`. So when the test's compile is the first after the server idled out, the server starts on `<temp>/cache/sccache` and keeps that folder for as long as it lives, long after the test removed its temp folder. Every later build on the machine, of any session and any repository, talks to that server: no hits from the real cache, and nothing it compiles is stored where a later server would find it.

The host's part is none: a shared rustc wrapper is an ordinary setup, and the test is what changes the cache home under it.

## Evidence

- Delta, 2026-11-18 00:20Z, `sccache --show-stats`: `Cache location  Local disk: "/tmp/inferno-tests-HblReS/inferno-mutate-cargo-vfzPh2/cache/sccache"`, `Compile requests 614`, `Cache hits 0`, `Cache misses 462`, `Cache size 364 MiB`.
- The server, pid 4143810, started at 2026-11-18 00:00:54Z. `/tmp/inferno-tests-HblReS/inferno-mutate-cargo-vfzPh2` still stood at 00:20Z, with no test of the flow running.
- Delta's real cache, `~/.cache/sccache`, 16 GiB, served nothing in that time.
- Delta, `~/.cargo/config.toml`: `rustc-wrapper = "/home/ruben/.local/bin/rustc-cached"`, which runs sccache.
- `inferno-mutate-cargo-` is the prefix of `run-mutate-cargo.test.cjs:80`. No other test of the flow runs real cargo.
- It came back the same day. Delta, 2026-11-18 06:50Z: the first server was gone and a new one stood, pid 3452344, started 06:09:10Z, with `XDG_CACHE_HOME=/tmp/inferno-tests-mqN4dJ/inferno-mutate-cargo-VRIk1p/cache` and `SCCACHE_START_SERVER=1` in `/proc/3452344/environ`. The host's lead saw two `rustc` of another tree's build run through it at 06:27Z. So it recurs each time the server idles out before a run of the host's flow tests.
- Read the server without touching it: `pgrep -x sccache`, then `tr '\0' '\n' < /proc/<pid>/environ | grep XDG_CACHE_HOME`. `sccache --show-stats` starts a server when none runs, with the caller's environment.

## How to fix

The test's crate has no dependency and builds in its own target folder, so it needs no cache. Run it without the host's wrapper: add `RUSTC_WRAPPER: ''` and `CARGO_BUILD_RUSTC_WRAPPER: ''` to the environment at `run-mutate-cargo.test.cjs:109`. Cargo reads an empty `RUSTC_WRAPPER` as no wrapper, over what the config says. Checked on Delta with cargo's `-v`: with both keys empty the `Running` line starts with the toolchain's `rustc`, and the wrapper is not in it. The test then never reaches the server, started or not.

Do not give the test a server of its own on another port. That leaves a server process behind per run.

The pin is one assertion in the same test: write a `rustc` wrapper script into the temp folder that records each call to a file, name it in a `.cargo/config.toml` of the fixture crate as `build.rustc-wrapper`, and assert after the batch that the file was never written. Without the two keys the script records every compile.
