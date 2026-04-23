# Adds hubs.local + internal service hostnames to the Windows hosts file.
# Intended to be invoked elevated (via Start-Process -Verb RunAs) from local-setup-windows.bat.
#
# The service names (hubs-client, hubs-admin, spoke, dialog) are needed because
# the hubs-client webpack config bakes `https://hubs-client:8080/...` absolute
# URLs into the HTML it serves, and the browser needs to resolve that hostname.
# macOS users get the same entries per SSL_SETUP.md.

$ErrorActionPreference = 'Stop'
$hostsFile = Join-Path $env:WinDir 'System32\drivers\etc\hosts'
$entries = @(
    '127.0.0.1   hubs.local',
    '127.0.0.1   hubs-proxy.local',
    '127.0.0.1   hubs-client',
    '127.0.0.1   hubs-admin',
    '127.0.0.1   spoke',
    '127.0.0.1   dialog'
)

try {
    $existing = Get-Content -Path $hostsFile -ErrorAction Stop
    $toAdd = @()
    foreach ($entry in $entries) {
        $host_ = ($entry -split '\s+')[1]
        if (-not ($existing | Select-String -SimpleMatch -Pattern $host_ -Quiet)) {
            $toAdd += $entry
        }
    }
    if ($toAdd.Count -gt 0) {
        Add-Content -Path $hostsFile -Value ("`r`n" + ($toAdd -join "`r`n"))
        Write-Host "Added $($toAdd.Count) host entries."
    } else {
        Write-Host "Hosts file already contains the required entries."
    }
    exit 0
} catch {
    Write-Host "Failed to update hosts file: $_"
    exit 1
}
