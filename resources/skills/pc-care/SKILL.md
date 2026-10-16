---
name: pc-care
description: Check and tidy the Windows PC - disk space, the largest folders, heavy processes, memory, startup apps, uptime and recent system errors. Use when the user asks why the PC is slow, full or misbehaving, or wants a health check or a cleanup.
---
# PC care

Look first, change only what the user asked for, and keep every command bounded to one folder or a short list.

## Health check (read-only)

Run the checks that fit the question, not all of them.

- Disk space:
  `Get-PSDrive -PSProvider FileSystem | Where-Object Used | Select-Object Name, @{n='FreeGB';e={[math]::Round($_.Free/1GB,1)}}, @{n='UsedGB';e={[math]::Round($_.Used/1GB,1)}}`
- Largest folders inside one folder (never scan a whole drive):
  `Get-ChildItem -LiteralPath $folder -Directory -Force -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ Folder = $_.Name; GB = [math]::Round(((Get-ChildItem -LiteralPath $_.FullName -Recurse -File -Force -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum)/1GB, 2) } } | Sort-Object GB -Descending | Select-Object -First 12`
  Good folders to try: `$env:USERPROFILE\Downloads`, `$env:LOCALAPPDATA`, `$env:TEMP`, `$env:USERPROFILE`.
- Largest files in one folder:
  `Get-ChildItem -LiteralPath $folder -Recurse -File -Force -ErrorAction SilentlyContinue | Sort-Object Length -Descending | Select-Object -First 15 FullName, @{n='MB';e={[int]($_.Length/1MB)}}`
- Heavy processes:
  `Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 10 Name, Id, @{n='MemMB';e={[int]($_.WorkingSet64/1MB)}}, @{n='CPUs';e={[int]$_.CPU}}`
- CPU load and memory now:
  `(Get-CimInstance Win32_Processor | Measure-Object LoadPercentage -Average).Average` and
  `Get-CimInstance Win32_OperatingSystem | Select-Object @{n='FreeGB';e={[math]::Round($_.FreePhysicalMemory/1MB,1)}}, @{n='TotalGB';e={[math]::Round($_.TotalVisibleMemorySize/1MB,1)}}, LastBootUpTime`
- Startup apps: `Get-CimInstance Win32_StartupCommand | Select-Object Name, Location, Command`
- Recent system errors (last two days):
  `Get-WinEvent -FilterHashtable @{LogName='System'; Level=1,2; StartTime=(Get-Date).AddDays(-2)} -MaxEvents 25 -ErrorAction SilentlyContinue | Select-Object TimeCreated, ProviderName, Id, @{n='Message';e={($_.Message -split "`n")[0]}}`
- Disks' health: `Get-PhysicalDisk | Select-Object FriendlyName, MediaType, HealthStatus, @{n='SizeGB';e={[int]($_.Size/1GB)}}`

Shell commands may run without network access, so a failed connection test from the shell does not prove the PC is offline. Use the browser for an online check.

## Report

Lead with the verdict ("C: is 94% full, mostly games and Downloads"), then a short table of the evidence, then the one or two actions that would help most, with the space or speed they would win.

## Tidy (when asked)

- Temporary files: report the size of `$env:TEMP` items older than a week, then remove them when asked. Files in use fail; skip them and say how many.
- Downloads and big files: list candidates; move or delete only what the user picked. Moving to a folder is reversible; deleting is not.
- Recycle bin: `Clear-RecycleBin -Force` empties it for good. Only on an explicit request.
- Startup apps, drivers, services, the registry and security settings are the user's system configuration: explain the change and how to make it (Settings > Apps > Startup, Task Manager), and make it only when explicitly asked.
- Never touch `C:\Windows`, program folders or other users' folders.

Report what changed and the space recovered, measured after the cleanup.
