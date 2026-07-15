param(
  [int]$RetryDelaySeconds = 30,
  [int]$MaxAttempts = 0,
  [switch]$RunTests
)

$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
$transportManifest = Join-Path $repo 'native\epic_transport\Cargo.toml'
$stateManifest = Join-Path $repo 'native\epic_state\Cargo.toml'
$senderManifest = Join-Path $repo 'native\epic_sender\Cargo.toml'
$sharedTarget = Join-Path $repo 'native\target-epic-modular'
$cargo = Join-Path $env:USERPROFILE '.cargo\bin\cargo.exe'
$toolShimDir = Join-Path $repo 'scripts\tools'
$buildJobs = 7
if ($env:ALTBASE_BUILD_JOBS) {
  $buildJobs = [Math]::Max(1, [int]$env:ALTBASE_BUILD_JOBS)
}

if (-not (Test-Path -LiteralPath $cargo)) {
  $cargo = 'cargo'
}

$env:LIBCLANG_PATH = Join-Path $env:APPDATA 'Python\Python314\site-packages\clang\native'
$env:RUSTUP_TOOLCHAIN = '1.89.0-x86_64-pc-windows-msvc'
Remove-Item Env:ALTBASE_SECP_DYNAMIC -ErrorAction SilentlyContinue
$clangCl = Join-Path $env:ProgramFiles 'LLVM\bin\clang-cl.exe'
if (Test-Path -LiteralPath $clangCl) {
  $env:CC_x86_64_pc_windows_msvc = $clangCl
  $env:CXX_x86_64_pc_windows_msvc = $clangCl
  $env:ALTBASE_SECP_WIDE = '1'
}
$windowsKitsBin = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
$resourceCompiler = Get-ChildItem -LiteralPath $windowsKitsBin -Filter 'rc.exe' -Recurse -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -match '\\x64\\rc\.exe$' } |
  Sort-Object FullName -Descending |
  Select-Object -First 1
if (-not $resourceCompiler) {
  throw 'Windows SDK x64 resource compiler was not found'
}
$env:PATH = "$(Split-Path -Parent $resourceCompiler.FullName);$env:PATH"
$env:PATH = "$toolShimDir;$env:USERPROFILE\.cargo\bin;$env:PATH"
$env:CARGO_NET_RETRY = '20'
$env:CARGO_NET_GIT_FETCH_WITH_CLI = 'true'
$env:CARGO_HTTP_TIMEOUT = '600'
$env:CARGO_HTTP_LOW_SPEED_LIMIT = '1'
$env:CARGO_HTTP_MULTIPLEXING = 'false'
$cargoHome = Join-Path $env:USERPROFILE '.cargo'

function Get-ShortPath {
  param([string]$Path)

  $resolved = Resolve-Path -LiteralPath $Path -ErrorAction SilentlyContinue
  if (-not $resolved) {
    return $null
  }

  $escaped = $resolved.Path.Replace('"', '""')
  $short = & cmd.exe /d /c "for %I in (`"$escaped`") do @echo %~sI"
  if ($LASTEXITCODE -eq 0 -and $short) {
    return ([string]$short).Trim()
  }
  return $null
}

function Add-RemapPrefix {
  param(
    [System.Collections.Generic.List[string]]$Prefixes,
    [string]$Path
  )

  if (-not $Path) {
    return
  }

  $normalized = $Path.TrimEnd('\', '/')
  if (-not $normalized) {
    return
  }

  foreach ($candidate in @($normalized, ($normalized -replace '\\', '/'))) {
    if ($candidate -and -not $Prefixes.Contains($candidate)) {
      $Prefixes.Add($candidate)
    }
  }

  $short = Get-ShortPath $normalized
  if ($short) {
    foreach ($candidate in @($short, ($short -replace '\\', '/'))) {
      if ($candidate -and -not $Prefixes.Contains($candidate)) {
        $Prefixes.Add($candidate)
      }
    }
  }
}

$remapPrefixList = [System.Collections.Generic.List[string]]::new()
Add-RemapPrefix $remapPrefixList $repo
Add-RemapPrefix $remapPrefixList $cargoHome
Add-RemapPrefix $remapPrefixList (Join-Path $cargoHome 'registry')
Add-RemapPrefix $remapPrefixList (Join-Path $cargoHome 'registry\src')

$cargoRegistrySrc = Join-Path $cargoHome 'registry\src'
if (Test-Path -LiteralPath $cargoRegistrySrc) {
  Get-ChildItem -LiteralPath $cargoRegistrySrc -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    Add-RemapPrefix $remapPrefixList $_.FullName
  }
}

$remapPrefixes = $remapPrefixList.ToArray()
$extraRustFlags = @()
foreach ($prefix in $remapPrefixes) {
  $extraRustFlags += "--remap-path-prefix=$prefix=."
}
$extraRustFlags += @('-C', 'target-feature=+crt-static', '-C', 'debuginfo=0', '-C', 'strip=symbols')
$env:RUSTFLAGS = (($env:RUSTFLAGS, ($extraRustFlags -join ' ')) | Where-Object { $_ }) -join ' '
$extraMsvcFlags = @('/experimental:deterministic')
if (-not (Test-Path -LiteralPath $clangCl)) {
  foreach ($prefix in $remapPrefixes) {
    $extraMsvcFlags += "/pathmap:$prefix=."
  }
}
$env:CFLAGS = (($env:CFLAGS, ($extraMsvcFlags -join ' ')) | Where-Object { $_ }) -join ' '
$env:CXXFLAGS = (($env:CXXFLAGS, ($extraMsvcFlags -join ' ')) | Where-Object { $_ }) -join ' '
$env:CL = (($env:CL, ($extraMsvcFlags -join ' ')) | Where-Object { $_ }) -join ' '
$env:CMAKE_C_FLAGS_RELEASE = (($env:CMAKE_C_FLAGS_RELEASE, ($extraMsvcFlags -join ' ')) | Where-Object { $_ }) -join ' '
$env:CMAKE_CXX_FLAGS_RELEASE = (($env:CMAKE_CXX_FLAGS_RELEASE, ($extraMsvcFlags -join ' ')) | Where-Object { $_ }) -join ' '
$env:CARGO_PROFILE_RELEASE_DEBUG = 'false'
$env:CARGO_PROFILE_RELEASE_INCREMENTAL = 'false'
$env:CARGO_PROFILE_RELEASE_STRIP = 'symbols'
$env:CARGO_PROFILE_RELEASE_PANIC = 'abort'

Set-Location -LiteralPath $repo

function Invoke-CargoStep {
  param(
    [string]$Name,
    [string[]]$CargoArgs
  )

  $attempt = 1
  while ($true) {
    Write-Host "[$(Get-Date -Format s)] $Name attempt $attempt"
    & $cargo @CargoArgs
    $exitCode = $LASTEXITCODE

    if ($exitCode -eq 0) {
      Write-Host "[$(Get-Date -Format s)] $Name succeeded"
      return
    }

    if ($MaxAttempts -gt 0 -and $attempt -ge $MaxAttempts) {
      Write-Error "$Name failed after $attempt attempt(s), exit code $exitCode"
      exit $exitCode
    }

    Write-Host "[$(Get-Date -Format s)] $Name failed with exit code $exitCode; retrying in $RetryDelaySeconds second(s)"
    Start-Sleep -Seconds $RetryDelaySeconds
    $attempt++
  }
}

function Invoke-CargoOnce {
  param(
    [string]$Name,
    [string[]]$CargoArgs
  )

  Write-Host "[$(Get-Date -Format s)] $Name"
  $standardOutput = & $cargo @CargoArgs
  $exitCode = $LASTEXITCODE
  if ($standardOutput) {
    $standardOutput | ForEach-Object { Write-Host $_ }
  }
  if ($exitCode -eq 0) {
    Write-Host "[$(Get-Date -Format s)] $Name succeeded"
  } else {
    Write-Host "[$(Get-Date -Format s)] $Name failed with exit code $exitCode"
  }
  return $exitCode
}

function Prepare-ModuleLink {
  param([string]$Name)

  $releaseDir = Join-Path $sharedTarget 'release'
  $moduleImport = Join-Path $releaseDir "deps\$Name.dll.lib"
  $moduleLink = Join-Path $releaseDir "deps\$Name.lib"
  if (-not (Test-Path -LiteralPath $moduleImport)) {
    throw "Epic import library was not produced: $moduleImport"
  }
  Copy-Item -LiteralPath $moduleImport -Destination $moduleLink -Force
  return Split-Path -Parent $moduleLink
}

function Publish-EpicArtifacts {
  $releaseDir = Join-Path $sharedTarget 'release'
  $legacyRelease = Join-Path $repo 'native\epic_core\target\release'
  New-Item -ItemType Directory -Path $legacyRelease -Force | Out-Null
  foreach ($name in @(
    'altbase_epic_state.dll',
    'altbase_epic_sender.dll',
    'altbase_epic_transport.dll'
  )) {
    Copy-Item -LiteralPath (Join-Path $releaseDir $name) -Destination (Join-Path $legacyRelease $name) -Force
  }
  foreach ($name in @('altbase_epic_state', 'altbase_epic_sender')) {
    Copy-Item -LiteralPath (Join-Path $releaseDir "deps\$name.dll.lib") -Destination (Join-Path $legacyRelease "$name.dll.lib") -Force
  }
  foreach ($stale in @('altbase_epic_core.dll', 'altbase_epic_core.dll.lib')) {
    Remove-Item -LiteralPath (Join-Path $legacyRelease $stale) -Force -ErrorAction SilentlyContinue
  }
}

$offlineArgs = @('--release', '--locked', '--offline', '--target-dir', $sharedTarget, '-j', "$buildJobs")
$onlineArgs = @('--release', '--locked', '--target-dir', $sharedTarget, '-j', "$buildJobs")

function Invoke-EpicBuildSequence {
  param([switch]$Offline)

  $commonArgs = if ($Offline) { $offlineArgs } else { $onlineArgs }
  $suffix = if ($Offline) { ' offline-first' } else { '' }
  if ((Invoke-CargoOnce "Epic transport build$suffix" (@('build', '--manifest-path', $transportManifest) + $commonArgs)) -ne 0) { return $false }
  $moduleDir = Prepare-ModuleLink 'altbase_epic_transport'
  $env:ALTBASE_EPIC_TRANSPORT_LIB_DIR = $moduleDir
  if ((Invoke-CargoOnce "Epic state build$suffix" (@('build', '--manifest-path', $stateManifest) + $commonArgs)) -ne 0) { return $false }
  if ((Invoke-CargoOnce "Epic sender build$suffix" (@('build', '--manifest-path', $senderManifest) + $commonArgs)) -ne 0) { return $false }
  Publish-EpicArtifacts
  return $true
}

if (-not (Invoke-EpicBuildSequence -Offline)) {
  Write-Host "[$(Get-Date -Format s)] Offline build could not finish from cache; enabling fetch/retry fallback"
  Invoke-CargoStep 'Epic transport fetch' @('fetch', '--locked', '--manifest-path', $transportManifest)
  Invoke-CargoStep 'Epic state fetch' @('fetch', '--locked', '--manifest-path', $stateManifest)
  Invoke-CargoStep 'Epic sender fetch' @('fetch', '--locked', '--manifest-path', $senderManifest)
  if (-not (Invoke-EpicBuildSequence)) {
    throw 'Epic modular build failed after dependency fetch'
  }
}

if ($RunTests) {
  $testArgs = @(
    'test', '--manifest-path', $transportManifest,
    '--release', '--locked', '--offline',
    '--no-default-features', '--features', 'listener,transport-server',
    '--target-dir', $sharedTarget, '-j', "$buildJobs",
    'transport_'
  )
  if ((Invoke-CargoOnce 'Epic transport slate regression test' $testArgs) -ne 0) {
    throw 'Epic transport slate regression test failed'
  }
}
