param(
  [Parameter(Mandatory = $true)]
  [string]$InstallDir,
  [Parameter(Mandatory = $true)]
  [string]$ShortcutPath
)

$ErrorActionPreference = 'Stop'
$resolvedInstall = [IO.Path]::GetFullPath($InstallDir)

Get-Process -Name 'Little Bot' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $ShortcutPath -Force -ErrorAction SilentlyContinue
if (Test-Path -LiteralPath $resolvedInstall) {
  Remove-Item -LiteralPath $resolvedInstall -Recurse -Force
}
Remove-Item -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Little Bot' -Recurse -Force -ErrorAction SilentlyContinue

$helper = $PSScriptRoot
try { Remove-Item -LiteralPath $helper -Recurse -Force -ErrorAction Stop } catch { }
