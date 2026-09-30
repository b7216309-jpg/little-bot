# Strata cache rotation for Little Bot

This integration depends on [Strata PR #175](https://github.com/Niko1221/Strata/pull/175), including its inactive-checkpoint SSD offloading update. The tested base is **Strata 0.1.27**, upstream commit `a790805`; the PR revision is `fcf93ec`. Until merged and released, use the PR branch or the bundled patch, not an unmodified upstream binary.

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
