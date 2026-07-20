param(
    [Parameter(Mandatory = $true)]
    [string]$ApiKey,
    [Parameter(Mandatory = $true)]
    [string]$NativeRoot,
    [Parameter(Mandatory = $true)]
    [string]$ReportPath,
    [string]$AlreadyUploaded = ''
)

$ErrorActionPreference = 'Stop'
$alreadyUploadedNames = @($AlreadyUploaded -split ',' | Where-Object { $_ })

$names = @(
    'altbase_epic_state.dll',
    'altbase_epic_sender.dll',
    'altbase_epic_transport.dll',
    'altbase_epic_wallet.dll',
    'altbase_epic_node.dll',
    'altbase_core_bridge.exe',
    'libsecp256k1-6.dll'
)

$files = foreach ($name in $names) {
    $path = Join-Path $NativeRoot $name
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Missing VirusTotal input: $path"
    }
    [pscustomobject]@{
        Name = $name
        Path = $path
        Sha256 = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
        Size = (Get-Item -LiteralPath $path).Length
    }
}

function Wait-QuotaWindow {
    param([int]$RequestIndex)
    if ($RequestIndex -gt 0 -and ($RequestIndex % 4) -eq 0) {
        Write-Host 'VirusTotal public quota window: waiting 65 seconds...'
        Start-Sleep -Seconds 65
    }
}

$requestCount = 0
$analysisIds = @{}
foreach ($file in $files) {
    if ($alreadyUploadedNames -contains $file.Name) {
        Write-Host "Already uploaded, resuming: $($file.Name) [$($file.Sha256)]"
        $analysisIds[$file.Name] = $null
        continue
    }
    Wait-QuotaWindow -RequestIndex $requestCount
    Write-Host "Uploading $($file.Name) [$($file.Sha256)]"
    $json = & curl.exe --silent --show-error --fail-with-body `
        --request POST 'https://www.virustotal.com/api/v3/files' `
        --header "x-apikey: $ApiKey" `
        --form "file=@$($file.Path)" 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "VirusTotal upload failed for $($file.Name): $json"
    }
    $response = ($json -join "`n") | ConvertFrom-Json
    $analysisIds[$file.Name] = $response.data.id
    $requestCount++
}

Write-Host 'Uploads accepted. Waiting 125 seconds for analysis...'
Start-Sleep -Seconds 125

$results = @()
foreach ($file in $files) {
    Wait-QuotaWindow -RequestIndex $requestCount
    $attempt = 0
    do {
        $attempt++
        Write-Host "Reading report for $($file.Name), attempt $attempt"
        $json = & curl.exe --silent --show-error --fail-with-body `
            --request GET "https://www.virustotal.com/api/v3/files/$($file.Sha256)" `
            --header "x-apikey: $ApiKey" 2>&1
        $requestCount++
        if ($LASTEXITCODE -eq 0) {
            $report = ($json -join "`n") | ConvertFrom-Json
            $stats = $report.data.attributes.last_analysis_stats
            $completedEngineCount =
                [int]$stats.malicious +
                [int]$stats.suspicious +
                [int]$stats.undetected +
                [int]$stats.harmless +
                [int]$stats.timeout +
                [int]$stats.failure +
                [int]$stats.'type-unsupported'
            if ($completedEngineCount -eq 0) {
                if ($attempt -ge 4) {
                    throw "VirusTotal analysis did not start for $($file.Name)"
                }
                Write-Host 'Analysis is queued but engines have not reported. Waiting 65 seconds...'
                Start-Sleep -Seconds 65
                Wait-QuotaWindow -RequestIndex $requestCount
                continue
            }
            $results += [pscustomobject]@{
                name = $file.Name
                sha256 = $file.Sha256
                size = $file.Size
                malicious = [int]$stats.malicious
                suspicious = [int]$stats.suspicious
                undetected = [int]$stats.undetected
                harmless = [int]$stats.harmless
                timeout = [int]$stats.timeout
                failure = [int]$stats.failure
                type_unsupported = [int]$stats.'type-unsupported'
                analysis_id = $analysisIds[$file.Name]
                report_url = "https://www.virustotal.com/gui/file/$($file.Sha256)/detection"
            }
            break
        }
        if ($attempt -ge 4) {
            throw "VirusTotal report unavailable for $($file.Name): $json"
        }
        Write-Host 'Report is not ready. Waiting 65 seconds...'
        Start-Sleep -Seconds 65
        Wait-QuotaWindow -RequestIndex $requestCount
    } while ($true)
}

$document = [ordered]@{
    generated_at_utc = [DateTime]::UtcNow.ToString('o')
    native_root = $NativeRoot
    build = 'Altbase Wallet 0.1.6 Windows x64'
    all_clean = (($results | Where-Object { $_.malicious -ne 0 -or $_.suspicious -ne 0 }).Count -eq 0)
    files = $results
}

$document | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $ReportPath -Encoding UTF8
$results | Format-Table name, malicious, suspicious, undetected, harmless, sha256 -AutoSize
Write-Host "Report: $ReportPath"
if (-not $document.all_clean) {
    exit 2
}
