param(
  [Parameter(Mandatory = $true)][string]$Title,
  [Parameter(Mandatory = $true)][string]$ReadyFile
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$form = New-Object System.Windows.Forms.Form
$form.Text = $Title
$form.Name = 'LittleBotUiaFixture'
$form.AccessibleName = $Title
$form.StartPosition = 'CenterScreen'
$form.Size = New-Object System.Drawing.Size(520, 330)
$form.TopMost = $false

$nameLabel = New-Object System.Windows.Forms.Label
$nameLabel.Text = 'Name'
$nameLabel.Location = New-Object System.Drawing.Point(24, 28)
$nameLabel.AutoSize = $true
$form.Controls.Add($nameLabel)

$nameBox = New-Object System.Windows.Forms.TextBox
$nameBox.Name = 'NameBox'
$nameBox.AccessibleName = 'Name input'
$nameBox.Location = New-Object System.Drawing.Point(24, 52)
$nameBox.Size = New-Object System.Drawing.Size(300, 28)
$form.Controls.Add($nameBox)

$agree = New-Object System.Windows.Forms.CheckBox
$agree.Name = 'AgreeBox'
$agree.AccessibleName = 'Agree'
$agree.Text = 'Agree'
$agree.Location = New-Object System.Drawing.Point(24, 96)
$agree.AutoSize = $true
$form.Controls.Add($agree)

$choice = New-Object System.Windows.Forms.ComboBox
$choice.Name = 'ChoiceBox'
$choice.AccessibleName = 'Choice'
$choice.DropDownStyle = [System.Windows.Forms.ComboBoxStyle]::DropDownList
[void]$choice.Items.Add('Alpha')
[void]$choice.Items.Add('Beta')
[void]$choice.Items.Add('Gamma')
$choice.SelectedIndex = 0
$choice.Location = New-Object System.Drawing.Point(24, 132)
$choice.Size = New-Object System.Drawing.Size(200, 28)
$form.Controls.Add($choice)

$save = New-Object System.Windows.Forms.Button
$save.Name = 'SaveButton'
$save.AccessibleName = 'Save'
$save.Text = 'Save'
$save.Location = New-Object System.Drawing.Point(24, 182)
$save.Size = New-Object System.Drawing.Size(110, 34)
$form.Controls.Add($save)

$status = New-Object System.Windows.Forms.Label
$status.Name = 'StatusLabel'
$status.AccessibleName = 'Status Idle'
$status.Text = 'Status Idle'
$status.Location = New-Object System.Drawing.Point(24, 238)
$status.AutoSize = $true
$form.Controls.Add($status)

$save.Add_Click({
  $value = 'Saved:{0}:{1}:{2}' -f $nameBox.Text, $agree.Checked, $choice.SelectedItem
  $status.Text = $value
  $status.AccessibleName = $value
})

$form.Add_Shown({
  $record = @{ handle = [long]$form.Handle; processId = $PID; title = $Title } | ConvertTo-Json -Compress
  [System.IO.File]::WriteAllText($ReadyFile, $record, (New-Object System.Text.UTF8Encoding($false)))
  $form.Activate()
})

[System.Windows.Forms.Application]::Run($form)
