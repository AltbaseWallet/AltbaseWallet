# Application update feed integration

Use `appUpdatePayload(configuration, request)` from `appUpdate.cjs` for
`GET /api/v1/app/update`. Keep production RPC credentials in the existing private
configuration. The loader must retain `platforms: file?.appUpdate?.platforms`.

Linux, Windows and macOS now advertise 0.1.13 after all linked release assets
passed digest and size verification. The Windows ZIP contains the MSI installer;
the macOS ZIP contains the complete Intel/Apple Silicon application. Older or
equal advertised versions are never offered as upgrades. macOS builds have
ad-hoc signatures; Apple notarization and native Mac GUI testing are unavailable
in this environment.

The public configuration below contains no credentials or wallet profiles.

```json
{
  "latestVersion": "0.1.13",
  "downloadUrl": "https://github.com/AltbaseWallet/AltbaseWallet/releases/tag/v0.1.13",
  "releaseNotesUrl": "https://github.com/AltbaseWallet/AltbaseWallet/releases/tag/v0.1.13",
  "required": false,
  "filesBaseUrl": "https://github.com/AltbaseWallet/AltbaseWallet/releases/download/v0.1.13",
  "files": {
    "windows": "https://github.com/AltbaseWallet/AltbaseWallet/releases/download/v0.1.13/Altbase-Wallet-Windows-v0.1.13.zip",
    "windowsMsi": "https://github.com/AltbaseWallet/AltbaseWallet/releases/download/v0.1.13/Altbase-Wallet-Windows-x64-v0.1.13.msi",
    "linux": "https://github.com/AltbaseWallet/AltbaseWallet/releases/download/v0.1.13/Altbase-Wallet-Linux-x64-v0.1.13.tar.gz",
    "ubuntu": "https://github.com/AltbaseWallet/AltbaseWallet/releases/download/v0.1.13/Altbase-Wallet-Linux-x64-v0.1.13.tar.gz",
    "macos": "https://github.com/AltbaseWallet/AltbaseWallet/releases/download/v0.1.13/Altbase-Wallet-macOS-universal-v0.1.13.zip",
    "checksums": "https://github.com/AltbaseWallet/AltbaseWallet/releases/download/v0.1.13/SHA256SUMS-v0.1.13.txt"
  },
  "platforms": {
    "macos": {
      "latestVersion": "0.1.13",
      "downloadUrl": "https://github.com/AltbaseWallet/AltbaseWallet/releases/tag/v0.1.13",
      "releaseNotesUrl": "https://github.com/AltbaseWallet/AltbaseWallet/releases/tag/v0.1.13",
      "required": false,
      "filesBaseUrl": "https://github.com/AltbaseWallet/AltbaseWallet/releases/download/v0.1.13",
      "files": {
        "macos": "https://github.com/AltbaseWallet/AltbaseWallet/releases/download/v0.1.13/Altbase-Wallet-macOS-universal-v0.1.13.zip",
        "checksums": "https://github.com/AltbaseWallet/AltbaseWallet/releases/download/v0.1.13/SHA256SUMS-v0.1.13.txt"
      }
    }
  }
}
```
