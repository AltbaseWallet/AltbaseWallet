param(
  [ValidateRange(1, 32)]
  [int]$Threads = 7,
  [string]$SourceRoot = ""
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$downloads = Join-Path (Split-Path -Parent $root) '.downloads'
$archive = Join-Path $downloads 'rusty-kaspa-v2.0.1.tar.gz'
if (-not $SourceRoot) { $SourceRoot = Join-Path $downloads 'rusty-kaspa-v2.0.1' }
$sourceMarker = Join-Path $SourceRoot 'Cargo.toml'

function Copy-BuildArtifact {
  param([string]$Source, [string]$Destination)
  for ($attempt = 1; $attempt -le 20; $attempt++) {
    try {
      Copy-Item -LiteralPath $Source -Destination $Destination -Force
      return
    } catch [System.IO.IOException] {
      if ($attempt -eq 20) { throw }
      Start-Sleep -Milliseconds 250
    }
  }
}

if (-not (Test-Path -LiteralPath $sourceMarker)) {
  New-Item -ItemType Directory -Force -Path $downloads | Out-Null
  & curl.exe -L -C - --retry 100 --retry-all-errors --retry-delay 3 --connect-timeout 20 `
    -o $archive 'https://api.github.com/repos/kaspanet/rusty-kaspa/tarball/v2.0.1'
  if ($LASTEXITCODE -ne 0) { throw 'Unable to download Rusty Kaspa v2.0.1 source archive' }
  New-Item -ItemType Directory -Force -Path $SourceRoot | Out-Null
  & tar.exe -xzf $archive -C $SourceRoot --strip-components=1
  if ($LASTEXITCODE -ne 0) { throw 'Unable to extract Rusty Kaspa source archive' }
}

& rustup target add wasm32-unknown-unknown --toolchain 1.97.0
if ($LASTEXITCODE -ne 0) { throw 'Unable to install the wasm32 Rust target' }

$bindgenName = 'wasm-bindgen-0.2.100-x86_64-pc-windows-msvc'
$bindgenArchive = Join-Path $downloads "$bindgenName.tar.gz"
$bindgenRoot = Join-Path $downloads $bindgenName
$wasmBindgenExe = Join-Path $bindgenRoot 'wasm-bindgen.exe'
if (-not (Test-Path -LiteralPath $wasmBindgenExe)) {
  & curl.exe -L -C - --retry 100 --retry-all-errors --retry-delay 3 --connect-timeout 20 `
    -o $bindgenArchive "https://github.com/wasm-bindgen/wasm-bindgen/releases/download/0.2.100/$bindgenName.tar.gz"
  if ($LASTEXITCODE -ne 0) { throw 'Unable to download wasm-bindgen 0.2.100' }
  & tar.exe -xzf $bindgenArchive -C $downloads
  if ($LASTEXITCODE -ne 0) { throw 'Unable to extract wasm-bindgen 0.2.100' }
}
if ((& $wasmBindgenExe --version) -notmatch '0\.2\.100') { throw 'Unexpected wasm-bindgen version' }

$crateRoot = Join-Path $root 'native\kaspa_wallet_wasm'
$template = Get-Content -LiteralPath (Join-Path $crateRoot 'Cargo.toml.template') -Raw
$sourceForToml = $SourceRoot.Replace('\', '/')
$manifest = $template.Replace('__KASPA_SOURCE__', $sourceForToml)
[System.IO.File]::WriteAllText((Join-Path $crateRoot 'Cargo.toml'), $manifest, [System.Text.UTF8Encoding]::new($false))

$previousRustFlags = $env:RUSTFLAGS
$llvmBin = Join-Path $env:ProgramFiles 'LLVM\bin'
if (-not (Test-Path -LiteralPath (Join-Path $llvmBin 'clang.exe'))) {
  throw 'LLVM clang is required to compile the Kaspa secp256k1 wallet code for WebAssembly'
}
$previousPath = $env:PATH
$previousCargoRetry = $env:CARGO_NET_RETRY
$previousCargoTimeout = $env:CARGO_HTTP_TIMEOUT
$env:PATH = "$llvmBin;$env:PATH"
$env:RUSTFLAGS = '--cfg getrandom_backend="wasm_js"'
$env:CARGO_NET_RETRY = '100'
$env:CARGO_HTTP_TIMEOUT = '600'
& cargo +1.97.0 fetch --locked --manifest-path (Join-Path $crateRoot 'Cargo.toml') --target wasm32-unknown-unknown
$fetchExit = $LASTEXITCODE
if ($fetchExit -eq 0) {
  & cargo +1.97.0 build --offline --locked --manifest-path (Join-Path $crateRoot 'Cargo.toml') --target wasm32-unknown-unknown --release -j $Threads
  $cargoExit = $LASTEXITCODE
} else {
  $cargoExit = $fetchExit
}
$env:RUSTFLAGS = $previousRustFlags
$env:PATH = $previousPath
$env:CARGO_NET_RETRY = $previousCargoRetry
$env:CARGO_HTTP_TIMEOUT = $previousCargoTimeout
if ($cargoExit -ne 0) { throw 'Kaspa wallet-only Rust build failed' }

$wasm = Join-Path $crateRoot 'target\wasm32-unknown-unknown\release\altbase_kaspa_wallet_wasm.wasm'
$generated = Join-Path $crateRoot 'generated'
New-Item -ItemType Directory -Force -Path $generated | Out-Null
& $wasmBindgenExe $wasm --target web --out-dir $generated --out-name kaspa
if ($LASTEXITCODE -ne 0) { throw 'wasm-bindgen failed for Kaspa wallet-only module' }

$bindingsPath = Join-Path $generated 'kaspa.js'
$bindings = [System.IO.File]::ReadAllText($bindingsPath)
$defaultFetch = "module_or_path = new URL('kaspa_bg.wasm', import.meta.url);"
if (-not $bindings.Contains($defaultFetch)) { throw 'Unable to disable the Kaspa file URL fallback' }
$bindings = $bindings.Replace($defaultFetch, "throw new Error('Kaspa WASM bytes are required');")
[System.IO.File]::WriteAllText($bindingsPath, $bindings, [System.Text.UTF8Encoding]::new($false))

$wasmBytes = [System.IO.File]::ReadAllBytes((Join-Path $generated 'kaspa_bg.wasm'))
$wasmBase64 = [Convert]::ToBase64String($wasmBytes)
[System.IO.File]::WriteAllText(
  (Join-Path $generated 'kaspa_bg.base64.js'),
  "const kaspaWasmBase64 = '$wasmBase64';`nexport default kaspaWasmBase64;`n",
  [System.Text.UTF8Encoding]::new($false)
)
[System.IO.File]::WriteAllText(
  (Join-Path $generated 'kaspa_bg.base64.d.ts'),
  "declare const kaspaWasmBase64: string;`nexport default kaspaWasmBase64;`n",
  [System.Text.UTF8Encoding]::new($false)
)

$vendor = Join-Path $root 'vendor\kaspa-wasm-v2.0.1'
Copy-BuildArtifact (Join-Path $generated 'kaspa.js') (Join-Path $vendor 'kaspa.js')
Copy-BuildArtifact (Join-Path $generated 'kaspa.d.ts') (Join-Path $vendor 'kaspa.d.ts')
Copy-BuildArtifact (Join-Path $generated 'kaspa_bg.wasm') (Join-Path $vendor 'kaspa_bg.wasm')
Copy-BuildArtifact (Join-Path $generated 'kaspa_bg.base64.js') (Join-Path $vendor 'kaspa_bg.base64.js')
Copy-BuildArtifact (Join-Path $generated 'kaspa_bg.base64.d.ts') (Join-Path $vendor 'kaspa_bg.base64.d.ts')
if (Test-Path -LiteralPath (Join-Path $generated 'kaspa_bg.wasm.d.ts')) {
  Copy-BuildArtifact (Join-Path $generated 'kaspa_bg.wasm.d.ts') (Join-Path $vendor 'kaspa_bg.wasm.d.ts')
}

$installed = Join-Path $root 'node_modules\kaspa-wasm'
if ((Test-Path -LiteralPath $installed) -and -not (Get-Item -LiteralPath $installed -Force).LinkType) {
  Copy-BuildArtifact (Join-Path $vendor 'kaspa.js') (Join-Path $installed 'kaspa.js')
  Copy-BuildArtifact (Join-Path $vendor 'kaspa.d.ts') (Join-Path $installed 'kaspa.d.ts')
  Copy-BuildArtifact (Join-Path $vendor 'kaspa_bg.wasm') (Join-Path $installed 'kaspa_bg.wasm')
  Copy-BuildArtifact (Join-Path $vendor 'kaspa_bg.base64.js') (Join-Path $installed 'kaspa_bg.base64.js')
  Copy-BuildArtifact (Join-Path $vendor 'kaspa_bg.base64.d.ts') (Join-Path $installed 'kaspa_bg.base64.d.ts')
  if (Test-Path -LiteralPath (Join-Path $vendor 'kaspa_bg.wasm.d.ts')) {
    Copy-BuildArtifact (Join-Path $vendor 'kaspa_bg.wasm.d.ts') (Join-Path $installed 'kaspa_bg.wasm.d.ts')
  }
}

$forbidden = 'MiningManager|getBlockTemplate|submitBlock|estimateNetworkHashesPerSecond|consensus/pow|kaspa-pow|staking'
$wasmPath = Join-Path $vendor 'kaspa_bg.wasm'
$wasmText = [Text.Encoding]::ASCII.GetString([IO.File]::ReadAllBytes($wasmPath))
$regexOptions = [Text.RegularExpressions.RegexOptions]::IgnoreCase -bor [Text.RegularExpressions.RegexOptions]::CultureInvariant
if ([regex]::IsMatch($wasmText, $forbidden, $regexOptions)) {
  throw "Kaspa wallet-only WASM still contains forbidden mining, staking or node RPC strings"
}

$size = (Get-Item -LiteralPath $wasmPath).Length
Write-Host "Kaspa wallet-only WASM built: $size bytes; mining, staking and node RPC exports excluded."
