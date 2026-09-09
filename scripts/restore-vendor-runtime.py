#!/usr/bin/env python3
"""Restore the detached, hash-checked WASM runtime bundle before npm build."""
from pathlib import Path
import hashlib,sys,zipfile
ROOT=Path(__file__).resolve().parents[1]
EXPECTED='7a5fa2cd5e4be6d144125c4ac875fec712310f3a6bc5f6028117c1f7b4a8c6dc'
FILES=['vendor/kaspa-wasm-v2.0.1/kaspa_bg.wasm', 'vendor/kaspa-wasm-v2.0.1/kaspa_bg.base64.js', 'vendor/nonsense-wasm-v0.1.7/nonsense_bg.wasm', 'vendor/nonsense-wasm-v0.1.7/nonsense_bg.base64.js']
if len(sys.argv)!=2:raise SystemExit('Usage: python3 scripts/restore-vendor-runtime.py /path/to/Altbase-WASM-runtime-v0.1.7.zip')
p=Path(sys.argv[1])
if hashlib.sha256(p.read_bytes()).hexdigest()!=EXPECTED:raise SystemExit('WASM bundle SHA-256 mismatch')
with zipfile.ZipFile(p) as z:
 if sorted(z.namelist())!=sorted(FILES):raise SystemExit('Unexpected WASM bundle files')
 for name in FILES:
  target=ROOT/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(z.read(name))
print('WASM runtime restored; run npm ci before building.')
