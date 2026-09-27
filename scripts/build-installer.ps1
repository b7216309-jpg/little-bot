param(
  [Parameter(Mandatory = $true)]
  [string]$SourceDir,
  [Parameter(Mandatory = $true)]
  [string]$PortableZip,
  [Parameter(Mandatory = $true)]
  [string]$InstallerFile,
  [Parameter(Mandatory = $true)]
  [string]$Version,
  [switch]$PortableOnly
)

$ErrorActionPreference = 'Stop'
$source = [IO.Path]::GetFullPath($SourceDir)
$portable = [IO.Path]::GetFullPath($PortableZip)
$installer = [IO.Path]::GetFullPath($InstallerFile)
if (!(Test-Path -LiteralPath (Join-Path $source 'Little Bot.exe') -PathType Leaf)) {
  throw 'Packaged Little Bot executable was not found.'
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $portable) | Out-Null
Remove-Item -LiteralPath $portable -Force -ErrorAction SilentlyContinue
Compress-Archive -Path (Join-Path $source '*') -DestinationPath $portable -CompressionLevel Optimal

if ($PortableOnly) {
  Write-Host "Portable archive: $portable"
  exit 0
}

$iexpress = Join-Path $env:SystemRoot 'System32\iexpress.exe'
if (!(Test-Path -LiteralPath $iexpress -PathType Leaf)) { throw 'Windows IExpress is not available.' }

Remove-Item -LiteralPath $installer -Force -ErrorAction SilentlyContinue
$stage = Join-Path ([IO.Path]::GetTempPath()) ("little-bot-installer-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $stage | Out-Null

try {
  Copy-Item -LiteralPath $portable -Destination (Join-Path $stage 'payload.zip')
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'install.ps1') -Destination (Join-Path $stage 'install.ps1')
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'uninstall.ps1') -Destination (Join-Path $stage 'uninstall.ps1')
  $cmd = "@echo off`r`npowershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File `"%~dp0install.ps1`" -Version `"$Version`"`r`n"
  [IO.File]::WriteAllText((Join-Path $stage 'install.cmd'), $cmd, [Text.Encoding]::ASCII)

  $sedPath = Join-Path $stage 'installer.sed'
  $sourceWithSlash = $stage.TrimEnd('\') + '\'
  $sed = @"
[Version]
Class=IEXPRESS
SEDVersion=3
[Options]
PackagePurpose=InstallApp
ShowInstallProgramWindow=0
HideExtractAnimation=1
UseLongFileName=1
InsideCompressed=0
CAB_FixedSize=0
CAB_ResvCodeSigning=0
RebootMode=N
InstallPrompt=%InstallPrompt%
DisplayLicense=%DisplayLicense%
FinishMessage=%FinishMessage%
TargetName=%TargetName%
FriendlyName=%FriendlyName%
AppLaunched=%AppLaunched%
PostInstallCmd=%PostInstallCmd%
AdminQuietInstCmd=%AdminQuietInstCmd%
UserQuietInstCmd=%UserQuietInstCmd%
SourceFiles=SourceFiles
[Strings]
InstallPrompt=
DisplayLicense=
FinishMessage=
TargetName=$installer
FriendlyName=Little Bot $Version Setup
AppLaunched=cmd.exe /c install.cmd
PostInstallCmd=<None>
AdminQuietInstCmd=cmd.exe /c install.cmd
UserQuietInstCmd=cmd.exe /c install.cmd
FILE0="payload.zip"
FILE1="install.cmd"
FILE2="install.ps1"
FILE3="uninstall.ps1"
[SourceFiles]
SourceFiles0=$sourceWithSlash
[SourceFiles0]
%FILE0%=
%FILE1%=
%FILE2%=
%FILE3%=
"@
  [IO.File]::WriteAllText($sedPath, $sed, [Text.Encoding]::ASCII)
  & $iexpress /N /Q /M $sedPath
  if (!(Test-Path -LiteralPath $installer -PathType Leaf) -or (Get-Item -LiteralPath $installer).Length -lt 1024) {
    throw 'Installer executable was not created.'
  }
  Write-Host "Portable archive: $portable"
  Write-Host "Installer: $installer"
} finally {
  Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
}
