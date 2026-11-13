# Application update feed integration

Use `appUpdatePayload(configuration, request)` from `appUpdate.cjs` for the
`GET /api/v1/app/update` response. `configuration` is the public `appUpdate`
section of the API configuration; `request` supplies `currentVersion` and
`platform`. Keep production RPC credentials in the existing private config.

The configuration loader must retain `platforms: file?.appUpdate?.platforms`.
Linux and Windows advertise 0.1.13 only after all linked release assets have
been verified. macOS retains its published 0.1.9 release because a new Darwin
build is unavailable. Older or equal versions are never offered as updates.

The current public update metadata is shown below. This file contains no RPC
credentials, signing keys, user profiles or protected wallet source.

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
    "macos": "https://github.com/AltbaseWallet/AltbaseWallet/releases/download/v0.1.9/Altbase-Wallet-macOS-universal-v0.1.9.zip",
    "checksums": "https://github.com/AltbaseWallet/AltbaseWallet/releases/download/v0.1.13/SHA256SUMS-v0.1.13.txt"
  },
  "platforms": {
    "macos": {
      "latestVersion": "0.1.9",
      "downloadUrl": "https://github.com/AltbaseWallet/AltbaseWallet/releases/tag/v0.1.9",
      "releaseNotesUrl": "https://github.com/AltbaseWallet/AltbaseWallet/releases/tag/v0.1.9",
      "required": false,
      "filesBaseUrl": "https://github.com/AltbaseWallet/AltbaseWallet/releases/download/v0.1.9",
      "files": {
        "macos": "https://github.com/AltbaseWallet/AltbaseWallet/releases/download/v0.1.9/Altbase-Wallet-macOS-universal-v0.1.9.zip",
        "checksums": "https://github.com/AltbaseWallet/AltbaseWallet/releases/download/v0.1.9/SHA256SUMS-v0.1.9.txt"
      }
    }
  }
}
```
