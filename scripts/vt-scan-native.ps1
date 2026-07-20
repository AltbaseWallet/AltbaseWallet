param(
    [Parameter(Mandatory = $true)]
    [string]$ApiKey,
    [Parameter(Mandatory = $true)]
    [string]$NativeRoot,
    [Parameter(Mandatory = $true)]
    [string]$ReportPath
)

$ErrorActionPreference = 'Stop'
$maxPublicUploadBytes = 32MB
$requestCount = 0

function Wait-PublicQuota {
    if ($script:requestCount -gt 0 -and ($script:requestCount % 4) -eq 0) {
        Write-Host 'VirusTotal public quota: waiting 65 seconds...'
        Start-Sleep -Seconds 65
    }
}

function Invoke-VtCurl {
    param([string[]]$Arguments)
    for ($attempt = 1; $attempt -le 20; $attempt++) {
        Wait-PublicQuota
        $previousErrorPreference = $ErrorActionPreference
        try {
            $ErrorActionPreference = 'Continue'
            $lines = @(& curl.exe --silent --show-error --write-out "`n%{http_code}" @Arguments 2>&1)
            $exitCode = $LASTEXITCODE
        } finally {
            $ErrorActionPreference = $previousErrorPreference
        }
        if ($exitCode -ne 0) {
            if ($attempt -eq 20) {
                throw "VirusTotal request failed after $attempt attempts: $($lines -join "`n")"
            }
            Write-Warning "VirusTotal network request failed (attempt $attempt); retrying in 30 seconds."
            Start-Sleep -Seconds 30
            continue
        }
        $script:requestCount++
        $status = [int]$lines[-1]
        $body = ($lines[0..([Math]::Max(0, $lines.Count - 2))] -join "`n").Trim()
        if ($status -eq 429) {
            Write-Warning 'VirusTotal quota response received; waiting 65 seconds.'
            Start-Sleep -Seconds 65
            continue
        }
        if ($status -ge 500 -and $attempt -lt 20) {
            Write-Warning "VirusTotal returned HTTP $status; retrying in 30 seconds."
            Start-Sleep -Seconds 30
            continue
        }
        return [pscustomobject]@{ Status = $status; Body = $body }
    }
    throw 'VirusTotal request retry loop ended unexpectedly.'
}

function Convert-VtStats {
    param($Stats)
    $value = {
        param($InputValue)
        if ($null -eq $InputValue) { return 0 }
        return [int]$InputValue
    }
    [ordered]@{
        malicious = & $value $Stats.malicious
        suspicious = & $value $Stats.suspicious
        harmless = & $value $Stats.harmless
        undetected = & $value $Stats.undetected
        timeout = & $value $Stats.timeout
        failure = & $value $Stats.failure
        type_unsupported = & $value $Stats.'type-unsupported'
    }
}

function Save-Report {
    param([object[]]$Rows)
    $completeRows = @($Rows | Where-Object { $_.status -eq 'complete' })
    $document = [ordered]@{
        generated_at_utc = [DateTime]::UtcNow.ToString('o')
        native_root = $NativeRoot
        build = 'Altbase Wallet 0.1.6 Windows x64'
        complete = ($completeRows.Count -eq $Rows.Count)
        all_clean = ($completeRows.Count -eq $Rows.Count -and @($completeRows | Where-Object {
            $_.stats.malicious -ne 0 -or $_.stats.suspicious -ne 0
        }).Count -eq 0)
        files = $Rows
    }
    $document | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ReportPath -Encoding UTF8
}

$files = @(Get-ChildItem -LiteralPath $NativeRoot -File | Sort-Object Name | ForEach-Object {
    if ($_.Length -gt $maxPublicUploadBytes) {
        throw "Native file exceeds the public VirusTotal upload limit: $($_.FullName)"
    }
    [ordered]@{
        name = $_.Name
        path = $_.FullName
        size = $_.Length
        sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        status = 'pending'
        analysis_id = $null
        stats = $null
        report_url = $null
    }
})

$previousByHash = @{}
if (Test-Path -LiteralPath $ReportPath) {
    try {
        $previous = Get-Content -LiteralPath $ReportPath -Raw | ConvertFrom-Json
        foreach ($row in @($previous.files)) { $previousByHash[$row.sha256] = $row }
    } catch {
        Write-Warning 'Previous VirusTotal report is invalid; starting a fresh resumable scan.'
    }
}

foreach ($file in $files) {
    $previous = $previousByHash[$file.sha256]
    if ($previous -and $previous.status -eq 'complete') {
        $file.status = 'complete'
        $file.analysis_id = $previous.analysis_id
        $file.stats = $previous.stats
        $file.report_url = $previous.report_url
        Write-Host "Cached current hash: $($file.name)"
        continue
    }

    Write-Host "Looking up $($file.name) [$($file.sha256)]"
    $lookup = Invoke-VtCurl -Arguments @(
        '--request', 'GET',
        "https://www.virustotal.com/api/v3/files/$($file.sha256)",
        '--header', "x-apikey: $ApiKey"
    )
    if ($lookup.Status -eq 200) {
        $response = $lookup.Body | ConvertFrom-Json
        $file.status = 'complete'
        $file.stats = Convert-VtStats $response.data.attributes.last_analysis_stats
        $file.report_url = "https://www.virustotal.com/gui/file/$($file.sha256)/detection"
    } elseif ($lookup.Status -eq 404) {
        Write-Host "Uploading missing hash: $($file.name)"
        $upload = Invoke-VtCurl -Arguments @(
            '--request', 'POST',
            'https://www.virustotal.com/api/v3/files',
            '--header', "x-apikey: $ApiKey",
            '--form', "file=@$($file.path)"
        )
        if ($upload.Status -lt 200 -or $upload.Status -ge 300) {
            throw "VirusTotal upload failed for $($file.name), HTTP $($upload.Status): $($upload.Body)"
        }
        $response = $upload.Body | ConvertFrom-Json
        $file.status = 'uploaded'
        $file.analysis_id = $response.data.id
    } else {
        throw "VirusTotal lookup failed for $($file.name), HTTP $($lookup.Status): $($lookup.Body)"
    }
    Save-Report -Rows $files
}

$uploaded = @($files | Where-Object { $_.status -eq 'uploaded' })
if ($uploaded.Count -gt 0) {
    Write-Host "Waiting 125 seconds for $($uploaded.Count) new analyses..."
    Start-Sleep -Seconds 125
}

foreach ($file in $uploaded) {
    for ($attempt = 1; $attempt -le 6; $attempt++) {
        Write-Host "Reading $($file.name), attempt $attempt"
        $lookup = Invoke-VtCurl -Arguments @(
            '--request', 'GET',
            "https://www.virustotal.com/api/v3/files/$($file.sha256)",
            '--header', "x-apikey: $ApiKey"
        )
        if ($lookup.Status -eq 200) {
            $response = $lookup.Body | ConvertFrom-Json
            $stats = Convert-VtStats $response.data.attributes.last_analysis_stats
            $engineCount = 0
            foreach ($value in $stats.Values) { $engineCount += [int]$value }
            if ($engineCount -gt 0) {
                $file.status = 'complete'
                $file.stats = $stats
                $file.report_url = "https://www.virustotal.com/gui/file/$($file.sha256)/detection"
                Save-Report -Rows $files
                break
            }
        }
        if ($attempt -eq 6) { throw "VirusTotal analysis did not complete for $($file.name)" }
        Start-Sleep -Seconds 65
    }
}

Save-Report -Rows $files
$files | ForEach-Object {
    [pscustomobject]@{
        name = $_.name
        malicious = $_.stats.malicious
        suspicious = $_.stats.suspicious
        sha256 = $_.sha256
    }
} | Format-Table -AutoSize

$dirty = @($files | Where-Object {
    $_.status -ne 'complete' -or $_.stats.malicious -ne 0 -or $_.stats.suspicious -ne 0
})
Write-Host "Report: $ReportPath"
if ($dirty.Count -gt 0) { exit 2 }
