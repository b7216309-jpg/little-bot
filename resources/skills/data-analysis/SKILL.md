---
name: data-analysis
description: Analyze CSV, JSON, exported spreadsheets or log files and answer with the numbers, a short table and a chart. Use for totals, averages, trends, top items, outliers, comparisons or error counts in a data file.
---
# Data analysis

Answer the question with numbers first, then show how you got them.

## 1. Look before computing

- Size and first lines: `(Get-Item $file).Length`, `Get-Content $file -TotalCount 5 -Encoding UTF8`
- CSV separator: count `;` and `,` in the header line and use the more frequent one (French exports use `;`).
- Load: `$data = Import-Csv $file -Delimiter ';' -Encoding UTF8`, then list the columns with `$data[0].PSObject.Properties.Name` and the row count with `$data.Count`.
- JSON: `$data = Get-Content $file -Raw -Encoding UTF8 | ConvertFrom-Json`
- Files over about 50 MB: stream them with `[IO.File]::ReadLines($file)` instead of loading everything.

## 2. Compute

- Import-Csv gives text. Convert numbers explicitly and accept both decimal styles:
  `function Num($v) { [double]::Parse(($v -replace '\s','' -replace ',', '.'), [Globalization.CultureInfo]::InvariantCulture) }`
- Dates: `[datetime]::Parse($v, [Globalization.CultureInfo]'fr-FR')` for French dates, or `ParseExact` with the format you saw.
- Totals by group:
  `$data | Group-Object Category | ForEach-Object { [pscustomobject]@{ Category = $_.Name; Total = [math]::Round(($_.Group | ForEach-Object { Num $_.Amount } | Measure-Object -Sum).Sum, 2); Count = $_.Count } } | Sort-Object Total -Descending`
- Trends: group by month with `Get-Date $date -Format 'yyyy-MM'`.
- Logs: `Select-String -Path $file -Pattern 'ERROR|FATAL' | Group-Object { $_.Line -replace '^\S+\s+\S+\s+', '' -replace '\d+', 'N' } | Sort-Object Count -Descending | Select-Object -First 10 Count, Name`
- Check your result once with a second method, for example a grand total against the sum of the groups.

## 3. Chart

For a bar chart, write an HTML file with inline SVG and render it to PNG with `document_render`. A minimal pattern:

```
$max = ($rows | Measure-Object Total -Maximum).Maximum
$bars = for ($i = 0; $i -lt $rows.Count; $i++) {
  $w = [int](600 * $rows[$i].Total / $max); $y = 40 + $i * 34
  "<text x='10' y='$($y+20)' font-size='14'>$($rows[$i].Category)</text><rect x='170' y='$y' width='$w' height='26' fill='#4f7a5a'/><text x='$(175+$w)' y='$($y+19)' font-size='13'>$($rows[$i].Total)</text>"
}
$html = "<!doctype html><meta charset='utf-8'><body style='margin:0;font-family:Segoe UI'><svg width='900' height='$(60 + $rows.Count*34)'><text x='10' y='24' font-size='18' font-weight='600'>Title</text>$($bars -join '')</svg>"
[IO.File]::WriteAllText("$PWD\chart.html", $html)
```

Then `document_render({ path: "chart.html", format: "png", width: 900, height: <svg height> })` and `attachment_send` the PNG.

## 4. Report

The answer in one or two sentences, a table of at most ten rows, the chart, then your assumptions: filters, rows skipped, missing values, units and the date range. Never invent numbers that are not in the data.
