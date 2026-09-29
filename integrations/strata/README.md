# Strata cache rotation for Little Bot

The app routes foreground chat to slot 0, memory extraction to 1, goals/heartbeat to 2, and independent answer checks to 3. Automations use the continuous chat and therefore slot 0. These are independent caches, not parallel model instances. There is still one execution lane.

`cache-slots.patch` updates the locally installed Strata source (reported version 0.1.19). It snapshots recurrent/PLE/index state and positional main/MTP KV storage, preserves prefix checkpoints, and invalidates streamed GPU page mappings on restore. Inactive positional caches use delete-on-close temporary files; no second model copy or full GPU KV allocation is needed. At most three inactive slots exist. They last only for the server process lifetime. A changed prompt prefix, model restart or compaction can still require prefill.

## Install from source

Back up `src/program/generate.cpp`, `serve/server.py` and your engine executable first. From the Strata source directory, run `git apply --check --ignore-space-change <path-to-cache-slots.patch>`, then `git apply --ignore-space-change <path-to-cache-slots.patch>`. Do not reapply an already installed patch. Build using Strata's normal CUDA toolchain and your GPU architecture. The tested RTX 4070 Ti uses `-DCMAKE_CUDA_ARCHITECTURES=89`; do not copy that value for an unrelated GPU. Stop the server before replacing its executable, then restart the Python server as well. Keep the original model configuration and weights.

Example build from an MSVC developer shell with CMake and Ninja available:

```
cmake -S . -B cache-build -G Ninja -DCMAKE_BUILD_TYPE=Release -DSTRATA_ENABLE_CUDA=ON -DSTRATA_BUILD_TESTS=OFF -DCMAKE_CUDA_ARCHITECTURES=89
cmake --build cache-build --target strata --parallel 4
```

The engine announces `INFO cache_slots=4 cache_storage=temporary-disk`. The chat-completions request field is `strata_cache_slot` (integer 0–3, default 0). Usage now reports `prompt_tokens_details.cached_tokens`; Little Bot translates it into Responses usage.

## Reproduce live verification

Close other model clients first. Run against localhost:8080 with the Qwen model loaded. These tests make real inference requests and write their results beside the scripts:

```
python verify-strata-slots.py 1700
python verify-strata-needles.py
python verify-strata-cancel.py
```

The first requires zero cache reuse on cold requests, nonzero reuse after rotation and identical greedy output. The second retrieves two different records across a 35k-token prompt and compares restored output with independent cold inference. The third disconnects a streaming generation, rotates slots and checks restored output against cold output. They cover the installed int8 KV / MTP configuration, including context longer than the 32,768-token resident GPU window. Other KV formats and vision-context rotation have not been live-tested.

Observed on the RTX 4070 Ti: 35,758-token cold requests took 36–41 seconds; restored requests took 0.58–0.62 seconds, reusing 35,751 tokens. Needle retrieval matched exactly and reused 35,773 tokens. These timings are a local measurement, not a guarantee for every conversation length.
