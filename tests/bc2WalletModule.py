"""Verify the packaged BC2 module using independent digests and unfunded fixtures.

Arguments: baseline signer, libsecp256k1, BC2 module, output JSON.
Public fixture phrase is constructed only in RAM by the existing test helper.
The output contains public scripts and expected transaction bytes, never keys.
"""
import ctypes
import hashlib
import json
from pathlib import Path
import runpy
import sys

baseline, secp, module, output = sys.argv[1:]
original_argv = sys.argv
sys.argv = [str(Path(__file__).with_name('bc2ReplaySigner.py')), baseline, secp]
reference = runpy.run_path(sys.argv[0])
sys.argv = original_argv
sign = reference['sign']
sign_globals = sign.__globals__
reference_lib = sign_globals['lib']
adapter = ctypes.CDLL(module)
adapter.altbase_bitcoin2_wallet_request.argtypes = [ctypes.c_char_p]
adapter.altbase_bitcoin2_wallet_request.restype = ctypes.c_void_p
adapter.altbase_bitcoin2_wallet_free.argtypes = [ctypes.c_void_p]
adapter.altbase_utxo_signer_request = adapter.altbase_bitcoin2_wallet_request
adapter.altbase_utxo_signer_free = adapter.altbase_bitcoin2_wallet_free
scripts = [('p2pkh', reference['p2pkh']), ('p2wpkh', b'\x00\x14'+reference['h160']), ('p2tr', b'\x51\x20'+reference['encoded'].raw)]
rows = []
for kind, script in scripts:
    sign_globals['lib'] = reference_lib
    expected = sign(script, 'bc2-replay', kind)
    old = sign(script, 'legacy', kind)
    assert expected != old
    sign_globals['lib'] = adapter
    for style in ['bc2-replay', 'legacy', '']:
        actual = sign(script, style, kind)
        assert actual == expected, (kind, style, 'BC2 module must use the verified mainnet digest')
        rows.append({'addressType':kind, 'sighashStyle':style, 'script':script.hex(), 'expectedTxHex':expected.hex()})
        print('BC2 module', kind, style or 'omitted style', 'PASS')
payload = {'fixture':'public-unfunded-bc2-v31.1', 'moduleSha256':hashlib.sha256(Path(module).read_bytes()).hexdigest(), 'requests':rows, 'networkRequests':0, 'userWalletsOpened':0, 'broadcasts':0}
Path(output).write_text(json.dumps(payload, indent=2)+'\n')
