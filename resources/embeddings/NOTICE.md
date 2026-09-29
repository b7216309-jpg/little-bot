# Bundled CPU sentence embeddings

Model: BAAI/bge-base-en-v1.5, quantized ONNX conversion by Xenova.
Model card: https://huggingface.co/BAAI/bge-base-en-v1.5
ONNX source: https://huggingface.co/Xenova/bge-base-en-v1.5
License: MIT (included in LICENSE).

The model has 768 output dimensions and is primarily intended for English
sentences and short paragraphs. It is used only for semantic retrieval, not
for generating replies. Model files and tokenizer assets are pinned by revision
and SHA-256 in manifest.json. Build-time downloads are included in the app;
inference never downloads assets or contacts a server.

The ONNX Runtime CPU execution provider is selected explicitly. The Windows
runtime package includes provider libraries, but this app does not request
CUDA, DirectML, WebGPU, or any other GPU provider.
