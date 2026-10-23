# Strata conversation cache for Little Bot

The installed server at the time of Little Bot 0.45.0 is Strata 0.2.2 (engine 0.1.47) with the SSD conversation-cache patch rebuilt for it (`C:\Strata\update-v0.2.2\ssd-conversation-cache-0.2.2.patch`, kept outside this repository). The versioned patches below are the earlier ones.

Little Bot sends standard Chat Completions requests with complete histories. Strata automatically matches compatible token/image prefixes; no custom `strata_cache_slot` is sent. Official releases since 0.1.30 support RAM parking. The local **0.1.44.1** engine adds SSD storage through [ssd-conversation-cache-0.1.44.1.patch](ssd-conversation-cache-0.1.44.1.patch), built on the release's shared snapshot code; [the 0.1.33 patch](ssd-conversation-cache-0.1.33.patch) is the original. The old PR #175 slot protocol remains retired.

Strata 0.1.40 and later answer `tool_choice: "none"` by leaving the tools out of the prompt. Little Bot 0.27.1 and later no longer send it, so compaction keeps its cached prefix; earlier versions lose it on these engines.

## Current local configuration

The normal `C:\Strata\Strata-main\run-iq3_s.bat` keeps 262,144 context tokens, int8 KV with a 32,768-token resident window, MTP, vision and the experimental speed projection at strength 1.0. Its config includes:

```json
"--conversation-cache-storage", "ssd",
"--conversation-cache-mib", "16384",
"--conversation-cache-slots", "8",
"--conversation-cache-min-free-mib", "512",
"--conversation-cache-min-tokens", "12000"
```

In SSD mode this is a 16 GiB snapshot-storage ceiling, up to eight parked histories and a 512 MiB free physical RAM floor. `--conversation-cache-min-tokens` (Strata 0.1.42+) parks only conversations of at least 12,000 tokens. Little Bot's heartbeats, goal steps and memory passes (about 2,000 to 11,000 tokens, never resumed) then stop taking slots from the long conversation. Without it, eight of them evict the chat, and the next message reads the whole chat again: 25 s for 44,000 tokens on this PC instead of 0.6 s.

Every parked conversation keeps dozens of temporary files open, and the Windows C runtime allows 512 open streams by default. The 0.1.33 and 0.1.39 builds therefore failed to park ("SSD cache: file stream failed") once about seven conversations were parked, and nothing parked again until a restart. Any background request then evicted the chat. The 0.1.44.1 patch raises the limit to 8,192 with `_setmaxstdio`. It does not reserve 16 GiB at startup or guarantee eight long conversations fit. Before saving, the engine checks free disk space and evicts older parked snapshots as needed, leaving a 512 MiB disk floor. If the snapshot still cannot fit, it skips parking. Other applications can consume disk space concurrently; write failures also fall back to a normal prompt read.

Inactive K/V, GDN/PLE/index state and prefix checkpoints go into private delete-on-close files under Windows `%TEMP%`, on this machine's C: NVMe SSD. Matching metadata stays in RAM. Transfers use 1 MiB chunks; each checkpoint is copied and offloaded separately. File size and chunk checksums are checked before a GPU restore. A failed capture keeps the active state and falls back to ordinary processing. A transfer failure during restore ends that engine session instead of generating from partial state.

The active model still needs its usual RAM and VRAM. Active prefix checkpoints return to RAM when their conversation is restored. Windows may use reclaimable RAM to cache disk reads. Temporary files close on eviction or engine exit, so snapshots do not survive restart. Little Bot retains durable conversation messages separately. Requests remain sequential; whole-conversation parking requires a single GPU. Changed prefixes, images or steering can prevent reuse.

Omitting `--conversation-cache-storage` or setting it to `ram` keeps the official RAM path. The optional `run-iq2_xs-cached-128k.bat` remains a smaller-context RAM preset (4 GiB budget, 2,560 MiB floor). Both launchers use port 8080: choose one.

## Rebuild and update

This is a local addition, not a feature of the official executable. Keep the patch and config when updating Strata. Back up the engine, source and run config first. Use matching tagged source/server files, preserve models, tokenizer, MTP, vision, the Python environment and control-vector settings, and rebuild the SSD addition against the new source. An official prebuilt replacement cannot accept the SSD argument until rebuilt. `START-HERE.bat --setup` may rewrite configuration.

For the tested base, use a clean **v0.1.44.1** source tree and an MSVC developer shell with CUDA, CMake and Ninja:

```powershell
git apply --check C:\path\to\ssd-conversation-cache-0.1.44.1.patch
git apply C:\path\to\ssd-conversation-cache-0.1.44.1.patch
cmake -S . -B ssd-build -G Ninja -DCMAKE_BUILD_TYPE=Release -DSTRATA_ENABLE_CUDA=ON -DSTRATA_BUILD_TESTS=OFF -DSTRATA_BUILD_CONVERSATION_TESTS=ON -DCMAKE_CUDA_ARCHITECTURES=89
cmake --build ssd-build --target conversation_cache_test conversation_memory_test conversation_split_failure_test strata --parallel 3
```

Architecture 89 is for this RTX 4070 Ti; use your GPU's architecture. This build used CUDA 13.3 and the existing cu13 runtime libraries, with the official 0.1.44.1 vision executable. With about 45 GB of RAM held by the running engine, three parallel jobs built it and its tests in about seven minutes. Stop Strata before replacing its executable, and describe the local build in `engine/BUILD.json`. The 0.1.44.1 source, build and patch are under `C:\Strata\update-v0.1.44.1`; the 0.1.39 install is kept whole as `C:\Strata\Strata-main-0.1.39`.

## Verification

Run the built conversation tests. GPU fixtures cover FP16, int8, Q4 and hybrid formats with supported resident/streaming/draft layouts, comparing restored bytes to the RAM reference. The host tests cover prefix matching, budgets, memory admission, state loading, corruption rejection and file lifetime.

From the Little Bot checkout, use a **separate** ready test server on port 8081. Diagnostic clients can evict real conversations:

```powershell
node integrations/strata/verify-conversation-cache.cjs http://127.0.0.1:8081/v1 12000 --background-records 1200 --cancel
```

The live script sends A/B/A full histories through the engine's own Strata client, checks distant-record answers and provider-reported cache reuse, then interrupts a third conversation and checks both parked histories again. Use 1,200 to 12,000 records; the default is 1,200. `--background-records` permits a smaller background history while retaining the long foreground chat. Live timings and hardware are recorded in [VALIDATION.md](../../VALIDATION.md). GPU byte comparisons establish snapshot correctness for their fixtures, not universal token-for-token model output parity. Vision rotation, HIP and multi-GPU parking have not been live-validated.

## Historical PR #175 SSD slots

The earlier integration depended on [Strata PR #175](https://github.com/Niko1221/Strata/pull/175), including its inactive-checkpoint SSD offloading update. Its tested base was **Strata 0.1.27**, upstream commit `a790805`; the PR revision was `fcf93ec`. The following patch, build steps and measurements are retained as historical evidence. This protocol is no longer used by Little Bot and should not be applied to an official update.

## Slot assignments

Foreground chat and scheduled automations use slot 0, memory extraction uses 1, goals/heartbeat use 2, and independent checks use 3. There is one execution lane. Slots are server-global, not separate per app or client.

The patch snapshots positional main/MTP KV data, recurrent GDN/PLE/index state, token/image identity and prefix checkpoints. Inactive payloads use delete-on-close temporary files; only small descriptors remain in RAM. The active slot retains its normal RAM/VRAM state. OS file caching may consume reclaimable RAM. Restarting the server clears all four slots.

Prefix changes and compaction can still require a cold read. The feature does not remove the need to send full conversation messages. Layer-split multi-GPU sessions advertise only one slot and reject nonzero selections.

## Build the matching engine and server

Back up your executable, source and configuration. Start from the tested upstream revision and apply `cache-slots.patch` with `git apply --check`, then `git apply`. Alternatively, check out the PR branch at the revision above. Do not apply the patch twice or assume it applies unchanged to a later release.

Build with Strata's documented toolchain and your GPU architecture. For the tested RTX 4070 Ti, an MSVC developer shell with CMake, Ninja and CUDA used:

```powershell
cmake -S . -B cache-build -G Ninja -DCMAKE_BUILD_TYPE=Release -DSTRATA_ENABLE_CUDA=ON -DSTRATA_BUILD_TESTS=OFF -DCMAKE_CUDA_ARCHITECTURES=89
cmake --build cache-build --target strata --parallel 4
```

Use the architecture appropriate to your GPU. Stop Strata before installing the rebuilt executable and updated Python server. Preserve model weights and configuration. `/metrics` should report `cache_slots: 4` and `cache_storage: temporary-disk` for a supported single-GPU session.

Little Bot recognizes both older Strata health responses and Strata 0.1.27's `/props` identification, then translates Responses requests into Chat Completions. Cached token counts come from `prompt_tokens_details.cached_tokens`.

## Verification and limitations

**Use a separate test server.** These tests replace every cache slot. A second test client on your live server can evict your conversation even if it uses a separate app profile.

From the patched Strata checkout:

```powershell
python -m unittest discover -s serve
python tools/check_cache_slots.py --url http://127.0.0.1:8081 --lines 1700
```

The live check requires zero reuse on independent cold prompts, reuse after rotation, matching greedy answers, retrieval of distant records, and recovery after a streaming disconnect. For repeatable parity use `--adapt-swaps 0` in the test engine configuration. The older `verify-strata-*.py` scripts are retained as historical diagnostics; their defaults target port 8080 and must not be run against an active personal session.

Validation used Windows, NVIDIA RTX 4070 Ti, Qwen IQ2_XS, int8 KV, MTP, and prompts exceeding the 32k resident window. HIP, image rotation, other KV formats and multiple GPUs have not been live-validated for multi-slot operation.

In one NVMe trial, long inactive slots offloaded about 451 MiB of checkpoint payload each. Peak private-memory growth above the first request fell from 900 MiB to 34 MiB; populated-slot switching took 437–938 ms. These are local measurements, not guaranteed performance.
