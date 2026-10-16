---
name: file-organizer
description: Sort and clean up folders - group files by type or date, find duplicates, batch-rename and archive old files - with a move log so every change can be undone. Use when the user asks to organize Downloads, the desktop, photos or any messy folder.
---
# File organizer

Every move goes through a log, so any cleanup can be reversed.

## 1. Survey

`Get-ChildItem -LiteralPath $dir -File | Group-Object Extension | Sort-Object Count -Descending | Select-Object Name, Count, @{n='MB';e={[math]::Round(($_.Group | Measure-Object Length -Sum).Sum/1MB,1)}}`

Tell the user what you found in one or two lines and the plan you will apply, then apply it unless they asked to review it first.

## 2. Categories

Images: .jpg .jpeg .png .gif .webp .heic .bmp - Documents: .pdf .doc .docx .odt .txt .rtf .md - Spreadsheets: .xls .xlsx .csv .ods - Slides: .ppt .pptx - Archives: .zip .rar .7z .tar .gz - Installers: .exe .msi - Videos: .mp4 .mkv .mov .avi - Audio: .mp3 .wav .flac .m4a - Code: .js .py .ps1 .json .html .css. Anything else goes to "Other". Sorting by date uses `yyyy\yyyy-MM` folders from LastWriteTime.

## 3. Move with a log

```
$log = Join-Path $dir ("_little-bot-moves-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + ".csv")
function Move-Logged($file, $targetDir) {
  New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
  $dest = Join-Path $targetDir $file.Name; $n = 2
  while (Test-Path -LiteralPath $dest) { $dest = Join-Path $targetDir ("{0} ({1}){2}" -f $file.BaseName, $n++, $file.Extension) }
  Move-Item -LiteralPath $file.FullName -Destination $dest -ErrorAction Stop
  [pscustomobject]@{ From = $file.FullName; To = $dest } | Export-Csv -Path $log -Append -NoTypeInformation -Encoding UTF8
}
```

Never overwrite a file: the loop adds " (2)", " (3)". Skip files that fail (in use, no access), count them, and report them at the end.

## 4. Undo

`$rows = @(Import-Csv $log); [array]::Reverse($rows); foreach ($r in $rows) { Move-Item -LiteralPath $r.To -Destination $r.From }` and then remove the empty folders you created.

## 5. Duplicates

Compare sizes first, then hash only the files that share a size:
`Get-ChildItem -LiteralPath $dir -Recurse -File | Group-Object Length | Where-Object Count -gt 1 | ForEach-Object { $_.Group } | Get-FileHash -Algorithm SHA256 | Group-Object Hash | Where-Object Count -gt 1`
Keep the oldest copy, move the others into `_duplicates` through Move-Logged, and delete them only when the user asks.

## 6. Batch rename

Show the first five "old → new" names, then rename the rest the same way, logging each rename like a move. Keep extensions, and add a counter (`001`) when names would collide.

## 7. Limits

Work only inside the folder the user named. Never touch system, program or app data folders, and never follow links out of the folder. Finish with a short summary: files moved per category, duplicates found, space they take, and where the log is.
