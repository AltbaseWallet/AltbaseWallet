These fixtures render the production Send, Dashboard and TransactionDetails components. They use an isolated Electron profile, block external network access, replace send/sign/broadcast entry points with throwing mocks, and supply an invalid mnemonic sentinel. Never use them with an existing wallet profile.

From the repository root, run in separate terminals:

```sh
npx vite --config tests/gui/technical/vite.config.ts --host 127.0.0.1 --port 18508 --strictPort
npx electron --no-sandbox tests/gui/technical/electron.cjs
node tests/gui/technical/run.cjs
```

The runner only clicks MAX, Continue and Cancel. It can open a review dialog but never clicks Confirm and send. Results and screenshots default to `/tmp/altbase-technical-20260908/gui-results`; override with `ALTBASE_QA_OUTPUT`. The isolated Electron profile can be changed with `ALTBASE_QA_PROFILE`. The fixture is outside the production Vite entry and is excluded from the packaged app.

Vite file watching is disabled: restart it after source edits. This also avoids traversing native source trees. The Linux host requires `--no-sandbox` because its Electron sandbox helper is not configured; the fixture still blocks external network requests and does not load the wallet preload bridge.

Coverage: real Nonsense WASM MAX planning over 1000 synthetic UTXOs; changing PEPE MAX fee; delayed CKB result/cancellation; production background/manual privacy commit races against a concurrent BCH2 update; Kaspa confirmation mapping; Qubic legacy status migration and rendering. CKB unsigned transaction planning, proof validation, bounded proof concurrency and long timeouts are covered separately by the unit tests.

Read-only reconciliation fixtures (BCH2 cashaddr selection and privacy balance display):

```sh
node tests/gui/technical/reconciliation.cjs
```

This runner does not click any transfer controls. Its results and screenshots are saved in `artifacts/reconciliation-20260908/gui-fixtures/`. Service tests in `tests/privacyReadinessReconciliation.test.cjs` also check ready → timeout → ready transitions and Zano scan height evidence using mocked native responses.
