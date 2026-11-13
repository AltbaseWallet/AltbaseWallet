# Source export review

This populated export contains the public source for Altbase Wallet 0.1.13 and
its separate coin/feature repositories. Git history, profiles, credentials,
application packages, local diagnostics and generated application/module
binaries are excluded. Pinned vendor dependency packages and their licenses
are retained because package.json resolves them locally.

The protected wallet implementation and source copies are excluded before
file access. New upload operations never include them or delete existing
protected remote entries. Supply the owner-maintained implementation locally
when building a source export that omits it. Existing protected remote files
remain unchanged in their current repository.

Each entry in GITHUB-REPOSITORIES.json is published to its own repository.
The parent repository records module commit pins rather than module contents.
See CHANGELOG.md for the complete English release notes and README.md for
platform runtime staging and compilation requirements.
