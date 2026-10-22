---
name: pc-security-checkup
description: Check this Windows PC's security - antivirus and real-time protection, firewall, updates, disk encryption, admin accounts, remote access, sharing and startup programs - and explain in plain words what is fine and what to fix. Read-only unless the user asks for a change. Use when the user asks if their PC is safe, secure or up to date.
---
# PC security checkup

Look, explain, and change nothing unless asked. Never turn a protection off.

## Checks (read-only)

Run them one at a time; some need admin rights and may be refused. Say so and continue.

- Antivirus: `Get-MpComputerStatus | Select-Object AMServiceEnabled, AntivirusEnabled, RealTimeProtectionEnabled, AntivirusSignatureLastUpdated, QuickScanEndTime`
  Another antivirus may replace Defender: `Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct | Select-Object displayName, productState`
- Firewall: `Get-NetFirewallProfile | Select-Object Name, Enabled`
- Updates: `Get-HotFix | Sort-Object InstalledOn -Descending | Select-Object -First 5 HotFixID, InstalledOn`, and the Windows version: `Get-ComputerInfo -Property OsName, OsVersion, OsBuildNumber`
- Disk encryption: `Get-BitLockerVolume -ErrorAction SilentlyContinue | Select-Object MountPoint, ProtectionStatus, VolumeStatus` (needs admin; otherwise ask the user to look in Settings > Privacy & security > Device encryption).
- Administrators: `Get-LocalGroupMember -Group Administrators | Select-Object Name, ObjectClass`
- Remote Desktop: `(Get-ItemProperty 'HKLM:\System\CurrentControlSet\Control\Terminal Server').fDenyTSConnections` (1 means off).
- Shared folders: `Get-SmbShare | Where-Object Name -notmatch '\$$' | Select-Object Name, Path`
- User Account Control: `(Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System').EnableLUA` (1 means on).
- Startup programs: `Get-CimInstance Win32_StartupCommand | Select-Object Name, Command` (flag anything unknown, do not remove it).

## Report

A traffic-light table: check, status (good, attention, risk), what it means in one line, and how to fix it. Put the most important fixes first: protection off, updates more than a month old, no encryption on a laptop, unknown admin accounts, Remote Desktop open without need.

## Accounts and habits (advice only)

Recommend a password manager, unique passwords, two-factor sign-in on email, bank and social accounts, and backups that are not always plugged in. To check whether an email appears in known data leaks, tell the user to visit haveibeenpwned.com themselves: never put their email address or passwords into a search, URL or tool.

## Changes

Only on an explicit request, one at a time, explaining what will change first: turning protections on, running a Defender quick scan (`Start-MpScan -ScanType QuickScan`), opening the right Settings page (`start ms-settings:windowsupdate`). Never disable antivirus, the firewall or UAC, and never edit the registry for security settings.
