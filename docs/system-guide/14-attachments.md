# Attachments, previews and delivered files

## How it works

The renderer import path goes through [preload](../../src/preload.cjs), main IPC and [Attachments](../../src/attachments.cjs). Choosing/dropping/pasting a file creates a managed copy with an ID and metadata. Draft copies have leases; saved messages carry durable references.

Imports allow eight files per turn, 20 MiB per file, 50 MiB total per turn and 512 MiB stored copies. The model receives at most 30,000 characters of combined inline document excerpts, plus original paths. Images are validated/resized for model input; preview delivery uses the little-bot-attachment protocol. Sending images requires model vision capability.

Text extensions have an inline reader. PDF and DOCX extraction runs in a worker using unpdf/mammoth; cached extracted text avoids repeated parsing. Password-protected/unreadable documents produce explanatory notes. Unsupported formats remain attached as originals rather than being presented as successfully read. A scanned PDF does not gain OCR merely because PDF text extraction exists.

[attachment-message.cjs](../../src/attachment-message.cjs) builds saved message descriptors. attachment_send imports an existing output under the chat workspace or browser output root and presents it as an attachment with preview/save controls. It delivers a file to the local user, not another person.

## Cleanup and removal

Removing an unsent draft releases its lease. Cleanup prunes copies with no saved references or active draft leases. Startup does not restore drafts and prunes unused imports. Removing a saved attachment removes the app copy and chat references while keeping its original source file.

Storage usage and cleanup are exposed in Settings and attachment_manage. The 0.10.1 fixes prevent abandoned draft imports accumulating invisibly until the quota is exhausted.

## What can prevent operation

Too many/large files, exhausted copy storage, unreadable original, invalid image/too many pixels, unsupported vision, extraction timeout, encrypted documents, unsupported formats or unavailable local copies. Inline text is explicitly truncated when over budget; the original remains available for suitable native tools.

A pasted browser File with no filesystem path may need the attach button. A screenshot path returned by browser tooling is not automatically a visible attachment until attachment_send/import delivery is performed.

