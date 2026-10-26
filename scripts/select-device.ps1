param([int]$BrowserPid, [string]$Model, [string]$ProfilePath)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$targetPattern = if ($Model -eq 'neo75cu') { 'NEO75' } else { 'Tofu|COM3' }
for ($attempt = 0; $attempt -lt 30; $attempt++) {
  $process = Get-Process -Id $BrowserPid -ErrorAction SilentlyContinue
  if (-not $process -or $process.MainWindowHandle -eq 0) {
    $owned = Get-CimInstance Win32_Process -Filter "name = 'chrome.exe'" | Where-Object { $_.CommandLine -like "*$ProfilePath*" }
    $process = $owned | ForEach-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue } | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  }
  if ($process -and $process.MainWindowHandle -ne 0) {
    $window = [System.Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)
    $items = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    $selected = $false
    foreach ($item in $items) {
      if ($item.Current.Name -match $targetPattern) {
        $selection = $null
        if ($item.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$selection)) {
          $selection.Select()
          $selected = $true
          Write-Output ('Selected: ' + $item.Current.Name)
          break
        }
      }
    }
    if ($selected) {
      foreach ($item in $items) {
        $connectName = [string][char]0x8fde + [char]0x63a5
        if ($item.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and $item.Current.IsEnabled -and ($item.Current.Name -eq 'Connect' -or $item.Current.Name -eq $connectName)) {
          $invoke = $item.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
          $invoke.Invoke()
          Write-Output 'Confirmed native browser chooser.'
          exit 0
        }
      }
    }
    if ($attempt -eq 25) {
      $items | ForEach-Object { if ($_.Current.Name) { '{0}: {1}' -f $_.Current.ControlType.ProgrammaticName, $_.Current.Name } } | Select-Object -First 90
    }
  }
  Start-Sleep -Milliseconds 700
}
throw 'Could not select the requested device in the isolated test browser.'
