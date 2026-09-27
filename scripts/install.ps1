param(
  [Parameter(Mandatory = $true)]
  [string]$Version
)

$ErrorActionPreference = 'Stop'

$payload = Join-Path $PSScriptRoot 'payload.zip'
$uninstallSource = Join-Path $PSScriptRoot 'uninstall.ps1'
if (!(Test-Path -LiteralPath $payload -PathType Leaf)) { throw 'Installer payload is missing.' }
if (!(Test-Path -LiteralPath $uninstallSource -PathType Leaf)) { throw 'Uninstaller payload is missing.' }

$installDir = if ($env:LITTLE_BOT_INSTALL_DIR) {
  [IO.Path]::GetFullPath($env:LITTLE_BOT_INSTALL_DIR)
} else {
  Join-Path $env:LOCALAPPDATA 'Programs\Little Bot'
}
$installerStateDir = if ($env:LITTLE_BOT_INSTALLER_STATE_DIR) {
  [IO.Path]::GetFullPath($env:LITTLE_BOT_INSTALLER_STATE_DIR)
} else {
  Join-Path $env:LOCALAPPDATA 'Little Bot Installer'
}

$installParent = Split-Path -Parent $installDir
New-Item -ItemType Directory -Force -Path $installParent | Out-Null
$temporary = "$installDir.installing-$PID"
Remove-Item -LiteralPath $temporary -Recurse -Force -ErrorAction SilentlyContinue

try {
  Expand-Archive -LiteralPath $payload -DestinationPath $temporary -Force
  $stagedExe = Join-Path $temporary 'Little Bot.exe'
  if (!(Test-Path -LiteralPath $stagedExe -PathType Leaf)) { throw 'Little Bot.exe is missing from the installer payload.' }

  Get-Process -Name 'Little Bot' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $installDir) { Remove-Item -LiteralPath $installDir -Recurse -Force }
  Move-Item -LiteralPath $temporary -Destination $installDir

  $exe = Join-Path $installDir 'Little Bot.exe'
  New-Item -ItemType Directory -Force -Path $installerStateDir | Out-Null
  $uninstallScript = Join-Path $installerStateDir 'uninstall.ps1'
  Copy-Item -LiteralPath $uninstallSource -Destination $uninstallScript -Force

  $programs = [Environment]::GetFolderPath('Programs')
  $shortcutPath = Join-Path $programs 'Little Bot.lnk'
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $exe
  $shortcut.WorkingDirectory = $installDir
  $shortcut.IconLocation = "$exe,0"
  $shortcut.Description = 'Little Bot'
  $shortcut.Save()

  $regPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Little Bot'
  New-Item -Path $regPath -Force | Out-Null
  $powershellExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $uninstallArgs = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$uninstallScript`" -InstallDir `"$installDir`" -ShortcutPath `"$shortcutPath`""
  $uninstallCommand = "`"$powershellExe`" $uninstallArgs"
  $estimatedKb = [Math]::Max(1, [Math]::Ceiling(((Get-ChildItem -LiteralPath $installDir -File -Recurse | Measure-Object Length -Sum).Sum) / 1KB))

  New-ItemProperty -Path $regPath -Name DisplayName -Value 'Little Bot' -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $regPath -Name DisplayVersion -Value $Version -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $regPath -Name Publisher -Value 'Personal project' -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $regPath -Name InstallLocation -Value $installDir -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $regPath -Name DisplayIcon -Value "$exe,0" -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $regPath -Name UninstallString -Value $uninstallCommand -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $regPath -Name QuietUninstallString -Value $uninstallCommand -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $regPath -Name NoModify -Value 1 -PropertyType DWord -Force | Out-Null
  New-ItemProperty -Path $regPath -Name NoRepair -Value 1 -PropertyType DWord -Force | Out-Null
  New-ItemProperty -Path $regPath -Name EstimatedSize -Value $estimatedKb -PropertyType DWord -Force | Out-Null
} catch {
  Remove-Item -LiteralPath $temporary -Recurse -Force -ErrorAction SilentlyContinue
  throw
}
