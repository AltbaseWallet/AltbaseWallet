param(
  [int]$BuildJobs = 0
)

$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot

if ($BuildJobs -le 0) {
  if ($env:ALTBASE_BUILD_JOBS) {
    $BuildJobs = [int]$env:ALTBASE_BUILD_JOBS
  } else {
    $BuildJobs = 7
  }
}

$BuildJobs = [Math]::Max(1, $BuildJobs)
$env:ALTBASE_BUILD_JOBS = "$BuildJobs"
$env:GIT_CEILING_DIRECTORIES = Join-Path $env:USERPROFILE 'Desktop'

function Invoke-Step {
  param(
    [string]$Name,
    [scriptblock]$Script
  )

  Write-Host "[$(Get-Date -Format s)] $Name"
  & $Script
  if ($LASTEXITCODE -ne 0) {
    throw "$Name failed with exit code $LASTEXITCODE"
  }
}

Push-Location -LiteralPath $repo
try {
  Write-Host "Using ALTBASE_BUILD_JOBS=$BuildJobs"
  Invoke-Step 'build Zano native libraries' { node scripts/build-zano-native.cjs }
  Invoke-Step 'build Epic native module' {
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-epic-resilient.ps1 -RunTests
  }
  Invoke-Step 'build Kaspa wallet-only WASM' {
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-kaspa-wallet-wasm.ps1 -Threads $BuildJobs
  }
  Invoke-Step 'configure native core' { cmake --preset vs2022-x64-release -S native/core }
  Invoke-Step 'build native core' {
    cmake --build native/core/build/vs2022-x64-release --config Release -- "/m:$BuildJobs"
  }
  Invoke-Step 'copy native core artifacts' { node scripts/copy-native-core.cjs }
} finally {
  Pop-Location
}
