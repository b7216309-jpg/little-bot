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
# .NET's zip writer: the same archive as Compress-Archive, many times faster, and it does not stall on large trees.
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($source, $portable, [IO.Compression.CompressionLevel]::Optimal, $false)

if ($PortableOnly) {
  Write-Host "Portable archive: $portable"
  exit 0
}

Remove-Item -LiteralPath $installer -Force -ErrorAction SilentlyContinue
$stage = Join-Path ([IO.Path]::GetTempPath()) ("little-bot-installer-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $stage | Out-Null

try {
  $installScript = Join-Path $PSScriptRoot 'install.ps1'
  $uninstallScript = Join-Path $PSScriptRoot 'uninstall.ps1'
  $appIcon = Join-Path (Split-Path -Parent $PSScriptRoot) 'resources\icons\little-bot.ico'
  foreach ($required in @($portable, $installScript, $uninstallScript, $appIcon)) {
    if (!(Test-Path -LiteralPath $required -PathType Leaf)) { throw "Missing installer input: $required" }
  }

  $sourcePath = Join-Path $stage 'setup-bootstrapper.cs'
  $stubPath = Join-Path $stage 'setup-bootstrapper.exe'
  $csharp = @'
using System;
using System.Diagnostics;
using System.IO;
using System.Text;

internal static class Program
{
    private static readonly byte[] Magic = Encoding.ASCII.GetBytes("LITTLEBOTSETUP1");

    [STAThread]
    private static int Main(string[] args)
    {
        string self = Process.GetCurrentProcess().MainModule.FileName;
        string temp = Path.Combine(Path.GetTempPath(), "little-bot-setup-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(temp);

        try
        {
            string payload = Path.Combine(temp, "payload.zip");
            string install = Path.Combine(temp, "install.ps1");
            string uninstall = Path.Combine(temp, "uninstall.ps1");

            using (var input = new FileStream(self, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                const int footerSize = 15 + 24;
                if (input.Length <= footerSize) return 10;
                input.Seek(-footerSize, SeekOrigin.End);
                using (var reader = new BinaryReader(input, Encoding.UTF8, true))
                {
                    byte[] magic = reader.ReadBytes(Magic.Length);
                    if (magic.Length != Magic.Length) return 11;
                    for (int i = 0; i < Magic.Length; i++) if (magic[i] != Magic[i]) return 12;

                    long payloadLength = reader.ReadInt64();
                    long installLength = reader.ReadInt64();
                    long uninstallLength = reader.ReadInt64();
                    long dataLength = payloadLength + installLength + uninstallLength;
                    long dataStart = input.Length - footerSize - dataLength;
                    if (payloadLength <= 0 || installLength <= 0 || uninstallLength <= 0 || dataStart < 0) return 13;

                    input.Seek(dataStart, SeekOrigin.Begin);
                    CopyExactly(input, payload, payloadLength);
                    CopyExactly(input, install, installLength);
                    CopyExactly(input, uninstall, uninstallLength);
                }
            }

            string powershell = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.System),
                @"WindowsPowerShell\v1.0\powershell.exe");
            var start = new ProcessStartInfo
            {
                FileName = powershell,
                Arguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File \"" + install + "\" -Version \"__VERSION__\"",
                WorkingDirectory = temp,
                UseShellExecute = false,
                CreateNoWindow = true
            };
            using (var child = Process.Start(start))
            {
                child.WaitForExit();
                return child.ExitCode;
            }
        }
        catch
        {
            return 20;
        }
        finally
        {
            try { Directory.Delete(temp, true); } catch { }
        }
    }

    private static void CopyExactly(Stream input, string outputPath, long length)
    {
        byte[] buffer = new byte[1024 * 1024];
        using (var output = new FileStream(outputPath, FileMode.Create, FileAccess.Write, FileShare.None))
        {
            long remaining = length;
            while (remaining > 0)
            {
                int count = input.Read(buffer, 0, (int)Math.Min(buffer.Length, remaining));
                if (count <= 0) throw new EndOfStreamException();
                output.Write(buffer, 0, count);
                remaining -= count;
            }
        }
    }
}
'@
  $csharp = $csharp.Replace('__VERSION__', $Version.Replace('\', '\\').Replace('"', '\"'))
  [IO.File]::WriteAllText($sourcePath, $csharp, [Text.Encoding]::UTF8)

  $csc = @(
    (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'),
    (Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe')
  ) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
  if (!$csc) { throw '.NET Framework C# compiler was not found.' }

  & $csc /nologo /target:winexe /optimize+ "/win32icon:$appIcon" "/out:$stubPath" $sourcePath
  if ($LASTEXITCODE -ne 0 -or !(Test-Path -LiteralPath $stubPath -PathType Leaf)) {
    throw 'Setup bootstrapper compilation failed.'
  }

  $output = [IO.File]::Open($installer, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
  try {
    foreach ($path in @($stubPath, $portable, $installScript, $uninstallScript)) {
      $input = [IO.File]::OpenRead($path)
      try { $input.CopyTo($output) } finally { $input.Dispose() }
    }

    $magic = [Text.Encoding]::ASCII.GetBytes('LITTLEBOTSETUP1')
    $output.Write($magic, 0, $magic.Length)
    $writer = New-Object IO.BinaryWriter($output, [Text.Encoding]::UTF8, $true)
    try {
      $writer.Write([int64](Get-Item -LiteralPath $portable).Length)
      $writer.Write([int64](Get-Item -LiteralPath $installScript).Length)
      $writer.Write([int64](Get-Item -LiteralPath $uninstallScript).Length)
      $writer.Flush()
    } finally {
      $writer.Dispose()
    }
  } finally {
    $output.Dispose()
  }

  if (!(Test-Path -LiteralPath $installer -PathType Leaf) -or (Get-Item -LiteralPath $installer).Length -lt 1024) {
    throw 'Installer executable was not created.'
  }

  Write-Host "Portable archive: $portable"
  Write-Host "Installer: $installer"
} finally {
  Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
}
