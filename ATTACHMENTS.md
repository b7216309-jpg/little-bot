# Attachments

Use the paperclip, drop files on the composer, or paste an image. Images appear in the conversation; returned documents can be opened or saved. Attachments are copied into Little Bot's data folder, so the conversation still works after the original is moved.

Images are decoded locally, converted to PNG, and scaled to at most 2,048 pixels on the longest edge. Small thumbnails keep chat updates light. Animated images use their first frame. PNG, JPEG, WebP, GIF, BMP, and ICO are accepted when supported by Electron's decoder; an unreadable image produces an error instead of an empty attachment.

PDF, DOCX, text, Markdown, CSV, JSON, and common source files supply readable text to the model. PDF and Word extraction stays on this computer. Scanned or password-protected PDFs produce an explicit message; OCR is not included. Other file types remain downloadable and accessible to file tools, without pretending that their contents were read.

Limits: eight files per message, 20 MiB per file, 50 MiB per message, and 512 MiB in the attachment store. Document excerpts share a 30,000-character budget per message. PDF extraction reads at most 100 pages. Truncation is disclosed to the agent, which can use the original file when a suitable tool is available.

Image capability is checked per selected model, regardless of connection. Codex models use the app-server catalog’s `inputModalities`; local models use the local catalog plus the selected server’s `/props` vision state. A model explicitly advertised as text-only rejects image attachments before an engine thread starts. If an older provider does not advertise modalities, Little Bot preserves compatibility instead of guessing that images are unsupported. Attaching an accepted image sends its normalized pixels to the selected connection when the message is sent. Local connections retain them locally; selecting Codex sends them to that connection.

## Implementation

`src/attachments.cjs` provides `Attachments({root, nativeImage})`. Its public methods are asynchronous:

- `importPaths(paths)` returns attachment descriptors after copying selected files.
- `importBytes({name, bytes})` imports clipboard or dropped file bytes.
- `describe(id)` returns `{id, name, mime, kind, size, thumbnail?, width?, height?}`.
- `get(id)` adds private paths for trusted main-process code; never forward these paths as renderer capabilities.
- `read(id)` returns `{buffer, mime, name}` for the app's attachment protocol or Save dialog.
- `preview(id)` / `getImageDataURL(id)` provides normalized image pixels by known ID.
- `prepare(ids)` returns `{descriptors, input, text}`. `input` contains native `localImage` parts. `text` includes document excerpts, their paths, and instructions to treat document content as reference data.
- `output(filePath, workspace, {extraRoots})` imports an agent-created result. Files must be regular files inside the working folder or an explicitly allowed browser-output folder. Links and credential paths are rejected.

Descriptors contain stable random IDs, not renderer-selected file paths. Per-attachment metadata survives app restarts. Remote URLs and SVG/HTML are never rendered as attachment images. Raster dimensions are checked before decoding for common formats, and again after decoding. Document parsers run in workers with a 15-second deadline and a memory limit. DOCX ZIP expansion is bounded before extraction.

PDF extraction uses [unpdf](https://github.com/unjs/unpdf), which includes a server-oriented Mozilla PDF.js build. Word text uses [Mammoth](https://github.com/mwilliamson/mammoth.js). No conversion service, Python runtime, or additional browser is required.
