#!/usr/bin/env python3
import os,subprocess,json,hashlib,sys
from pathlib import Path
os.sched_setaffinity(0,{0})
import argparse
parser=argparse.ArgumentParser(description='Link Zano macOS modules without compiling restricted storage source.')
parser.add_argument('--build-root',type=Path,required=True)
parser.add_argument('--osxcross',type=Path,required=True)
parser.add_argument('--dependencies',type=Path,required=True)
parser.add_argument('--source',type=Path,default=Path(__file__).resolve().parents[1]/'native/vendor/zano_native_lib/Zano')
parser.add_argument('--host-libraries',default='')
parser.add_argument('--arch',choices=['x86_64','arm64'])
a=parser.parse_args()
r=Path(__file__).resolve().parents[1];b=a.build_root.resolve();source=a.source.resolve();tool=a.osxcross.resolve();deps=a.dependencies.resolve();sdk=tool/'SDK/MacOSX15.5.sdk';src=r/'native/core/src'
os.sched_setaffinity(0,{min(os.sched_getaffinity(0))})
os.environ['LD_LIBRARY_PATH']=str(tool/'lib')+':'+a.host_libraries+':'+os.environ.get('LD_LIBRARY_PATH','')
allowed={'zano_core_module.cpp','privacy_light_wallet_impl.cpp','coin_wallet_module.cpp','native_http.cpp','protocol.cpp','zanoHf6Decode.cpp','zanoNativeReadiness.cpp'}
def run(args):
 if any(Path(str(x)).suffix=='.cpp' and Path(str(x)).name not in allowed for x in args):raise RuntimeError('Source not allowlisted')
 subprocess.run([str(x) for x in args],check=True)
configs=[('x86_64','x64'),('arm64','arm64')]
if a.arch:configs=[x for x in configs if x[0]==a.arch]
for arch,short in configs:
 build=b/('zano-macos-'+arch);out=b/('macos-native-'+arch);out.mkdir(exist_ok=True);previous=r/f'native/core/build/macos-{short}-release';cc=tool/'bin'/(arch+'-apple-darwin24.5-clang++');ld=tool/'bin'/(arch+'-apple-darwin24.5-ld')
 flags=['-arch',arch,'-isysroot',sdk,'-mmacosx-version-min=12.0','-stdlib=libc++','-O2','-DNDEBUG','-fPIC','-fvisibility=hidden','-fvisibility-inlines-hidden','-DMOBILE_WALLET_BUILD=1','-DALTBASE_RELEASE_BINARY=1','-DDISABLE_TOR','-DSTATICLIB','-DUSE_OPEN_SSL_FOR_ECDSA','-DDISABLE_PFR_SERIALIZATION_SELFCHECK','-D_GNU_SOURCE',f'-fuse-ld={ld}']
 includes=[src,source/'src',source/'contrib',source/'contrib/epee/include',source/'contrib/eos_portable_archive',source/'contrib/jwt-cpp/include',build/'version',build/'contrib/zlib',deps/f'boost-{arch}/include',deps/f'openssl-{arch}/include',deps/f'iconv-{arch}/include',r/'native/core/build/linux-x64-release/_deps/secp256k1-src/include']
 flags += [f'-I{x}' for x in includes]
 def compile(name,defs=(),standard='c++20'):
  obj=out/(Path(name).stem+'.o');file=r/'tests'/name if name.startswith('zanoHf6') or name.startswith('zanoNative') else src/name
  run([cc,*flags,f'-std={standard}',*['-D'+d for d in defs],*(['-UNDEBUG'] if file.parent==r/'tests' else []),'-c',file,'-o',obj]);return obj
 core=compile('zano_core_module.cpp',['ALTBASE_ZANO_CORE_EXPORTS'],'c++17')
 archives=[build/'src'/f'lib{n}.a' for n in ['wallet','rpc','currency_core','crypto','common']]
 archives += [build/'contrib/db/liblmdb/liblmdb.a',build/'contrib/db/libmdbx/libmdbx.a',build/'contrib/zlib/libz.a',build/'contrib/miniupnp/miniupnpc/libminiupnpc.a',deps/f'boost-{arch}/lib/libboost.a',deps/f'openssl-{arch}/lib/libssl.a',deps/f'openssl-{arch}/lib/libcrypto.a',deps/f'iconv-{arch}/lib/libiconv.a']
 for p in archives:
  if not p.exists():raise RuntimeError('Missing archive: '+str(p))
 libs=['-framework','Foundation','-framework','Security','-framework','CoreFoundation','-framework','SystemConfiguration','-liconv','-lz','-lresolv']
 run([cc,*flags,'-dynamiclib',core,*archives,*libs,'-Wl,-dead_strip','-Wl,-install_name,@rpath/libaltbase_zano_core.dylib','-Wl,-rpath,@loader_path','-o',out/'libaltbase_zano_core.dylib'])
 objects=[compile(n,['ALTBASE_ZANO_WALLET_ONLY=1','ALTBASE_ZANO_WALLET_EXPORTS']) for n in ['coin_wallet_module.cpp','privacy_light_wallet_impl.cpp','protocol.cpp','native_http.cpp']]
 storage=previous/'CMakeFiles/altbase_zano_wallet.dir/src/wallet_secret.cpp.o'
 if not storage.exists():raise RuntimeError('Required existing storage object missing')
 run([cc,*flags,'-dynamiclib',*objects,storage,previous/'bin/libaltbase_net_core.dylib',previous/'_deps/secp256k1-build/lib/libsecp256k1.6.dylib',out/'libaltbase_zano_core.dylib',deps/f'openssl-{arch}/lib/libcrypto.a',*libs,'-Wl,-dead_strip','-Wl,-install_name,@rpath/libaltbase_zano_wallet.dylib','-Wl,-rpath,@loader_path','-o',out/'libaltbase_zano_wallet.dylib'])
 fixture=compile('zanoHf6Decode.cpp',standard='c++17');run([cc,*flags,fixture,*archives,*libs,'-Wl,-dead_strip','-o',out/'zano-hf6-decode'])
 ready=compile('zanoNativeReadiness.cpp');run([cc,*flags,ready,'-Wl,-dead_strip','-o',out/'zano-readiness'])
 print(json.dumps({'linkedArchitecture':arch,'cpuAffinity':[0],'storageObjectReused':True}),flush=True)
if not all((b/('macos-native-'+a)/'zano-readiness').exists() for a in ['x86_64','arm64']):sys.exit(0)
uni=b/'macos-native-universal';uni.mkdir(exist_ok=True);lipo=tool/'bin/x86_64-apple-darwin24.5-lipo'
for name in ['libaltbase_zano_core.dylib','libaltbase_zano_wallet.dylib','zano-hf6-decode','zano-readiness']:
 run([lipo,'-create',b/'macos-native-x86_64'/name,b/'macos-native-arm64'/name,'-output',uni/name]);run([lipo,uni/name,'-verify_arch','x86_64','arm64'])
manifest={'platform':'macOS','buildHost':'Linux','architectures':['x86_64','arm64'],'cpuAffinity':[0],'compiledSources':sorted(allowed),'storageObjectReused':True,'runtimeTestsPerformed':False,'files':[{'file':p.name,'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in uni.iterdir()]};(uni/'manifest.json').write_text(json.dumps(manifest,indent=2));print(json.dumps(manifest))
