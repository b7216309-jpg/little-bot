'use strict';

const { spawn } = require('node:child_process');

// Opt-in awareness of what the user is doing: the foreground app and idle time.
// Samples stay in memory; nothing is written to disk or sent anywhere except into
// the model prompts of this app while the setting is on.
const SAMPLE_SECONDS = 20;
const APP_SETTLE_MS = 2 * 60000;
const LONG_SESSION_MS = 3 * 3600000;
const AWAY_MS = 90 * 60000;
const REPEAT_START_MS = 30 * 60000;
const IGNORED = new Set(['little bot', 'explorer', 'searchhost', 'shellexperiencehost', 'startmenuexperiencehost', 'lockapp', 'applicationframehost', 'textinputhost', 'idle', '']);

// One long-lived PowerShell process; Add-Type compiles once instead of every sample.
const PROBE = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public static class LbForeground {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
}
"@
while ($true) {
  $h = [LbForeground]::GetForegroundWindow(); $p = 0; [void][LbForeground]::GetWindowThreadProcessId($h, [ref]$p)
  $sb = New-Object System.Text.StringBuilder 256; [void][LbForeground]::GetWindowText($h, $sb, 256)
  $name = ''; try { $name = (Get-Process -Id $p).ProcessName } catch {}
  [Console]::Out.WriteLine((@{ app = $name; title = $sb.ToString() } | ConvertTo-Json -Compress))
  Start-Sleep -Seconds ${SAMPLE_SECONDS}
}`;

class ActivityMonitor {
  constructor({ publish = () => {}, idleSeconds = () => 0, now = Date.now, spawnProbe = null } = {}) {
    this.publish = publish;
    this.idleSeconds = idleSeconds;
    this.now = now;
    this.spawnProbe = spawnProbe || (() => spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', PROBE], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }));
    this.child = null;
    this.current = null;
    this.recent = [];
    this.lastStart = new Map();
    this.awaySince = null;
  }

  get running() { return Boolean(this.child); }

  start() {
    if (this.child) return;
    this.child = this.spawnProbe();
    let buffer = '';
    this.child.stdout?.on('data', chunk => {
      buffer += chunk.toString('utf8');
      let line;
      while ((line = buffer.indexOf('\n')) >= 0) {
        const text = buffer.slice(0, line).trim(); buffer = buffer.slice(line + 1);
        if (!text) continue;
        try { this.sample(JSON.parse(text)); } catch { /* Ignore a malformed sample. */ }
      }
    });
    this.child.on?.('exit', () => { this.child = null; });
  }

  stop() {
    try { this.child?.kill(); } catch { /* Already gone. */ }
    this.child = null; this.current = null; this.recent = []; this.awaySince = null;
  }

  sample({ app = '', title = '' } = {}) {
    const nowMs = this.now();
    const name = String(app || '').slice(0, 80);
    const idleMs = Math.max(0, Number(this.idleSeconds()) || 0) * 1000;
    if (idleMs >= 10 * 60000) this.awaySince ??= nowMs - idleMs;
    else if (this.awaySince !== null) {
      const away = nowMs - this.awaySince;
      this.awaySince = null;
      if (away >= AWAY_MS) this.publish({ type: 'user.returned', source: 'activity', payload: { awayMinutes: Math.round(away / 60000) } });
    }
    if (IGNORED.has(name.toLowerCase())) return;
    if (!this.current || this.current.app !== name) {
      if (this.current) this.recent = [...this.recent, { app: this.current.app, start: this.current.since, end: nowMs }].slice(-10);
      this.current = { app: name, title: String(title || '').slice(0, 80), since: nowMs, announced: false, longAnnounced: false };
      return;
    }
    this.current.title = String(title || '').slice(0, 80);
    const duration = nowMs - this.current.since;
    if (!this.current.announced && duration >= APP_SETTLE_MS) {
      this.current.announced = true;
      const previous = this.lastStart.get(name);
      this.lastStart.set(name, nowMs);
      if (previous === undefined || nowMs - previous >= REPEAT_START_MS) this.publish({ type: 'activity.app_started', source: 'activity', payload: { app: name, title: this.current.title } });
    }
    if (!this.current.longAnnounced && duration >= LONG_SESSION_MS) {
      this.current.longAnnounced = true;
      this.publish({ type: 'activity.long_session', source: 'activity', payload: { app: name, hours: Math.round(duration / 360000) / 10 } });
    }
  }

  // A short description for model prompts; null while the setting is off or nothing is known yet.
  snapshot() {
    if (!this.child || !this.current) return null;
    const nowMs = this.now();
    return {
      app: this.current.app, windowTitle: this.current.title,
      minutesInApp: Math.round((nowMs - this.current.since) / 60000),
      idleMinutes: Math.round((Number(this.idleSeconds()) || 0) / 60),
      earlierToday: this.recent.filter(item => new Date(item.end).toDateString() === new Date(nowMs).toDateString())
        .map(item => ({ app: item.app, minutes: Math.round((item.end - item.start) / 60000) })).filter(item => item.minutes >= 5).slice(-5),
    };
  }
}

module.exports = { ActivityMonitor, SAMPLE_SECONDS };
