$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$nativeSource = @'
using System;
using System.Runtime.InteropServices;
public static class LittleBotWin32 {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "SendMessageW")] public static extern IntPtr SendMessageText(IntPtr hWnd, int msg, IntPtr wParam, string lParam);
  [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "SendMessageW")] public static extern IntPtr SendMessageBuffer(IntPtr hWnd, int msg, IntPtr wParam, System.Text.StringBuilder lParam);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int index);
  [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr hWnd);
  public static long Style(IntPtr hWnd) { return GetWindowLongPtr(hWnd, -16).ToInt64(); }
  [DllImport("oleacc.dll")] static extern int AccessibleObjectFromWindow(IntPtr hWnd, uint id, ref Guid iid, [MarshalAs(UnmanagedType.IDispatch)] out object accessible);
  static object Msaa(IntPtr hWnd) {
    Guid iid = new Guid("618736E0-3C3D-11CF-810C-00AA00389B71");
    object accessible;
    return AccessibleObjectFromWindow(hWnd, 0xFFFFFFFC, ref iid, out accessible) == 0 ? accessible : null;
  }
  static object Get(IntPtr hWnd, string member) {
    object accessible = Msaa(hWnd);
    if (accessible == null) return null;
    try { return accessible.GetType().InvokeMember(member, System.Reflection.BindingFlags.GetProperty, null, accessible, new object[] { 0 }); }
    catch { return null; }
  }
  public static int Role(IntPtr hWnd) { object value = Get(hWnd, "accRole"); return value is int ? (int)value : 0; }
  public static int State(IntPtr hWnd) { object value = Get(hWnd, "accState"); return value is int ? (int)value : 0; }
  public static string Name(IntPtr hWnd) { object value = Get(hWnd, "accName"); return value as string ?? ""; }
  public static void DoDefault(IntPtr hWnd) {
    object accessible = Msaa(hWnd);
    if (accessible == null) throw new InvalidOperationException("This control has no default action.");
    accessible.GetType().InvokeMember("accDoDefaultAction", System.Reflection.BindingFlags.InvokeMethod, null, accessible, new object[] { 0 });
  }
  public static string Text(IntPtr hWnd) {
    int length = SendMessage(hWnd, 0x000E, IntPtr.Zero, IntPtr.Zero).ToInt32();
    if (length <= 0) return "";
    var buffer = new System.Text.StringBuilder(Math.Min(length, 100000) + 1);
    SendMessageBuffer(hWnd, 0x000D, (IntPtr)buffer.Capacity, buffer);
    return buffer.ToString();
  }
}
'@
Add-Type -TypeDefinition $nativeSource -Language CSharp | Out-Null

function Has-Property($Value, [string]$Name) {
  return $null -ne $Value -and $null -ne $Value.PSObject.Properties[$Name]
}
function Optional($Value, [string]$Name, $Default = $null) {
  if (Has-Property $Value $Name) { return $Value.$Name }
  return $Default
}
function Safe-Text($Value, [int]$Maximum = 2000) {
  if ($null -eq $Value) { return '' }
  $text = [string]$Value
  if ($text.Length -gt $Maximum) { return $text.Substring(0, $Maximum) }
  return $text
}
function Write-Envelope([bool]$Ok, $Result, [string]$ErrorText = '') {
  $value = if ($Ok) { [ordered]@{ ok = $true; result = $Result } } else { [ordered]@{ ok = $false; error = (Safe-Text $ErrorText 2000) } }
  [Console]::Out.Write(($value | ConvertTo-Json -Depth 24 -Compress))
}
function Rect-Object($Rectangle) {
  if ($null -eq $Rectangle) { return $null }
  return [ordered]@{
    x = [int][Math]::Round($Rectangle.X); y = [int][Math]::Round($Rectangle.Y)
    width = [int][Math]::Round($Rectangle.Width); height = [int][Math]::Round($Rectangle.Height)
  }
}
# Standard Win32 controls (also inside WinForms apps) often reach the managed UI Automation client as bare panes
# without patterns. Recognise them by window class and style, and operate them with their own window messages.
function Hosted-Kind($Element) {
  try {
    $handle = [long]$Element.Current.NativeWindowHandle
    if ($handle -le 0 -or [string]$Element.Current.ControlType.ProgrammaticName -ne 'ControlType.Pane') { return $null }
    $class = [string]$Element.Current.ClassName
  } catch { return $null }
  # MSAA roles first: WinForms owner-draws buttons and checkboxes alike, but reports the true role.
  switch ([LittleBotWin32]::Role([IntPtr]$handle)) {
    0x2B { return 'Button' }
    0x2C { return 'CheckBox' }
    0x2D { return 'RadioButton' }
    0x2A { return 'Edit' }
    0x2E { return 'ComboBox' }
    0x29 { return 'Text' }
    0x1E { return 'Hyperlink' }
  }
  if ($class -match '(?i)(^|\.)button(\.|$)') {
    $style = [LittleBotWin32]::Style([IntPtr]$handle) -band 0xF
    if (@(2, 3, 5, 6) -contains $style) { return 'CheckBox' }
    if (@(4, 9) -contains $style) { return 'RadioButton' }
    if ($style -eq 7) { return $null }
    return 'Button'
  }
  if ($class -match '(?i)(^|\.)edit(\.|$)' -or $class -match '(?i)richedit') { return 'Edit' }
  if ($class -match '(?i)(^|\.)combobox(\.|$)') { return 'ComboBox' }
  if ($class -match '(?i)(^|\.)static(\.|$)') { return 'Text' }
  return $null
}
function Hosted-Handle($Element) { return [IntPtr][long]$Element.Current.NativeWindowHandle }
function Hosted-Checked($Element) {
  $handle = Hosted-Handle $Element
  # STATE_SYSTEM_CHECKED from MSAA; native BM_GETCHECK as a fallback for plain Win32 checkboxes.
  if (([LittleBotWin32]::State($handle) -band 0x10) -ne 0) { return $true }
  return [LittleBotWin32]::SendMessage($handle, 0x00F0, [IntPtr]::Zero, [IntPtr]::Zero).ToInt32() -eq 1
}
function Control-Type-Name($Element) {
  try {
    $hosted = Hosted-Kind $Element
    if ($hosted) { return $hosted }
    $name = [string]$Element.Current.ControlType.ProgrammaticName
    if ($name.StartsWith('ControlType.')) { return $name.Substring(12) }
    return $name
  } catch { return '' }
}
function Try-Pattern($Element, $PatternIdentifier) {
  $pattern = $null
  try {
    if ($Element.TryGetCurrentPattern($PatternIdentifier, [ref]$pattern)) { return $pattern }
  } catch {}
  return $null
}
function Element-Info($Element, [long]$WindowHandle, [int[]]$Path, [int]$Index = -1, [int]$ParentIndex = -1, [int]$Depth = 0) {
  $current = $Element.Current
  $patterns = New-Object System.Collections.Generic.List[string]
  $value = $null
  $toggleState = $null
  $invoke = Try-Pattern $Element ([System.Windows.Automation.InvokePattern]::Pattern)
  if ($null -ne $invoke) { $patterns.Add('invoke') }
  $valuePattern = Try-Pattern $Element ([System.Windows.Automation.ValuePattern]::Pattern)
  if ($null -ne $valuePattern) {
    $patterns.Add('value')
    try { $value = [string]([System.Windows.Automation.ValuePattern]$valuePattern).Current.Value } catch {}
  }
  $selection = Try-Pattern $Element ([System.Windows.Automation.SelectionItemPattern]::Pattern)
  if ($null -ne $selection) { $patterns.Add('selectionItem') }
  $toggle = Try-Pattern $Element ([System.Windows.Automation.TogglePattern]::Pattern)
  if ($null -ne $toggle) { $patterns.Add('toggle') }
  $expand = Try-Pattern $Element ([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
  if ($null -ne $expand) { $patterns.Add('expandCollapse') }
  $scroll = Try-Pattern $Element ([System.Windows.Automation.ScrollPattern]::Pattern)
  if ($null -ne $scroll) { $patterns.Add('scroll') }
  $hosted = Hosted-Kind $Element
  if ($hosted -and $patterns.Count -eq 0) {
    $hostedHandle = Hosted-Handle $Element
    if (@('Button') -contains $hosted) { $patterns.Add('invoke') }
    if (@('CheckBox', 'RadioButton') -contains $hosted) {
      $patterns.Add('toggle')
      $toggleState = if (Hosted-Checked $Element) { 'On' } else { 'Off' }
    }
    if (@('Edit', 'ComboBox') -contains $hosted) { $patterns.Add('value'); $value = [LittleBotWin32]::Text($hostedHandle) }
  }
  $name = Safe-Text $current.Name 500
  if ($hosted -and -not $name) { $name = Safe-Text ([LittleBotWin32]::Name((Hosted-Handle $Element))) 500 }
  $automationId = Safe-Text $current.AutomationId 500
  $controlType = Control-Type-Name $Element
  $className = Safe-Text $current.ClassName 300
  $locator = [ordered]@{ windowHandle = $WindowHandle; path = @($Path) }
  if ($automationId) { $locator.automationId = $automationId }
  if ($name) { $locator.name = $name }
  if ($controlType) { $locator.controlType = $controlType }
  if ($className) { $locator.className = $className }
  $result = [ordered]@{
    index = $Index; parentIndex = $ParentIndex; depth = $Depth
    name = $name; automationId = $automationId; controlType = $controlType; className = $className
    processId = [int]$current.ProcessId; nativeWindowHandle = [long]$current.NativeWindowHandle
    isEnabled = [bool]$current.IsEnabled; isOffscreen = [bool]$current.IsOffscreen
    hasKeyboardFocus = [bool]$current.HasKeyboardFocus; bounds = Rect-Object $current.BoundingRectangle
    patterns = $patterns.ToArray(); locator = $locator
  }
  if ($null -ne $value) { $result.value = Safe-Text $value 4000 }
  if ($null -ne $selection) {
    try { $result.isSelected = [bool]([System.Windows.Automation.SelectionItemPattern]$selection).Current.IsSelected } catch {}
  }
  if ($null -ne $toggle) {
    try { $result.toggleState = [string]([System.Windows.Automation.TogglePattern]$toggle).Current.ToggleState } catch {}
  } elseif ($toggleState) { $result.toggleState = $toggleState }
  if ($null -ne $expand) {
    try { $result.expandCollapseState = [string]([System.Windows.Automation.ExpandCollapsePattern]$expand).Current.ExpandCollapseState } catch {}
  }
  return $result
}
function Window-Element([long]$WindowHandle) {
  if ($WindowHandle -le 0) { throw 'Invalid window handle.' }
  try {
    $element = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$WindowHandle)
    if ($null -eq $element) { throw 'Window not found.' }
    return $element
  } catch { throw 'The selected window is unavailable.' }
}
function Child-Collection($Element) {
  # The leading comma keeps the collection whole: PowerShell would unwrap a one-child result into a bare element.
  return ,$Element.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
}
function Entries($Root, [int]$Maximum = 5000, [int]$MaximumDepth = 32) {
  $queue = New-Object System.Collections.Queue
  $queue.Enqueue([pscustomobject]@{ Element = $Root; Path = [int[]]@(); Depth = 0; ParentIndex = -1 })
  $result = New-Object System.Collections.Generic.List[object]
  while ($queue.Count -gt 0 -and $result.Count -lt $Maximum) {
    $entry = $queue.Dequeue()
    $index = $result.Count
    $result.Add([pscustomobject]@{ Element = $entry.Element; Path = [int[]]@($entry.Path); Depth = [int]$entry.Depth; ParentIndex = [int]$entry.ParentIndex; Index = $index })
    if ($entry.Depth -ge $MaximumDepth) { continue }
    try { $children = Child-Collection $entry.Element } catch { continue }
    for ($childIndex = 0; $childIndex -lt $children.Count -and ($result.Count + $queue.Count) -lt $Maximum; $childIndex++) {
      $childPath = [int[]](@($entry.Path) + [int]$childIndex)
      $queue.Enqueue([pscustomobject]@{ Element = $children.Item($childIndex); Path = $childPath; Depth = $entry.Depth + 1; ParentIndex = $index })
    }
  }
  return $result.ToArray()
}
function String-Equals($Left, $Right) {
  return [string]::Equals([string]$Left, [string]$Right, [System.StringComparison]::OrdinalIgnoreCase)
}
# The name the agent saw: UI Automation's, or MSAA's for a hosted control with none.
function Element-Name($Element) {
  $name = [string]$Element.Current.Name
  if (-not $name -and (Hosted-Kind $Element)) { $name = [LittleBotWin32]::Name((Hosted-Handle $Element)) }
  return $name
}
function Matches($Element, $Query) {
  try {
    $current = $Element.Current
    $elementName = if ((Has-Property $Query 'name') -or (Has-Property $Query 'containsName')) { Element-Name $Element } else { '' }
    if (Has-Property $Query 'name') { if (-not (String-Equals $elementName $Query.name)) { return $false } }
    if (Has-Property $Query 'containsName') {
      if ($elementName -eq '' -or $elementName.IndexOf([string]$Query.containsName, [System.StringComparison]::OrdinalIgnoreCase) -lt 0) { return $false }
    }
    if (Has-Property $Query 'automationId') { if (-not (String-Equals $current.AutomationId $Query.automationId)) { return $false } }
    if (Has-Property $Query 'controlType') { if (-not (String-Equals (Control-Type-Name $Element) $Query.controlType)) { return $false } }
    if (Has-Property $Query 'className') { if (-not (String-Equals $current.ClassName $Query.className)) { return $false } }
    return $true
  } catch { return $false }
}
function Locator-Query($Locator) {
  $query = [ordered]@{}
  foreach ($name in @('name', 'automationId', 'controlType', 'className')) {
    if (Has-Property $Locator $name -and [string]$Locator.$name -ne '') { $query[$name] = [string]$Locator.$name }
  }
  return [pscustomobject]$query
}
function Resolve-Locator($Locator) {
  if ($null -eq $Locator -or -not (Has-Property $Locator 'windowHandle')) { throw 'A UI Automation locator is required.' }
  $windowHandle = [long]$Locator.windowHandle
  $window = Window-Element $windowHandle
  if (Has-Property $Locator 'path') {
    $candidate = $window
    $valid = $true
    foreach ($position in @($Locator.path)) {
      try {
        $children = Child-Collection $candidate
        $index = [int]$position
        if ($index -lt 0 -or $index -ge $children.Count) { $valid = $false; break }
        $candidate = $children.Item($index)
      } catch { $valid = $false; break }
    }
    if ($valid -and (Matches $candidate (Locator-Query $Locator))) { return $candidate }
  }
  $query = Locator-Query $Locator
  foreach ($entry in Entries $window 5000 32) {
    if (Matches $entry.Element $query) { return $entry.Element }
  }
  throw 'The UI element is no longer available. Take a fresh snapshot or find it again.'
}
function Find-Result($Request) {
  $windowHandle = [long]$Request.windowHandle
  $window = Window-Element $windowHandle
  $maximum = [int](Optional $Request 'maxResults' 20)
  $includeOffscreen = [bool](Optional $Request 'includeOffscreen' $false)
  $matches = New-Object System.Collections.Generic.List[object]
  foreach ($entry in Entries $window 5000 32) {
    if ($matches.Count -ge $maximum) { break }
    if (-not (Matches $entry.Element $Request.query)) { continue }
    try { if (-not $includeOffscreen -and $entry.Element.Current.IsOffscreen) { continue } } catch { continue }
    try { $matches.Add((Element-Info $entry.Element $windowHandle $entry.Path $entry.Index $entry.ParentIndex $entry.Depth)) } catch {}
  }
  return [ordered]@{ windowHandle = $windowHandle; matches = $matches.ToArray(); truncated = ($matches.Count -ge $maximum) }
}
function Focus-Window([long]$WindowHandle) {
  $element = Window-Element $WindowHandle
  [LittleBotWin32]::ShowWindowAsync([IntPtr]$WindowHandle, 9) | Out-Null
  [LittleBotWin32]::SetForegroundWindow([IntPtr]$WindowHandle) | Out-Null
  try { $element.SetFocus() } catch {}
  Start-Sleep -Milliseconds 100
  return Element-Info $element $WindowHandle ([int[]]@()) 0 -1 0
}
function Escape-SendKeys([string]$Text) {
  $builder = New-Object System.Text.StringBuilder
  foreach ($character in $Text.ToCharArray()) {
    switch ([string]$character) {
      "`r" { continue }
      "`n" { [void]$builder.Append('{ENTER}'); continue }
      "`t" { [void]$builder.Append('{TAB}'); continue }
      '+' { [void]$builder.Append('{+}'); continue }
      '^' { [void]$builder.Append('{^}'); continue }
      '%' { [void]$builder.Append('{%}'); continue }
      '~' { [void]$builder.Append('{~}'); continue }
      '(' { [void]$builder.Append('{(}'); continue }
      ')' { [void]$builder.Append('{)}'); continue }
      '[' { [void]$builder.Append('{[}'); continue }
      ']' { [void]$builder.Append('{]}'); continue }
      '{' { [void]$builder.Append('{{}'); continue }
      '}' { [void]$builder.Append('{}}'); continue }
      default { [void]$builder.Append($character) }
    }
  }
  return $builder.ToString()
}
function Scroll-Amount([string]$Name) {
  switch ($Name) {
    'smallIncrement' { return [System.Windows.Automation.ScrollAmount]::SmallIncrement }
    'smallDecrement' { return [System.Windows.Automation.ScrollAmount]::SmallDecrement }
    'largeIncrement' { return [System.Windows.Automation.ScrollAmount]::LargeIncrement }
    'largeDecrement' { return [System.Windows.Automation.ScrollAmount]::LargeDecrement }
    default { return [System.Windows.Automation.ScrollAmount]::NoAmount }
  }
}
function Capture-Screen($Request) {
  $root = [string]$Request.screenshotRoot
  if (-not [System.IO.Path]::IsPathRooted($root)) { throw 'Screenshot folder is unavailable.' }
  [System.IO.Directory]::CreateDirectory($root) | Out-Null
  $windowHandle = if (Has-Property $Request 'windowHandle') { [long]$Request.windowHandle } else { 0 }
  if ($windowHandle -gt 0) {
    $rect = New-Object LittleBotWin32+RECT
    if (-not [LittleBotWin32]::GetWindowRect([IntPtr]$windowHandle, [ref]$rect)) { throw 'The window bounds are unavailable.' }
    $x = $rect.Left; $y = $rect.Top; $width = $rect.Right - $rect.Left; $height = $rect.Bottom - $rect.Top
  } else {
    $screen = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $x = $screen.X; $y = $screen.Y; $width = $screen.Width; $height = $screen.Height
  }
  if ($width -le 0 -or $height -le 0 -or $width -gt 20000 -or $height -gt 20000) { throw 'The capture bounds are invalid.' }
  $baseName = if (Has-Property $Request 'name' -and [string]$Request.name) { [string]$Request.name } else { 'windows-ui' }
  $baseName = [System.Text.RegularExpressions.Regex]::Replace($baseName, '[^A-Za-z0-9._ -]', '_').Trim()
  if (-not $baseName) { $baseName = 'windows-ui' }
  $fileName = '{0}-{1}-{2}.png' -f $baseName, [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmssfff'), [Guid]::NewGuid().ToString('N').Substring(0, 8)
  $filePath = [System.IO.Path]::Combine($root, $fileName)
  $bitmap = New-Object System.Drawing.Bitmap($width, $height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  try {
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try { $graphics.CopyFromScreen($x, $y, 0, 0, (New-Object System.Drawing.Size($width, $height)), [System.Drawing.CopyPixelOperation]::SourceCopy) }
    finally { $graphics.Dispose() }
    $bitmap.Save($filePath, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally { $bitmap.Dispose() }
  return [ordered]@{ path = $filePath; width = $width; height = $height; windowHandle = if ($windowHandle -gt 0) { $windowHandle } else { $null } }
}

try {
  $raw = [Console]::In.ReadToEnd()
  if ([System.Text.Encoding]::UTF8.GetByteCount($raw) -gt 60000) { throw 'Windows UI Automation request is too large.' }
  $request = $raw | ConvertFrom-Json
  $action = [string]$request.action
  switch ($action) {
    'windows_list' {
      $limit = [int](Optional $request 'limit' 50)
      $includeUntitled = [bool](Optional $request 'includeUntitled' $false)
      $windows = New-Object System.Collections.Generic.List[object]
      $root = [System.Windows.Automation.AutomationElement]::RootElement
      $children = Child-Collection $root
      for ($index = 0; $index -lt $children.Count -and $windows.Count -lt $limit; $index++) {
        $element = $children.Item($index)
        try {
          $current = $element.Current
          $handle = [long]$current.NativeWindowHandle
          $name = Safe-Text $current.Name 500
          $bounds = $current.BoundingRectangle
          if ($handle -le 0 -or $current.IsOffscreen -or $bounds.Width -le 0 -or $bounds.Height -le 0 -or (-not $includeUntitled -and -not $name)) { continue }
          $processName = ''
          try { $processName = (Get-Process -Id ([int]$current.ProcessId) -ErrorAction Stop).ProcessName } catch {}
          $windows.Add([ordered]@{
            windowHandle = $handle; name = $name; processId = [int]$current.ProcessId; processName = Safe-Text $processName 200
            className = Safe-Text $current.ClassName 300; bounds = Rect-Object $bounds
            isEnabled = [bool]$current.IsEnabled; hasKeyboardFocus = [bool]$current.HasKeyboardFocus
          })
        } catch {}
      }
      Write-Envelope $true ([ordered]@{ windows = $windows.ToArray() })
    }
    'window_focus' {
      $target = Focus-Window ([long]$request.windowHandle)
      Write-Envelope $true ([ordered]@{ focused = $true; window = $target })
    }
    'uia_snapshot' {
      $windowHandle = [long]$request.windowHandle
      $root = Window-Element $windowHandle
      if (Has-Property $request 'locator' -and $null -ne $request.locator) { $root = Resolve-Locator $request.locator }
      $maximum = [int](Optional $request 'maxElements' 200)
      $maximumDepth = [int](Optional $request 'maxDepth' 4)
      $includeOffscreen = [bool](Optional $request 'includeOffscreen' $false)
      $elements = New-Object System.Collections.Generic.List[object]
      $entries = Entries $root ($maximum + 1) $maximumDepth
      foreach ($entry in $entries) {
        if ($elements.Count -ge $maximum) { break }
        try { if (-not $includeOffscreen -and $entry.Element.Current.IsOffscreen) { continue } } catch { continue }
        try { $elements.Add((Element-Info $entry.Element $windowHandle $entry.Path $entry.Index $entry.ParentIndex $entry.Depth)) } catch {}
      }
      Write-Envelope $true ([ordered]@{ windowHandle = $windowHandle; elements = $elements.ToArray(); truncated = ($entries.Count -gt $maximum) })
    }
    'uia_find' { Write-Envelope $true (Find-Result $request) }
    'uia_invoke' {
      $element = Resolve-Locator $request.locator
      $pattern = Try-Pattern $element ([System.Windows.Automation.InvokePattern]::Pattern)
      if ($null -ne $pattern) { ([System.Windows.Automation.InvokePattern]$pattern).Invoke() }
      elseif (Hosted-Kind $element) {
        if ([string]$element.Current.ClassName -match '(?i)(^|\.)button(\.|$)') {
          # Posted, not sent: a click that opens a modal dialog must not block the bridge.
          [LittleBotWin32]::PostMessage((Hosted-Handle $element), 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
        } else { [LittleBotWin32]::DoDefault((Hosted-Handle $element)) }
      } else { throw 'This element does not support Invoke.' }
      Start-Sleep -Milliseconds 100
      Write-Envelope $true ([ordered]@{ invoked = $true; target = Element-Info $element ([long]$request.locator.windowHandle) ([int[]]@($request.locator.path)) })
    }
    'uia_set_value' {
      $element = Resolve-Locator $request.locator
      $pattern = Try-Pattern $element ([System.Windows.Automation.ValuePattern]::Pattern)
      $hosted = Hosted-Kind $element
      if ($null -ne $pattern) {
        $typed = [System.Windows.Automation.ValuePattern]$pattern
        if ($typed.Current.IsReadOnly) { throw 'This element is read-only.' }
        $typed.SetValue([string]$request.value)
      } elseif ($hosted -eq 'Edit') {
        if (([LittleBotWin32]::Style((Hosted-Handle $element)) -band 0x0800) -ne 0) { throw 'This field is read-only.' }
        [LittleBotWin32]::SendMessageText((Hosted-Handle $element), 0x000C, [IntPtr]::Zero, [string]$request.value) | Out-Null
      } elseif ($hosted -eq 'ComboBox') {
        # Pick the entry by its text, then tell the owner window as a user's choice would (CBN_SELCHANGE).
        $handle = Hosted-Handle $element
        if ([LittleBotWin32]::SendMessageText($handle, 0x014D, [IntPtr](-1), [string]$request.value).ToInt64() -lt 0) { throw 'No entry in this list starts with that text.' }
        $id = [LittleBotWin32]::GetDlgCtrlID($handle)
        [LittleBotWin32]::SendMessage([LittleBotWin32]::GetParent($handle), 0x0111, [IntPtr](($id -band 0xFFFF) -bor (1 -shl 16)), $handle) | Out-Null
      } else { throw 'This element does not support setting a value.' }
      Start-Sleep -Milliseconds 100
      Write-Envelope $true ([ordered]@{ changed = $true; target = Element-Info $element ([long]$request.locator.windowHandle) ([int[]]@($request.locator.path)) })
    }
    'uia_select' {
      $element = Resolve-Locator $request.locator
      $selected = if (Has-Property $request 'selected') { [bool]$request.selected } else { $true }
      $selection = Try-Pattern $element ([System.Windows.Automation.SelectionItemPattern]::Pattern)
      if ($null -ne $selection) {
        $typed = [System.Windows.Automation.SelectionItemPattern]$selection
        if ($selected) { $typed.Select() } else { $typed.RemoveFromSelection() }
      } else {
        $toggle = Try-Pattern $element ([System.Windows.Automation.TogglePattern]::Pattern)
        if ($null -eq $toggle -and @('CheckBox', 'RadioButton') -contains (Hosted-Kind $element)) {
          for ($attempt = 0; $attempt -lt 3 -and (Hosted-Checked $element) -ne $selected; $attempt++) { [LittleBotWin32]::DoDefault((Hosted-Handle $element)); Start-Sleep -Milliseconds 80 }
          if ((Hosted-Checked $element) -ne $selected) { throw 'The element did not reach the requested selection state.' }
          Start-Sleep -Milliseconds 100
          Write-Envelope $true ([ordered]@{ selected = $selected; target = Element-Info $element ([long]$request.locator.windowHandle) ([int[]]@($request.locator.path)) })
          return
        }
        if ($null -eq $toggle) { throw 'This element does not support selection or toggle.' }
        $typed = [System.Windows.Automation.TogglePattern]$toggle
        $wanted = if ($selected) { [System.Windows.Automation.ToggleState]::On } else { [System.Windows.Automation.ToggleState]::Off }
        for ($attempt = 0; $attempt -lt 3 -and $typed.Current.ToggleState -ne $wanted; $attempt++) { $typed.Toggle(); Start-Sleep -Milliseconds 50 }
        if ($typed.Current.ToggleState -ne $wanted) { throw 'The element did not reach the requested selection state.' }
      }
      Start-Sleep -Milliseconds 100
      Write-Envelope $true ([ordered]@{ selected = $selected; target = Element-Info $element ([long]$request.locator.windowHandle) ([int[]]@($request.locator.path)) })
    }
    'uia_expand' {
      $element = Resolve-Locator $request.locator
      $pattern = Try-Pattern $element ([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
      if ($null -eq $pattern) { throw 'This element does not support expand or collapse.' }
      $typed = [System.Windows.Automation.ExpandCollapsePattern]$pattern
      $state = [string]$request.state
      if ($state -eq 'expand') { $typed.Expand() }
      elseif ($state -eq 'collapse') { $typed.Collapse() }
      elseif ($typed.Current.ExpandCollapseState -eq [System.Windows.Automation.ExpandCollapseState]::Collapsed) { $typed.Expand() }
      else { $typed.Collapse() }
      Start-Sleep -Milliseconds 100
      Write-Envelope $true ([ordered]@{ state = [string]$typed.Current.ExpandCollapseState; target = Element-Info $element ([long]$request.locator.windowHandle) ([int[]]@($request.locator.path)) })
    }
    'uia_scroll' {
      $element = Resolve-Locator $request.locator
      $pattern = Try-Pattern $element ([System.Windows.Automation.ScrollPattern]::Pattern)
      if ($null -eq $pattern) { throw 'This element does not support scrolling.' }
      $horizontal = Scroll-Amount ([string](Optional $request 'horizontal' 'noAmount'))
      $vertical = Scroll-Amount ([string](Optional $request 'vertical' 'noAmount'))
      ([System.Windows.Automation.ScrollPattern]$pattern).Scroll($horizontal, $vertical)
      Start-Sleep -Milliseconds 100
      Write-Envelope $true ([ordered]@{ scrolled = $true; target = Element-Info $element ([long]$request.locator.windowHandle) ([int[]]@($request.locator.path)) })
    }
    'keyboard_send' {
      $windowHandle = if (Has-Property $request 'locator' -and $null -ne $request.locator) { [long]$request.locator.windowHandle } else { [long]$request.windowHandle }
      Focus-Window $windowHandle | Out-Null
      if (Has-Property $request 'locator' -and $null -ne $request.locator) {
        $element = Resolve-Locator $request.locator
        try { $element.SetFocus() } catch { throw 'The selected element cannot receive keyboard focus.' }
      }
      Start-Sleep -Milliseconds 50
      if (Has-Property $request 'text') { [System.Windows.Forms.SendKeys]::SendWait((Escape-SendKeys ([string]$request.text))) }
      if (Has-Property $request 'keys') { [System.Windows.Forms.SendKeys]::SendWait([string]$request.keys) }
      Start-Sleep -Milliseconds 100
      Write-Envelope $true ([ordered]@{ sent = $true; windowHandle = $windowHandle })
    }
    'screen_capture' { Write-Envelope $true (Capture-Screen $request) }
    default { throw 'Unsupported Windows UI Automation bridge action.' }
  }
} catch {
  Write-Envelope $false $null ("{0}: {1}" -f $action, $_.Exception.Message)
}
