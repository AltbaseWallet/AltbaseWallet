import sys,json
from pathlib import Path
from types import SimpleNamespace
# Run with PYTHONPATH pointing to a checkout of zcash/zcash-test-vectors.
from zcash_test_vectors.transaction import TransactionV5,Script,OutPoint,TxIn,TxOut
from zcash_test_vectors.zip_0244 import signature_digest,txid_digest
vectors=[]
for branch in [0x5437f330,0x37a5165b]:
 for count in [1,2,20]:
  t=TransactionV5.__new__(TransactionV5)
  t.nVersionGroupId=0x26a7270a;t.nConsensusBranchId=branch;t.nLockTime=0;t.nExpiryHeight=3493840
  t.vSpendsSapling=[];t.vOutputsSapling=[];t.vActionsOrchard=[]
  t.vin=[];t.vout=[];prev=[]
  for i in range(count):
   script=Script.from_bytes(bytes.fromhex('76a914'+'01'*20+'88ac'))
   t.vin.append(TxIn.from_components(OutPoint.from_components(bytes([i+1])*32,i),Script.from_bytes(b''),0xfffffffe-i))
   prev.append(SimpleNamespace(nIn=i,scriptPubKey=script,amount=100000000+i))
  out=TxOut.__new__(TxOut);out.nValue=90000000;out.scriptPubKey=Script.from_bytes(bytes.fromhex('76a914'+'02'*20+'88ac'));t.vout.append(out)
  vectors.append({'inputCount':count,'height':t.nExpiryHeight,'branch':t.nConsensusBranchId,'txid':txid_digest(t)[::-1].hex(),'digests':[signature_digest(t,prev,1,p).hex() for p in prev]})
Path(__file__).with_name('zcash-zip244-transparent.json').write_text(json.dumps({'source':'https://github.com/zcash/zcash-test-vectors','generator':'zip_0244.signature_digest (SIGHASH_ALL), NU6.2 and NU6.3 transparent fixtures','vectors':vectors},indent=2)+'\n')
print('Generated 46 independent Zcash signature digests from the official reference')
