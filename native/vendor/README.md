# Native Vendor Source

This directory contains Git submodules used by the optional native privacy
wallet integrations.

Submodules:

- `zano_native_lib`
- `epic_src`
- `epic_wallet_src`

Not included:

- build directories
- Rust `target` directories
- Zano `_install_*` prebuilt dependency folders
- Zano `_libs_*` binary folders
- `.git` directories
- compiled binaries and archives

For a full privacy-coin native build, initialize submodules and restore or build
the omitted dependencies according to the root `README.md`.
