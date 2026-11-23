# The chutvrc installer for Windows, started by install-windows.bat. It does what
# local-setup-windows.bat does, as a wizard: the long steps are the functions of
# local-setup-common.sh, run in the background through bin/setup-step.
#
# Keep this file ASCII: Windows PowerShell reads a file without a byte order mark in the
# system code page.

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing

$script:Root = Split-Path -Parent $PSScriptRoot
$script:LogDir = Join-Path $env:LOCALAPPDATA 'chutvrc-setup'
$script:LogFile = Join-Path $script:LogDir ('setup-{0:yyyyMMdd-HHmmss}.log' -f (Get-Date))
$script:LogPosition = 0
$script:GitBash = $null
$script:Running = $null
$script:UI = @{}
$script:Page = 'welcome'
$script:Steps = @()
$script:StepIndex = -1
$script:StartOnly = $false
$script:SignInRound = 1
$script:PreviousLink = ''
$script:CurrentLink = ''
$script:LinkTries = 0
$script:Checking = $false

$script:GuideUrl = 'https://github.com/pf-hubs/chutvrc-hubs-compose#after-setup'
$script:CheckMark = [string][char]0x2713
$script:Arrow = [string][char]0x25B6
$script:FontBody = New-Object System.Drawing.Font('Segoe UI', 9.5)
$script:FontBold = New-Object System.Drawing.Font('Segoe UI', 9.5, [System.Drawing.FontStyle]::Bold)
$script:FontTitle = New-Object System.Drawing.Font('Segoe UI', 13, [System.Drawing.FontStyle]::Bold)
$script:FontMono = New-Object System.Drawing.Font('Consolas', 8.5)
$script:Good = [System.Drawing.Color]::FromArgb(16, 124, 16)
$script:Bad = [System.Drawing.Color]::FromArgb(196, 43, 28)
$script:Muted = [System.Drawing.Color]::FromArgb(96, 96, 96)

# ---------- This computer ----------

function Update-SessionPath {
    $parts = @("$env:LOCALAPPDATA\mkcert", "$env:LOCALAPPDATA\mutagen") | Where-Object { Test-Path $_ }
    $parts = @($parts) + @([Environment]::GetEnvironmentVariable('PATH', 'Machine'), [Environment]::GetEnvironmentVariable('PATH', 'User'))
    $env:PATH = ($parts | Where-Object { $_ }) -join ';'
}

function Test-Command([string]$Name) {
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Find-GitBash {
    $known = @("$env:ProgramFiles\Git\bin\bash.exe", "${env:ProgramFiles(x86)}\Git\bin\bash.exe", "$env:LOCALAPPDATA\Programs\Git\bin\bash.exe")
    foreach ($path in $known) {
        if (Test-Path $path) { return $path }
    }
    $git = Get-Command git -ErrorAction SilentlyContinue
    if ($git) {
        $dir = Split-Path $git.Source
        foreach ($path in @((Join-Path $dir 'bash.exe'), (Join-Path $dir '..\bin\bash.exe'))) {
            if (Test-Path $path) { return (Resolve-Path $path).Path }
        }
    }
    return $null
}

function Get-ConfiguredHost {
    $file = Join-Path $script:Root '.env'
    if (-not (Test-Path $file)) { return $null }
    foreach ($line in Get-Content $file) {
        if ($line -match '^\s*HUBS_HOST=(.+)$') { return $Matches[1].Trim().Trim('"', "'") }
    }
    return $null
}

function Get-HostName {
    $configured = Get-ConfiguredHost
    if ($configured) { return $configured }
    return 'hubs.local'
}

function Get-BaseUrl { return 'https://{0}:4000' -f (Get-HostName) }

function Test-IPv4([string]$Value) {
    if ($Value -notmatch '^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$') { return $false }
    foreach ($i in 1..4) {
        if ([int]$Matches[$i] -gt 255) { return $false }
    }
    return $true
}

function Test-PublicDomainHost {
    $name = Get-ConfiguredHost
    return [bool]($name -and $name -ne 'hubs.local' -and -not (Test-IPv4 $name))
}

function Get-NetworkAddress {
    try {
        $config = Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } | Select-Object -First 1
        if ($config) { return [string]$config.IPv4Address.IPAddress }
    } catch { }
    return ''
}

function Set-ConfiguredHost([string]$Address) {
    $file = Join-Path $script:Root '.env'
    $prefix = ''
    if ((Test-Path $file) -and (Get-Item $file).Length -gt 0 -and -not (Get-Content $file -Raw).EndsWith("`n")) { $prefix = "`n" }
    [IO.File]::AppendAllText($file, "${prefix}HUBS_HOST=$Address`n")
}

function Test-HostsEntries {
    $hosts = Join-Path $env:WinDir 'System32\drivers\etc\hosts'
    return [bool](Select-String -Path $hosts -SimpleMatch -Pattern 'hubs-client' -Quiet)
}

# A clone made with core.autocrlf on has Windows line endings, which bash cannot run
function Test-CloneLineEndings {
    return -not (Get-Content (Join-Path $script:Root 'bin\up') -Raw).Contains("`r")
}

function Invoke-Hidden([string]$File, [string]$Arguments, [int]$TimeoutMs = 15000) {
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = $File
    $info.Arguments = $Arguments
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    try { $process = [System.Diagnostics.Process]::Start($info) } catch { return -1 }
    $clock = [System.Diagnostics.Stopwatch]::StartNew()
    while (-not $process.WaitForExit(50)) {
        [System.Windows.Forms.Application]::DoEvents()
        if ($clock.ElapsedMilliseconds -gt $TimeoutMs) {
            try { $process.Kill() } catch { }
            return -1
        }
    }
    return $process.ExitCode
}

function Add-MutagenToUserPath {
    $dir = "$env:LOCALAPPDATA\mutagen"
    if (-not (Test-Path (Join-Path $dir 'mutagen-compose.exe'))) { return }
    $userPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
    if (-not $userPath) { $userPath = '' }
    $parts = @($userPath -split ';' | Where-Object { $_ })
    if ($parts -notcontains $dir) {
        [Environment]::SetEnvironmentVariable('PATH', (($parts + $dir) -join ';'), 'User')
    }
}

# ---------- Background steps ----------

function Write-SetupLog([string]$Text) {
    [IO.File]::AppendAllText($script:LogFile, "$Text`n")
}

function Start-Step {
    param([string[]]$Step, [scriptblock]$OnExit, [string]$Output = $script:LogFile)
    if (-not $OnExit) { $OnExit = { param($code) Complete-InstallStep $code } }
    $script_ = (Join-Path $script:Root 'bin\setup-step') -replace '\\', '/'
    $env:CHUTVRC_SETUP_OUTPUT = $Output
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = $script:GitBash
    $info.Arguments = '--login "{0}" {1}' -f $script_, ($Step -join ' ')
    $info.WorkingDirectory = $script:Root
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $script:Running = @{ Process = [System.Diagnostics.Process]::Start($info); OnExit = $OnExit }
}

# Runs a step whose output is a value and hands it to $Then. The value never goes in the log.
function Read-StepValue {
    param([string]$Step, [scriptblock]$Then)
    $script:ValueFile = Join-Path $script:LogDir ('value-{0}.tmp' -f [guid]::NewGuid())
    $script:ValueThen = $Then
    Start-Step -Step $Step -Output $script:ValueFile -OnExit {
        param($code)
        $value = ''
        if (Test-Path $script:ValueFile) {
            $raw = Get-Content $script:ValueFile -Raw
            if ($raw) { $value = $raw.Trim() }
            Remove-Item $script:ValueFile -Force -ErrorAction SilentlyContinue
        }
        & $script:ValueThen $value
    }
}

function Stop-Running {
    $job = $script:Running
    $script:Running = $null
    if ($job -and -not $job.Process.HasExited) {
        [void](Invoke-Hidden 'taskkill.exe' ('/PID {0} /T /F' -f $job.Process.Id) 5000)
    }
}

function Read-NewLog {
    if (-not (Test-Path $script:LogFile)) { return }
    $stream = [IO.File]::Open($script:LogFile, 'Open', 'Read', 'ReadWrite, Delete')
    try {
        if ($stream.Length -le $script:LogPosition) { return }
        [void]$stream.Seek($script:LogPosition, 'Begin')
        $reader = New-Object IO.StreamReader($stream)
        $text = $reader.ReadToEnd()
        $script:LogPosition = $stream.Length
    } finally {
        $stream.Dispose()
    }
    $text = $text -replace "\x1b\[[0-9;?]*[A-Za-z]", ''
    $text = $text -replace "`r`n", "`n" -replace "`r", "`n"
    $box = $script:UI.Log
    if ($box.TextLength -gt 300000) { $box.Text = $box.Text.Substring(150000) }
    $windowsText = $text -replace "`n", "`r`n"
    $box.AppendText($windowsText)
    $last = $text -split "`n" | Where-Object { $_.Trim() } | Select-Object -Last 1
    if ($last) {
        $last = $last.Trim()
        if ($last.Length -gt 90) { $last = $last.Substring(0, 87) + '...' }
        $script:UI.InstallDetail.Text = $last
    }
}

function Invoke-Tick {
    try {
        if ($script:Page -eq 'install') { Read-NewLog }
        $job = $script:Running
        if ($job -and $job.Process.HasExited) {
            $script:Running = $null
            $code = $job.Process.ExitCode
            if ($script:Page -eq 'install') { Read-NewLog }
            & $job.OnExit $code
        }
    } catch {
        Show-Problem "Something went wrong: $($_.Exception.Message)"
    }
}

function Show-Problem([string]$Text) {
    if ($script:Page -eq 'install') {
        $script:UI.InstallError.Text = $Text
        $script:UI.InstallBar.Style = 'Blocks'
        $script:UI.Retry.Visible = $true
    } else {
        Set-SignInStatus $Text $script:Bad
        Set-SignInBusy $false
    }
}

# ---------- Install ----------

function Get-InstallSteps {
    if ($script:StartOnly) {
        return @(
            @{ Name = 'Starting chutvrc'; Run = { Start-Step -Step 'start_services' } },
            @{ Name = 'Waiting for chutvrc to be ready'; Run = { Start-Step -Step 'wait_for_services_healthy' } }
        )
    }
    return @(
        @{ Name = 'Preparing tools'; Run = { Start-ToolsStep } },
        @{ Name = 'Configuring this computer'; Run = { Start-HostsStep } },
        @{ Name = 'Downloading and building chutvrc (the longest step)'; Run = { Start-Step -Step 'run_init' } },
        @{ Name = 'Creating security certificates'; Run = { Start-Step -Step 'generate_certs' } },
        @{ Name = 'Applying the certificates'; Run = { Start-Step -Step 'copy_certs_to_services', 'rebuild_dialog' } },
        @{ Name = 'Starting chutvrc'; Run = { Start-Step -Step 'start_services' } },
        @{ Name = 'Waiting for chutvrc to be ready'; Run = { Start-Step -Step 'wait_for_services_healthy' } }
    )
}

function Start-ToolsStep {
    $current = & git config --global core.autocrlf 2>$null
    if ($current -ne 'false') {
        Write-SetupLog 'Setting git core.autocrlf to false.'
        & git config --global core.autocrlf false
    }
    if (Test-Command 'mkcert') {
        Complete-InstallStep 0
        return
    }
    Write-SetupLog 'Downloading mkcert.'
    Start-Step -Step 'install_mkcert' -OnExit {
        param($code)
        Update-SessionPath
        if (-not (Test-Command 'mkcert')) { $code = 1 }
        Complete-InstallStep $code
    }
}

function Start-HostsStep {
    if ((Get-HostName) -ne 'hubs.local' -or (Test-HostsEntries)) {
        Complete-InstallStep 0
        return
    }
    $script:UI.InstallDetail.Text = 'Windows will ask for permission to add hubs.local to this computer.'
    $file = Join-Path $script:Root 'bin\update-hosts.ps1'
    try {
        $process = Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -PassThru `
            -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$file`"")
    } catch {
        Write-SetupLog 'The request to edit the hosts file was declined.'
        Complete-InstallStep 1
        return
    }
    $script:Running = @{
        Process = $process
        OnExit  = { param($code) if (Test-HostsEntries) { Complete-InstallStep 0 } else { Complete-InstallStep 1 } }
    }
}

function Set-StepRow([int]$Index, [string]$Mark, $Color, $Font) {
    $row = $script:UI.StepRows[$Index]
    $row.Mark.Text = $Mark
    $row.Mark.ForeColor = $Color
    $row.Name.Font = $Font
}

function Start-Install {
    $script:Steps = @(Get-InstallSteps)
    $script:StepIndex = -1
    foreach ($i in 0..($script:UI.StepRows.Count - 1)) {
        $row = $script:UI.StepRows[$i]
        $row.Mark.Visible = $i -lt $script:Steps.Count
        $row.Name.Visible = $i -lt $script:Steps.Count
        if ($i -lt $script:Steps.Count) {
            $row.Name.Text = $script:Steps[$i].Name
            Set-StepRow $i '' $script:Muted $script:FontBody
        }
    }
    $script:UI.Retry.Visible = $false
    $script:UI.InstallError.Text = ''
    Invoke-NextStep
}

function Invoke-NextStep {
    $script:StepIndex++
    if ($script:StepIndex -ge $script:Steps.Count) {
        $script:UI.InstallBar.Style = 'Blocks'
        $script:UI.InstallBar.Value = 100
        if ($script:StartOnly) { Show-Page 'finish' } else { Enter-SignIn }
        return
    }
    $script:UI.InstallBar.Style = 'Marquee'
    $script:UI.InstallDetail.Text = ''
    Set-StepRow $script:StepIndex $script:Arrow ([System.Drawing.Color]::Black) $script:FontBold
    Write-SetupLog ("`n=== {0} ===" -f $script:Steps[$script:StepIndex].Name)
    & $script:Steps[$script:StepIndex].Run
}

function Complete-InstallStep($Code) {
    if ($Code -eq 0) {
        Set-StepRow $script:StepIndex $script:CheckMark $script:Good $script:FontBody
        Invoke-NextStep
        return
    }
    Set-StepRow $script:StepIndex 'X' $script:Bad $script:FontBold
    Show-Problem (Get-FailureHelp)
}

function Get-FailureHelp {
    $tail = ''
    if (Test-Path $script:LogFile) { $tail = (Get-Content $script:LogFile -Tail 60) -join "`n" }
    if ($tail -match 'unable to query daemon metadata|client version .* too old|minimum supported API') {
        return 'Docker is newer than Mutagen Compose supports. In Docker Desktop, open Settings > Docker Engine, add "min-api-version": "1.43" to the JSON, press Apply & restart, then press Try again.'
    }
    if ($script:Steps[$script:StepIndex].Name -eq 'Configuring this computer') {
        return 'Windows needs your permission to add hubs.local to this computer. Press Try again and choose Yes.'
    }
    return 'This step failed. Press Show details to see why, then Try again. Setup continues from this step.'
}

# ---------- Sign-in ----------

function Enter-SignIn {
    Show-Page 'signin'
    Set-SignInBusy $true
    Set-SignInStatus 'Checking whether an administrator exists...' $script:Muted
    Read-StepValue -Step 'admin_count' -Then {
        param($value)
        if ($value -match '^\d+$' -and [int]$value -gt 0) {
            Show-Page 'finish'
            return
        }
        Reset-SignIn
    }
}

function Reset-SignIn {
    $script:CurrentLink = ''
    $script:UI.LinkBox.Text = ''
    $script:UI.OpenLink.Enabled = $false
    $script:UI.CopyLink.Enabled = $false
    if ($script:SignInRound -eq 1) {
        $script:UI.Header.Text = 'Create your administrator account'
        $script:UI.SignInHelp.Text = "1.  Press Open chutvrc. If the page does not load yet, wait a minute and reload it.`r`n2.  Click Sign In and enter the email address for your administrator account.`r`n3.  Come back here and press Get my sign-in link."
    } else {
        $script:UI.Header.Text = 'Sign in again as administrator'
        $script:UI.SignInHelp.Text = "Your account is now an administrator. To activate that:`r`n1.  In the browser, sign out, then sign in again with the same email address.`r`n2.  Come back here and press Get my sign-in link."
    }
    Set-SignInBusy $true
    Set-SignInStatus '' $script:Muted
    Read-StepValue -Step 'latest_sign_in_link' -Then {
        param($value)
        $script:PreviousLink = $value
        Set-SignInBusy $false
    }
}

function Set-SignInBusy([bool]$Busy) {
    $script:UI.GetLink.Enabled = -not $Busy
    # Next checks the sign-in itself, so someone who signed in from an emailed link can go on
    $script:UI.Next.Enabled = -not $Busy
}

function Confirm-SignInTried {
    $answer = [System.Windows.Forms.MessageBox]::Show($script:UI.Form,
        'No new sign-in link was found. Have you already entered your email on the sign-in page and submitted it?',
        'Sign-in link', 'YesNo', 'Question')
    return $answer -eq 'Yes'
}

function Set-SignInStatus([string]$Text, $Color) {
    $script:UI.SignInStatus.ForeColor = $Color
    $script:UI.SignInStatus.Text = $Text
}

function Show-SignInLink([string]$Link, [string]$Message) {
    $script:CurrentLink = $Link
    $script:UI.LinkBox.Text = $Link
    $script:UI.OpenLink.Enabled = $true
    $script:UI.CopyLink.Enabled = $true
    Set-SignInStatus $Message $script:Good
    Set-SignInBusy $false
}

function Request-SignInLink {
    Set-SignInBusy $true
    Set-SignInStatus 'Looking for your sign-in link...' $script:Muted
    Read-StepValue -Step 'latest_sign_in_link' -Then {
        param($value)
        if ($value -and $value -ne $script:PreviousLink) {
            Show-SignInLink $value 'Found it. Open it in the SAME browser where you entered your email, then press Next.'
            return
        }
        Set-SignInBusy $false
        if (Confirm-SignInTried) {
            $script:LinkTries = 0
            Set-SignInBusy $true
            Set-SignInStatus 'Waiting for the link to arrive...' $script:Muted
            $script:UI.LinkTimer.Start()
        } else {
            Set-SignInStatus 'Please press Open chutvrc, click Sign In and enter your email first. Then press Get my sign-in link.' $script:Bad
        }
    }
}

function Invoke-LinkWait {
    $script:UI.LinkTimer.Stop()
    $script:LinkTries++
    Read-StepValue -Step 'latest_sign_in_link' -Then {
        param($value)
        if ($value -and $value -ne $script:PreviousLink) {
            Show-SignInLink $value 'Found it. Open it in the SAME browser where you entered your email, then press Next.'
        } elseif ($script:LinkTries -lt 10) {
            $script:UI.LinkTimer.Start()
        } elseif ($value) {
            Show-SignInLink $value 'No new link arrived. This is the most recent one, from an earlier attempt.'
        } else {
            Set-SignInBusy $false
            Set-SignInStatus 'Still no link. Check that the page said a link was sent, then press Get my sign-in link again.' $script:Bad
        }
    }
}

function Complete-SignIn {
    if ($script:SignInRound -eq 2) {
        Show-Page 'finish'
        return
    }
    Set-SignInBusy $true
    Set-SignInStatus 'Checking your sign-in...' $script:Muted
    Read-StepValue -Step 'account_count' -Then {
        param($value)
        if (-not ($value -match '^\d+$' -and [int]$value -gt 0)) {
            Set-SignInBusy $false
            Set-SignInStatus 'Sign-in has not finished yet. Open the link in the SAME browser, wait for it to confirm, then press Next.' $script:Bad
            return
        }
        Set-SignInStatus 'Making your account an administrator...' $script:Muted
        Start-Step -Step 'promote_first_account' -OnExit {
            param($code)
            Read-StepValue -Step 'admin_count' -Then {
                param($admins)
                if ($admins -match '^\d+$' -and [int]$admins -gt 0) {
                    $script:SignInRound = 2
                    Reset-SignIn
                } else {
                    Set-SignInBusy $false
                    Set-SignInStatus 'Could not make the account an administrator. Press Next to try again, or see MANUAL_SETUP.md, Step 7.' $script:Bad
                }
            }
        }
    }
}

# ---------- Requirements ----------

function Update-Requirements {
    if ($script:Checking) { return }
    $script:Checking = $true
    try {
        Update-SessionPath
        Add-MutagenToUserPath
        $script:GitBash = Find-GitBash
        $docker = 'Not installed'
        $dockerOk = $false
        if (Test-Command 'docker') {
            if ((Invoke-Hidden 'docker' 'info') -eq 0) {
                $docker = 'Running'
                $dockerOk = $true
            } else {
                $docker = 'Installed but not running. Start Docker Desktop and wait.'
            }
        }
        $gitOk = [bool]$script:GitBash
        $mutagenOk = (Test-Command 'mutagen') -and (Test-Command 'mutagen-compose')
        $cloneOk = Test-CloneLineEndings
        Set-Requirement 'docker' $dockerOk $docker
        if ($gitOk) { Set-Requirement 'git' $true 'Installed' } else { Set-Requirement 'git' $false 'Not installed' }
        if ($mutagenOk) { Set-Requirement 'mutagen' $true 'Installed' } else { Set-Requirement 'mutagen' $false 'Not installed' }
        $script:UI.MutagenHelp.Visible = -not $mutagenOk
        $script:UI.CloneHelp.Visible = -not $cloneOk
        $ready = $dockerOk -and $gitOk -and $mutagenOk -and $cloneOk
        if ($script:Page -eq 'requirements') { $script:UI.Next.Enabled = $ready }
        if ($ready) { $script:UI.RequirementTimer.Stop() }
    } finally {
        $script:Checking = $false
    }
}

function Set-Requirement([string]$Key, [bool]$Ok, [string]$Text) {
    $row = $script:UI.Requirements[$Key]
    if ($Ok) {
        $row.Status.Text = "$script:CheckMark  $Text"
        $row.Status.ForeColor = $script:Good
    } else {
        $row.Status.Text = $Text
        $row.Status.ForeColor = $script:Bad
    }
    $row.Get.Visible = -not $Ok -and $Text -eq 'Not installed'
}

# ---------- Pages ----------

function New-Text($Parent, [string]$Text, [int]$X, [int]$Y, [int]$Width, [int]$Height, $Font = $script:FontBody) {
    $label = New-Object System.Windows.Forms.Label
    $label.Text = $Text
    $label.Location = New-Object System.Drawing.Point($X, $Y)
    $label.Size = New-Object System.Drawing.Size($Width, $Height)
    $label.Font = $Font
    $Parent.Controls.Add($label)
    return $label
}

function New-Button($Parent, [string]$Text, [int]$X, [int]$Y, [int]$Width, [scriptblock]$OnClick) {
    $button = New-Object System.Windows.Forms.Button
    $button.Text = $Text
    $button.Location = New-Object System.Drawing.Point($X, $Y)
    $button.Size = New-Object System.Drawing.Size($Width, 30)
    $button.Font = $script:FontBody
    $button.UseVisualStyleBackColor = $true
    if ($OnClick) { $button.Add_Click($OnClick) }
    $Parent.Controls.Add($button)
    return $button
}

function New-Radio($Parent, [string]$Text, [int]$X, [int]$Y, [int]$Width) {
    $radio = New-Object System.Windows.Forms.RadioButton
    $radio.Text = $Text
    $radio.Location = New-Object System.Drawing.Point($X, $Y)
    $radio.Size = New-Object System.Drawing.Size($Width, 24)
    $radio.Font = $script:FontBold
    $Parent.Controls.Add($radio)
    return $radio
}

function New-PagePanel([string]$Name) {
    $panel = New-Object System.Windows.Forms.Panel
    $panel.Location = New-Object System.Drawing.Point(0, 78)
    $panel.Size = New-Object System.Drawing.Size(664, 372)
    $panel.BackColor = [System.Drawing.Color]::White
    $panel.Visible = $false
    $script:UI.Form.Controls.Add($panel)
    $script:UI["page_$Name"] = $panel
    return $panel
}

function Build-WelcomePage {
    $p = New-PagePanel 'welcome'
    $script:UI.WelcomeText = New-Text $p '' 28 18 608 150
    $script:UI.ChooseStart = New-Radio $p 'Start chutvrc' 28 176 500
    $script:UI.ChooseSetup = New-Radio $p 'Run the setup again' 28 204 500
    $script:UI.ChooseNote = New-Text $p 'Running the setup again creates new certificates and restarts every service.' 48 230 580 22
    $script:UI.ChooseNote.ForeColor = $script:Muted
}

function Build-ScenarioPage {
    $p = New-PagePanel 'scenario'
    $script:UI.ScenarioLocal = New-Radio $p 'Only this computer' 28 18 580
    $script:UI.ScenarioLocal.Checked = $true
    [void](New-Text $p 'Open chutvrc at https://hubs.local:4000 on this computer.' 48 44 580 22)
    $script:UI.ScenarioLan = New-Radio $p 'This computer and other devices on my network' 28 84 580
    [void](New-Text $p 'Choose this to join from a VR headset, phone or another computer.' 48 110 580 22)
    [void](New-Text $p 'Address of this computer:' 48 142 170 22)
    $box = New-Object System.Windows.Forms.TextBox
    $box.Location = New-Object System.Drawing.Point(222, 139)
    $box.Size = New-Object System.Drawing.Size(170, 26)
    $box.Font = $script:FontBody
    $box.Enabled = $false
    $p.Controls.Add($box)
    $script:UI.AddressBox = $box
    $script:UI.ScenarioLan.Add_CheckedChanged({ $script:UI.AddressBox.Enabled = $script:UI.ScenarioLan.Checked })
    $script:UI.ScenarioError = New-Text $p '' 48 172 580 22
    $script:UI.ScenarioError.ForeColor = $script:Bad
    $note = New-Text $p 'To host on a public domain, follow "Remote Server" in MANUAL_SETUP.md on a Linux server or WSL2. This installer does not cover it.' 28 222 600 44
    $note.ForeColor = $script:Muted
}

function Build-RequirementsPage {
    $p = New-PagePanel 'requirements'
    [void](New-Text $p 'chutvrc needs these programs. Install anything missing, and this page updates by itself.' 28 16 608 24)
    $script:UI.Requirements = @{}
    $rows = @(
        @{ Key = 'docker'; Name = 'Docker Desktop'; Click = { Start-Process 'https://docs.docker.com/desktop/setup/install/windows-install/' } },
        @{ Key = 'git'; Name = 'Git for Windows'; Click = { Start-Process 'https://gitforwindows.org/' } },
        @{ Key = 'mutagen'; Name = 'Mutagen and Mutagen Compose'; Click = { Open-MutagenDownloads } }
    )
    $y = 52
    foreach ($row in $rows) {
        [void](New-Text $p $row.Name 28 ($y + 5) 210 22 $script:FontBold)
        $status = New-Text $p 'Checking...' 240 ($y + 5) 300 22
        $status.AutoEllipsis = $true
        $get = New-Button $p 'Get it' 556 $y 80 $row.Click
        $get.Visible = $false
        $script:UI.Requirements[$row.Key] = @{ Status = $status; Get = $get }
        $y += 38
    }
    $script:UI.MutagenHelp = New-Text $p "For Mutagen, download the mutagen and mutagen-compose zip files of the same version for Windows, and put mutagen.exe and mutagen-compose.exe in this folder (Get it opens it and both pages):`r`n$env:LOCALAPPDATA\mutagen" 28 176 608 66
    $script:UI.MutagenHelp.Visible = $false
    $script:UI.CloneHelp = New-Text $p 'This copy of chutvrc has Windows line endings and cannot run. Run: git config --global core.autocrlf false, then delete this folder and clone it again.' 28 246 608 44
    $script:UI.CloneHelp.ForeColor = $script:Bad
    $script:UI.CloneHelp.Visible = $false
    $mkcert = New-Text $p 'mkcert is downloaded for you during the installation.' 28 328 480 22
    $mkcert.ForeColor = $script:Muted
    [void](New-Button $p 'Check again' 536 322 100 { Update-Requirements })
}

function Open-MutagenDownloads {
    $dir = "$env:LOCALAPPDATA\mutagen"
    if (-not (Test-Path $dir)) { [void](New-Item -ItemType Directory -Path $dir) }
    Start-Process explorer.exe $dir
    Start-Process 'https://github.com/mutagen-io/mutagen/releases'
    Start-Process 'https://github.com/mutagen-io/mutagen-compose/releases'
}

function Build-InstallPage {
    $p = New-PagePanel 'install'
    $script:UI.StepRows = @()
    $y = 12
    foreach ($i in 0..6) {
        $mark = New-Text $p '' 28 $y 22 24 $script:FontBold
        $name = New-Text $p '' 52 $y 580 24
        $script:UI.StepRows += @{ Mark = $mark; Name = $name }
        $y += 26
    }
    $bar = New-Object System.Windows.Forms.ProgressBar
    $bar.Location = New-Object System.Drawing.Point(28, 200)
    $bar.Size = New-Object System.Drawing.Size(608, 18)
    $bar.MarqueeAnimationSpeed = 30
    $p.Controls.Add($bar)
    $script:UI.InstallBar = $bar
    $script:UI.InstallDetail = New-Text $p '' 28 222 608 20 $script:FontBody
    $script:UI.InstallDetail.ForeColor = $script:Muted
    $script:UI.InstallDetail.AutoEllipsis = $true
    $script:UI.InstallError = New-Text $p '' 28 246 608 60
    $script:UI.InstallError.ForeColor = $script:Bad
    $script:UI.Details = New-Button $p 'Show details' 28 328 120 { Switch-InstallDetails }
    $script:UI.Retry = New-Button $p 'Try again' 156 328 100 {
        $script:UI.Retry.Visible = $false
        $script:UI.InstallError.Text = ''
        $script:StepIndex--
        Invoke-NextStep
    }
    $script:UI.Retry.Visible = $false
    [void](New-Button $p 'Open log file' 516 328 120 { if (Test-Path $script:LogFile) { Start-Process notepad.exe $script:LogFile } })
    $log = New-Object System.Windows.Forms.TextBox
    $log.Multiline = $true
    $log.ReadOnly = $true
    $log.ScrollBars = 'Vertical'
    $log.Font = $script:FontMono
    $log.BackColor = [System.Drawing.Color]::FromArgb(245, 245, 245)
    $log.Location = New-Object System.Drawing.Point(28, 12)
    $log.Size = New-Object System.Drawing.Size(608, 300)
    $log.Visible = $false
    $p.Controls.Add($log)
    $log.BringToFront()
    $script:UI.Log = $log
}

function Switch-InstallDetails {
    $show = -not $script:UI.Log.Visible
    $script:UI.Log.Visible = $show
    if ($show) {
        $script:UI.Details.Text = 'Hide details'
        $script:UI.Log.SelectionStart = $script:UI.Log.TextLength
        $script:UI.Log.ScrollToCaret()
    } else {
        $script:UI.Details.Text = 'Show details'
    }
}

function Build-SignInPage {
    $p = New-PagePanel 'signin'
    $script:UI.SignInHelp = New-Text $p '' 28 16 608 76
    [void](New-Button $p 'Open chutvrc' 28 98 130 { Start-Process (Get-BaseUrl) })
    $script:UI.GetLink = New-Button $p 'Get my sign-in link' 166 98 160 { Request-SignInLink }
    [void](New-Text $p 'Your sign-in link:' 28 144 300 22 $script:FontBold)
    $box = New-Object System.Windows.Forms.TextBox
    $box.ReadOnly = $true
    $box.BackColor = [System.Drawing.Color]::FromArgb(245, 245, 245)
    $box.Location = New-Object System.Drawing.Point(28, 168)
    $box.Size = New-Object System.Drawing.Size(608, 26)
    $box.Font = $script:FontBody
    $p.Controls.Add($box)
    $script:UI.LinkBox = $box
    $script:UI.OpenLink = New-Button $p 'Open link' 28 202 110 { if ($script:CurrentLink) { Start-Process $script:CurrentLink } }
    $script:UI.CopyLink = New-Button $p 'Copy link' 146 202 110 { if ($script:CurrentLink) { [System.Windows.Forms.Clipboard]::SetText($script:CurrentLink) } }
    $script:UI.SignInStatus = New-Text $p '' 28 246 608 60
}

function Build-FinishPage {
    $p = New-PagePanel 'finish'
    $script:UI.FinishText = New-Text $p '' 28 18 608 150
    [void](New-Button $p 'Open chutvrc' 28 184 130 { Start-Process (Get-BaseUrl) })
    [void](New-Button $p 'Open admin panel' 166 184 150 { Start-Process ((Get-BaseUrl) + '/admin') })
    [void](New-Button $p 'Open the setup guide' 324 184 170 { Start-Process $script:GuideUrl })
    $note = New-Text $p 'To start chutvrc another day, run install-windows.bat again or start-windows.bat.' 28 236 608 24
    $note.ForeColor = $script:Muted
}

function Show-Page([string]$Name) {
    foreach ($key in @('welcome', 'scenario', 'requirements', 'install', 'signin', 'finish')) {
        $script:UI["page_$key"].Visible = $key -eq $Name
    }
    $script:Page = $Name
    $ui = $script:UI
    $ui.Next.Text = 'Next >'
    $ui.Next.Enabled = $true
    $ui.Back.Enabled = $false
    $ui.Cancel.Enabled = $true
    switch ($Name) {
        'welcome' {
            $ui.Header.Text = 'Welcome to chutvrc'
            $ui.SubHeader.Text = 'This wizard installs chutvrc on this computer.'
        }
        'scenario' {
            $ui.Header.Text = 'Who will use this chutvrc?'
            $ui.SubHeader.Text = 'Choose where people can join from.'
            $ui.Back.Enabled = $true
        }
        'requirements' {
            $ui.Header.Text = 'Required programs'
            $ui.SubHeader.Text = 'Checking what is already on this computer.'
            $ui.Back.Enabled = $true
            $ui.Next.Text = 'Install'
            $ui.Next.Enabled = $false
            $ui.RequirementTimer.Start()
        }
        'install' {
            if ($script:StartOnly) { $ui.Header.Text = 'Starting chutvrc' } else { $ui.Header.Text = 'Installing chutvrc' }
            $ui.SubHeader.Text = 'You can keep using your computer. The first install can take 30 minutes or more.'
            $ui.Next.Enabled = $false
        }
        'signin' {
            $ui.Header.Text = 'Create your administrator account'
            $ui.SubHeader.Text = 'chutvrc is running. One last step.'
            $ui.Next.Enabled = $false
        }
        'finish' {
            $ui.Header.Text = 'chutvrc is ready'
            $ui.SubHeader.Text = Get-BaseUrl
            $ui.FinishText.Text = "chutvrc is running at $(Get-BaseUrl)`r`n`r`nIn the admin panel you can next:`r`n  -  add scenes and avatars (a new instance has none)`r`n  -  turn on Recording, Broadcast and N-impro under App Settings > Features`r`n  -  set up email and other media servers under Server Settings`r`n`r`nThe setup guide explains each of these."
            $ui.Next.Text = 'Finish'
            $ui.Cancel.Enabled = $false
        }
    }
}

function Invoke-Next {
    switch ($script:Page) {
        'welcome' {
            $script:StartOnly = (Test-Path (Join-Path $script:Root '.bin-init-completed')) -and $script:UI.ChooseStart.Checked
            if ($script:StartOnly -or (Get-ConfiguredHost)) { Show-Page 'requirements' } else { Show-Page 'scenario' }
        }
        'scenario' {
            if ($script:UI.ScenarioLan.Checked) {
                $address = $script:UI.AddressBox.Text.Trim()
                if (-not (Test-IPv4 $address)) {
                    $script:UI.ScenarioError.Text = 'Enter an IPv4 address, such as 192.168.1.100.'
                    return
                }
                Set-ConfiguredHost $address
            }
            $script:UI.ScenarioError.Text = ''
            Show-Page 'requirements'
        }
        'requirements' {
            if (Test-PublicDomainHost) {
                [void][System.Windows.Forms.MessageBox]::Show($script:UI.Form,
                    '.env sets a public domain as HUBS_HOST. This installer does not cover that on Windows. Follow "Remote Server" in MANUAL_SETUP.md.',
                    'chutvrc', 'OK', 'Warning')
                return
            }
            $script:UI.RequirementTimer.Stop()
            Show-Page 'install'
            Start-Install
        }
        'signin' { Complete-SignIn }
        'finish' { $script:UI.Form.Close() }
    }
}

function Invoke-Back {
    switch ($script:Page) {
        'scenario' { Show-Page 'welcome' }
        'requirements' {
            $script:UI.RequirementTimer.Stop()
            if ($script:StartOnly -or (Get-ConfiguredHost)) { Show-Page 'welcome' } else { Show-Page 'scenario' }
        }
    }
}

function Build-Installer {
    [System.Windows.Forms.Application]::EnableVisualStyles()
    $form = New-Object System.Windows.Forms.Form
    $form.Text = 'chutvrc Setup'
    $form.ClientSize = New-Object System.Drawing.Size(664, 510)
    $form.FormBorderStyle = 'FixedDialog'
    $form.MaximizeBox = $false
    $form.StartPosition = 'CenterScreen'
    $form.Font = $script:FontBody
    $script:UI.Form = $form

    $header = New-Object System.Windows.Forms.Panel
    $header.Location = New-Object System.Drawing.Point(0, 0)
    $header.Size = New-Object System.Drawing.Size(664, 76)
    $header.BackColor = [System.Drawing.Color]::FromArgb(36, 41, 66)
    $form.Controls.Add($header)
    $script:UI.Header = New-Text $header '' 24 12 620 30 $script:FontTitle
    $script:UI.Header.ForeColor = [System.Drawing.Color]::White
    $script:UI.SubHeader = New-Text $header '' 25 44 620 22
    $script:UI.SubHeader.ForeColor = [System.Drawing.Color]::FromArgb(205, 210, 230)

    $line = New-Object System.Windows.Forms.Label
    $line.BorderStyle = 'Fixed3D'
    $line.Location = New-Object System.Drawing.Point(0, 451)
    $line.Size = New-Object System.Drawing.Size(664, 2)
    $form.Controls.Add($line)

    $script:UI.Back = New-Button $form '< Back' 364 466 90 { Invoke-Back }
    $script:UI.Next = New-Button $form 'Next >' 460 466 90 { Invoke-Next }
    $script:UI.Cancel = New-Button $form 'Cancel' 560 466 90 { $script:UI.Form.Close() }
    $form.AcceptButton = $script:UI.Next

    $timer = New-Object System.Windows.Forms.Timer
    $timer.Interval = 400
    $timer.Add_Tick({ Invoke-Tick })
    $script:UI.Timer = $timer
    $requirementTimer = New-Object System.Windows.Forms.Timer
    $requirementTimer.Interval = 4000
    $requirementTimer.Add_Tick({ Update-Requirements })
    $script:UI.RequirementTimer = $requirementTimer
    $linkTimer = New-Object System.Windows.Forms.Timer
    $linkTimer.Interval = 2000
    $linkTimer.Add_Tick({ Invoke-LinkWait })
    $script:UI.LinkTimer = $linkTimer

    Build-WelcomePage
    Build-ScenarioPage
    Build-RequirementsPage
    Build-InstallPage
    Build-SignInPage
    Build-FinishPage

    $form.Add_FormClosing({
        param($source, $closing)
        if ($script:Page -eq 'finish') { return }
        $answer = [System.Windows.Forms.MessageBox]::Show($script:UI.Form,
            'Quit the chutvrc setup? You can run it again later, and it continues where it can.',
            'chutvrc Setup', 'YesNo', 'Question')
        if ($answer -ne 'Yes') {
            $closing.Cancel = $true
            return
        }
        Stop-Running
    })
    return $form
}

function Initialize-WelcomePage {
    $installed = Test-Path (Join-Path $script:Root '.bin-init-completed')
    $ui = $script:UI
    $ui.ChooseStart.Visible = $installed
    $ui.ChooseSetup.Visible = $installed
    $ui.ChooseNote.Visible = $installed
    if ($installed) {
        $ui.ChooseStart.Checked = $true
        $ui.ChooseStart.Top = 56
        $ui.ChooseSetup.Top = 86
        $ui.ChooseNote.Top = 112
        $ui.WelcomeText.Height = 30
        $ui.WelcomeText.Text = 'chutvrc is already installed on this computer. What would you like to do?'
    } else {
        $ui.WelcomeText.Text = "This wizard will:`r`n`r`n  -  check that Docker Desktop, Git and Mutagen are installed`r`n  -  download and build chutvrc (several GB; 30 minutes or more the first time)`r`n  -  create the security certificates for your browser`r`n  -  start chutvrc and help you create your administrator account`r`n`r`nWindows may ask for permission twice: to add hubs.local to this computer and to trust the certificate. Please choose Yes."
    }
    $ui.AddressBox.Text = Get-NetworkAddress
}

function Start-Installer {
    $mutex = New-Object System.Threading.Mutex($false, 'chutvrc-setup-installer')
    if (-not $mutex.WaitOne(0)) { return }
    try {
        if (-not (Test-Path $script:LogDir)) { [void](New-Item -ItemType Directory -Path $script:LogDir) }
        Add-Type -Namespace Chutvrc -Name Display -MemberDefinition '[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool SetProcessDPIAware();'
        [void][Chutvrc.Display]::SetProcessDPIAware()
        Update-SessionPath
        $form = Build-Installer
        Initialize-WelcomePage
        Show-Page 'welcome'
        $script:UI.Timer.Start()
        [System.Windows.Forms.Application]::Run($form)
    } finally {
        $mutex.ReleaseMutex()
    }
}

if ($MyInvocation.InvocationName -ne '.') { Start-Installer }
