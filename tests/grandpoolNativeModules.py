"""Independent offline signatures for the three new native UTXO modules.
Random fixture entropy stays in memory. No network access or user profiles.
Usage: python3 tests/grandpoolNativeModules.py /path/to/native/bin
"""
import ctypes,hashlib,json,struct,subprocess,sys
from pathlib import Path
from cryptography.hazmat.primitives.asymmetric import ec,utils
from cryptography.hazmat.primitives import hashes
root=Path(__file__).resolve().parent.parent
js="""const {generateMnemonic,mnemonicToSeedSync}=require('@scure/bip39'),{wordlist}=require('@scure/bip39/wordlists/english'),{HDKey}=require('@scure/bip32');const mnemonic=generateMnemonic(wordlist),root=HDKey.fromMasterSeed(mnemonicToSeedSync(mnemonic));process.stdout.write(JSON.stringify({mnemonic,pubkeys:[145,20,6].map((coin,i)=>Buffer.from(root.derive(`m/${i===1?84:44}'/${coin}'/0'/0/0`).publicKey).toString('hex'))}));"""
fixture=json.loads(subprocess.check_output(['node','-e',js],cwd=root))
u32=lambda n:struct.pack('<I',n)
u64=lambda n:struct.pack('<Q',n)
sha=lambda b:hashlib.sha256(b).digest()
double=lambda b:sha(sha(b))
vec=lambda b:bytes([len(b)])+b
rows=[]
for index,(coin,bip,kind,version,style) in enumerate([('bitcoincash',145,'p2pkh',2,'bip143-forkid'),('digibyte',20,'p2wpkh',2,'legacy'),('peercoin',6,'p2pkh',3,'legacy')]):
 lib=ctypes.CDLL(str(Path(sys.argv[1]).resolve()/f'altbase_{coin}_wallet.so'))
 request=getattr(lib,f'altbase_{coin}_wallet_request');request.argtypes=[ctypes.c_char_p];request.restype=ctypes.c_void_p
 free=getattr(lib,f'altbase_{coin}_wallet_free');free.argtypes=[ctypes.c_void_p]
 pub=bytes.fromhex(fixture['pubkeys'][index]);h160=hashlib.new('ripemd160',sha(pub)).digest();pkh=b'\x76\xa9\x14'+h160+b'\x88\xac';script=(b'\x00\x14'+h160) if kind=='p2wpkh' else pkh
 for count in [1,5]:
  outpoints=[bytes([30+i])*32+u32(i) for i in range(count)];amounts=[101000+i for i in range(count)];sequence=u32(0xffffffff);outputs=u64(sum(amounts)-1000)+vec(b'\x51')
  params={'coin':coin,'phrase':fixture['mnemonic'],'derivationPath':f"m/{84 if kind=='p2wpkh' else 44}'/{bip}'/0'/0/0",'addressType':kind,'txVersion':str(version),'sighashStyle':style,'inputs':'|'.join(f'{bytes([30+i]).hex()*32}:{i}:{amounts[i]}:{script.hex()}' for i in range(count)),'outputs':f'{sum(amounts)-1000}:51'}
  pointer=request(json.dumps({'id':'offline-fixture','method':'signTransaction','params':params}).encode())
  try:response=json.loads(ctypes.string_at(pointer))
  finally:free(pointer)
  assert response.get('ok'),f'{coin}: native signing rejected fixture'
  raw=bytes.fromhex(response['result']['txHex']);assert raw[:4]==u32(version);offset=4
  witness=raw[offset:offset+2]==b'\x00\x01'
  if witness:offset+=2
  assert raw[offset]==count;offset+=1;signatures=[]
  for i in range(count):
   assert raw[offset:offset+36]==outpoints[i];offset+=36
   size=raw[offset];offset+=1;unlock=raw[offset:offset+size];offset+=size
   assert raw[offset:offset+4]==sequence;offset+=4
   if not witness:
    n=unlock[0];sig=unlock[1:1+n];assert unlock[2+n:]==pub;signatures.append(sig)
  assert raw[offset]==1;offset+=1;assert raw[offset:offset+len(outputs)]==outputs;offset+=len(outputs)
  if witness:
   for i in range(count):
    assert raw[offset]==2;offset+=1;n=raw[offset];offset+=1;signatures.append(raw[offset:offset+n]);offset+=n
    n=raw[offset];offset+=1;assert raw[offset:offset+n]==pub;offset+=n
  assert raw[offset:]==u32(0)
  for i,sig in enumerate(signatures):
   hashType=0x41 if coin=='bitcoincash' else 1;assert sig[-1]==hashType
   if coin=='bitcoincash' or witness:
    digest=double(u32(version)+double(b''.join(outpoints))+double(sequence*count)+outpoints[i]+vec(pkh)+u64(amounts[i])+sequence+double(outputs)+u32(0)+u32(hashType))
   else:
    body=u32(version)+bytes([count])+b''.join(outpoints[j]+vec(pkh if i==j else b'')+sequence for j in range(count))+b'\x01'+outputs+u32(0)+u32(hashType)
    digest=double(body)
   ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256K1(),pub).verify(sig[:-1],digest,ec.ECDSA(utils.Prehashed(hashes.SHA256())))
  rows.append({'coin':coin,'inputs':count,'verifiedSignatures':len(signatures),'txVersion':version})
print(json.dumps({'checks':rows,'networkRequests':0,'broadcasts':0,'userProfilesOpened':0},indent=2))
