"""Verify BC2 v31.1 signatures against independent legacy, BIP143 and BIP341 digests.
Usage: python3 tests/bc2ReplaySigner.py /path/to/libaltbase_utxo_signer.so /path/to/libsecp256k1.so.6
Uses a public test mnemonic and fabricated, unfunded outpoints; never broadcasts.
"""
import ctypes, hashlib, json, struct, sys
from cryptography.hazmat.primitives.asymmetric import ec, utils
from cryptography.hazmat.primitives import hashes

lib=ctypes.CDLL(sys.argv[1]); lib.altbase_utxo_signer_request.argtypes=[ctypes.c_char_p]; lib.altbase_utxo_signer_request.restype=ctypes.c_void_p
lib.altbase_utxo_signer_free.argtypes=[ctypes.c_void_p]
secp=ctypes.CDLL(sys.argv[2]); secp.secp256k1_context_create.argtypes=[ctypes.c_uint]; secp.secp256k1_context_create.restype=ctypes.c_void_p
ctx=secp.secp256k1_context_create(1)
for name in ['secp256k1_xonly_pubkey_parse','secp256k1_xonly_pubkey_tweak_add','secp256k1_xonly_pubkey_from_pubkey','secp256k1_xonly_pubkey_serialize']:
 getattr(secp,name).argtypes=[ctypes.c_void_p]*({'secp256k1_xonly_pubkey_parse':3,'secp256k1_xonly_pubkey_tweak_add':4,'secp256k1_xonly_pubkey_from_pubkey':4,'secp256k1_xonly_pubkey_serialize':3}[name])
secp.secp256k1_schnorrsig_verify.argtypes=[ctypes.c_void_p,ctypes.c_void_p,ctypes.c_void_p,ctypes.c_size_t,ctypes.c_void_p]
sha=lambda x:hashlib.sha256(x).digest()
double=lambda x:sha(sha(x))
u32=lambda x:struct.pack('<I',x)
u64=lambda x:struct.pack('<Q',x)
var=lambda x:bytes([x]) if x<253 else b'\xfd'+struct.pack('<H',x)
vector=lambda x:var(len(x))+x
tagged=lambda tag,msg:sha(sha(tag.encode())*2+msg)
prevout=bytes.fromhex('ab'*32)+u32(0); sequence=u32(0xffffffff)
value=101000; output=u64(100000)+vector(b'\x51')
base=lambda script:u32(1)+b'\x01'+prevout+vector(script)+sequence+b'\x01'+output+u32(0)
def sign(script,style,kind):
 request={'id':'public-regression','method':'signTransaction','params':{'phrase':'test test test test test test test test test test test junk','derivationPath':"m/44'/16001'/0'/0/0",'coin':'bitcoin2','sighashStyle':style,'addressType':kind,'inputs':'ab'*32+':0:'+str(value)+':'+script.hex(),'outputs':'100000:51'}}
 ptr=lib.altbase_utxo_signer_request(json.dumps(request).encode())
 try:r=json.loads(ctypes.string_at(ptr))
 finally:lib.altbase_utxo_signer_free(ptr)
 assert r['ok'],r
 return bytes.fromhex(r['result']['txHex'])
def parse(raw):
 pos=4; witness=raw[pos:pos+2]==b'\x00\x01'
 if witness:pos+=2
 def vi():
  nonlocal pos
  n=raw[pos];pos+=1
  if n<253:return n
  size={253:2,254:4,255:8}[n];n=int.from_bytes(raw[pos:pos+size],'little');pos+=size;return n
 def vec():
  nonlocal pos
  n=vi();v=raw[pos:pos+n];pos+=n;return v
 assert vi()==1;pos+=36;script=vec();pos+=4
 assert vi()==1;pos+=8;vec()
 stack=[vec() for _ in range(vi())] if witness else []
 assert len(raw)-pos==4
 if witness:return stack
 n=script[0];sig=script[1:1+n];pub=script[2+n:];return [sig,pub]
_,pub=parse(sign(b'\x76\xa9\x14'+bytes(20)+b'\x88\xac','legacy','p2pkh'))
h160=hashlib.new('ripemd160',sha(pub)).digest();p2pkh=b'\x76\xa9\x14'+h160+b'\x88\xac'
xonly=ctypes.create_string_buffer(64);assert secp.secp256k1_xonly_pubkey_parse(ctx,xonly,pub[1:])==1
full=ctypes.create_string_buffer(64);tweak=tagged('TapTweak',pub[1:]);assert secp.secp256k1_xonly_pubkey_tweak_add(ctx,full,xonly,tweak)==1
output_key=ctypes.create_string_buffer(64);parity=ctypes.c_int();assert secp.secp256k1_xonly_pubkey_from_pubkey(ctx,output_key,ctypes.byref(parity),full)==1
encoded=ctypes.create_string_buffer(32);assert secp.secp256k1_xonly_pubkey_serialize(ctx,encoded,output_key)==1
for kind,script in [('p2pkh',p2pkh),('p2wpkh',b'\x00\x14'+h160),('p2tr',b'\x51\x20'+encoded.raw)]:
 signatures=[]
 for style,domain in [('legacy',b''),('bc2-replay',u32(0x01324342))]:
  sig,*keys=parse(sign(script,style,kind));signatures.append(sig)
  if kind=='p2pkh':digest=double(base(script)+u32(1)+domain)
  elif kind=='p2wpkh':digest=double(u32(1)+double(prevout)+double(sequence)+prevout+vector(p2pkh)+u64(value)+sequence+double(output)+u32(0)+u32(1)+domain)
  else:digest=tagged('TapSighash',b'\x00'+domain+b'\x00'+u32(1)+u32(0)+sha(prevout)+sha(u64(value))+sha(vector(script))+sha(sequence)+sha(output)+b'\x00'+u32(0))
  if kind=='p2tr':assert secp.secp256k1_schnorrsig_verify(ctx,sig,digest,len(digest),output_key)==1
  else:
   assert sig[-1]==1
   ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256K1(),keys[0]).verify(sig[:-1],digest,ec.ECDSA(utils.Prehashed(hashes.SHA256())))
  print(style,kind,'signature verified')
 assert signatures[0]!=signatures[1], 'BC2 signature must not replay under the old digest'
secp.secp256k1_context_destroy.argtypes=[ctypes.c_void_p];secp.secp256k1_context_destroy(ctx)
