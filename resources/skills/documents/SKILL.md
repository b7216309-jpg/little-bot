---
name: documents
description: Make polished files to share or print - PDF reports, letters, CVs, invoices, posters, spreadsheets, Word-compatible documents and chart images - and read Word or Excel files from disk. Use when the user asks for a document, a table, a printable page or any file to send.
---
# Documents

Write the content first, then build the file in the working folder, check it, and deliver it with attachment_send.

## PDF or image (the default for anything to share or print)

1. Write one self-contained HTML file: inline CSS, inline SVG for charts and logos, no scripts and no web links (rendering has no network). Save it as UTF-8:
   `[IO.File]::WriteAllText("$PWD\report.html", $html)` (use a here-string `@'...'@` for the HTML).
2. Page layout for print: `@page { size: A4; margin: 18mm }`, `body { font: 11pt "Segoe UI", Arial, sans-serif; color: #222 }`, and `page-break-before: always` on a section to start a new page. Use `size: A4 landscape` for wide tables.
3. Render with `document_render({ path: "report.html" })` for a PDF, or `document_render({ path: "chart.html", format: "png", width: 1200, height: 800 })` for an image.
4. Check the result exists and has a sensible size, then `attachment_send` it.

Good defaults: one clear title, a short summary at the top, tables with a header row and light borders (`border-collapse: collapse; border-bottom: 1px solid #ddd`), numbers right-aligned, dates written out.

## Spreadsheets

- Write a CSV for Excel with a UTF-8 byte-order mark and the PC's list separator, so accents and columns come out right in any language:
  `$rows | Export-Csv -Path data.csv -NoTypeInformation -Encoding UTF8 -Delimiter (Get-Culture).TextInfo.ListSeparator`
  On a French PC the separator is `;`.
- Write decimal numbers the way the user's locale expects (`12,5` in French) when the file is for Excel; keep `.` in files for programs.

## Word-compatible documents

- If the user needs an editable document, write the same HTML and save it with a `.doc` extension; Word and LibreOffice open it as a document.
- If Word is installed (`New-Object -ComObject Word.Application` succeeds), it can convert to a real .docx: open the HTML, then `$doc.SaveAs2("$PWD\letter.docx", 16)`, close it and quit Word.

## Reading files on disk

- Word (.docx) is a zip of XML:
  `Add-Type -AssemblyName System.IO.Compression.FileSystem; $zip = [IO.Compression.ZipFile]::OpenRead($file); $reader = New-Object IO.StreamReader($zip.GetEntry('word/document.xml').Open()); $xml = $reader.ReadToEnd(); $reader.Close(); $zip.Dispose(); ($xml -replace '</w:p>', "`n" -replace '<[^>]+>', '')`
- Excel (.xlsx): cell text is in `xl/sharedStrings.xml` and values in `xl/worksheets/sheet1.xml` inside the same kind of zip; for real analysis, ask the user to save it as CSV.
- PDF has no reader in Windows' shell. Ask the user to attach the file; Little Bot reads attached PDFs and Word documents for you.
