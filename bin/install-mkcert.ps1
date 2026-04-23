# Downloads the latest mkcert.exe for Windows from GitHub releases into
# %LOCALAPPDATA%\mkcert\ and adds that directory to the user PATH.
# No admin privileges required.
#
# Writes the install directory to stdout as a single line prefixed with
# "INSTALL_DIR=" so the calling .bat can pick it up and update the current
# session's PATH (child processes can't change the parent's environment).

$ErrorActionPreference = 'Stop'

# Progress messages go to stderr so the calling .bat can parse the single
# INSTALL_DIR=... line from stdout cleanly.
function Info($msg) { [Console]::Error.WriteLine($msg) }

$installDir = Join-Path $env:LOCALAPPDATA 'mkcert'
$target     = Join-Path $installDir 'mkcert.exe'

if (Test-Path $target) {
    Info "mkcert already present at $target"
    Write-Output "INSTALL_DIR=$installDir"
    exit 0
}

$arch = switch ($env:PROCESSOR_ARCHITECTURE) {
    'AMD64' { 'amd64' }
    'ARM64' { 'arm64' }
    'x86'   { '386' }
    default { throw "Unsupported architecture: $env:PROCESSOR_ARCHITECTURE" }
}

Info "Fetching latest mkcert release metadata from GitHub..."
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$release = Invoke-RestMethod `
    -Uri 'https://api.github.com/repos/FiloSottile/mkcert/releases/latest' `
    -UseBasicParsing `
    -Headers @{ 'User-Agent' = 'chutvrc-hubs-compose-setup' }

$asset = $release.assets | Where-Object { $_.name -like "mkcert-*-windows-$arch.exe" } | Select-Object -First 1
if (-not $asset) {
    throw "Could not find a Windows $arch asset in mkcert release $($release.tag_name)."
}

New-Item -ItemType Directory -Force -Path $installDir | Out-Null

Info "Downloading $($asset.name) ($([math]::Round($asset.size / 1MB, 1)) MB)..."
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $target -UseBasicParsing

# Persist for future shells by updating the User-level PATH (no admin needed).
$userPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
if (-not $userPath) { $userPath = '' }
$parts = $userPath -split ';' | Where-Object { $_ -ne '' }
if ($parts -notcontains $installDir) {
    [Environment]::SetEnvironmentVariable('PATH', (($parts + $installDir) -join ';'), 'User')
    Info "Added $installDir to user PATH (applies to new shells)."
}

Info "mkcert installed at $target"
Write-Output "INSTALL_DIR=$installDir"
exit 0
