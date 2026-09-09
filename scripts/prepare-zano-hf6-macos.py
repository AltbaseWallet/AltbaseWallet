#!/usr/bin/env python3
import os,subprocess,json
from pathlib import Path
os.sched_setaffinity(0,{min(os.sched_getaffinity(0))})
os.environ.update({'CMAKE_BUILD_PARALLEL_LEVEL':'1','MAKEFLAGS':'-j1','CARGO_BUILD_JOBS':'1'})
import argparse
parser=argparse.ArgumentParser(description='Prepare Zano HF6 macOS archives on Linux, on one CPU.')
parser.add_argument('--output',type=Path,required=True)
parser.add_argument('--osxcross',type=Path,required=True,help='osxcross target directory')
parser.add_argument('--dependencies',type=Path,required=True,help='stage containing boost, OpenSSL and iconv for each architecture')
parser.add_argument('--source',type=Path,default=Path(__file__).resolve().parents[1]/'native/vendor/zano_native_lib/Zano')
parser.add_argument('--host-libraries',default='')
a=parser.parse_args()
base=a.output.resolve();base.mkdir(parents=True,exist_ok=True)
source=a.source.resolve();tool=a.osxcross.resolve();deps=a.dependencies.resolve()
(base/'thread-target.cmake').write_text('find_package(Threads REQUIRED)\nfind_package(ZLIB REQUIRED)\n')
os.environ['LD_LIBRARY_PATH']=str(tool/'lib')+':'+a.host_libraries+':'+os.environ.get('LD_LIBRARY_PATH','')
for arch in ['x86_64','arm64']:
 b=base/('zano-macos-'+arch);b.mkdir(exist_ok=True);log=b/'configure-build.log'
 compiler=tool/'bin'/(arch+'-apple-darwin24.5-clang')
 args=['cmake','-G','Ninja','-S',str(source),'-B',str(b),'-DCMAKE_SYSTEM_NAME=Darwin',f'-DCMAKE_PROJECT_INCLUDE={base}/thread-target.cmake',f'-DCMAKE_C_COMPILER={compiler}',f'-DCMAKE_CXX_COMPILER={compiler}++',f'-DCMAKE_OSX_ARCHITECTURES={arch}',f'-DCMAKE_OSX_SYSROOT={tool}/SDK/MacOSX15.5.sdk','-DCMAKE_OSX_DEPLOYMENT_TARGET=12.0','-DCMAKE_BUILD_TYPE=Release',f'-DCMAKE_EXE_LINKER_FLAGS=-fuse-ld={tool}/bin/{arch}-apple-darwin24.5-ld',f'-DCMAKE_SHARED_LINKER_FLAGS=-fuse-ld={tool}/bin/{arch}-apple-darwin24.5-ld','-DCMAKE_POLICY_VERSION_MINIMUM=3.5',f'-DZLIB_LIBRARY={tool}/SDK/MacOSX15.5.sdk/usr/lib/libz.tbd',f'-DZLIB_INCLUDE_DIR={tool}/SDK/MacOSX15.5.sdk/usr/include','-DCMAKE_POSITION_INDEPENDENT_CODE=ON','-DBUILD_GUI=OFF','-DBUILD_TESTS=OFF','-DSTATIC=OFF','-DDISABLE_TOR=ON','-DARCH=default','-DGIT=','-DCOMMIT=e30cf971b8b83c925252c0198f7ee482cdec34a4',f'-DBoost_FATLIB={deps}/boost-{arch}/lib/libboost.a',f'-DBoost_INCLUDE_DIRS={deps}/boost-{arch}/include',f'-DOPENSSL_INCLUDE_DIR={deps}/openssl-{arch}/include',f'-DOPENSSL_CRYPTO_LIBRARY={deps}/openssl-{arch}/lib/libcrypto.a',f'-DOPENSSL_SSL_LIBRARY={deps}/openssl-{arch}/lib/libssl.a','-DCMAKE_CXX_FLAGS=-DMOBILE_WALLET_BUILD=1 -DALTBASE_RELEASE_BINARY=1 -DDISABLE_PFR_SERIALIZATION_SELFCHECK','-DCMAKE_CXX_FLAGS_RELEASE=-O2 -DNDEBUG','-DCMAKE_C_FLAGS_RELEASE=-O2 -DNDEBUG']
 with log.open('w') as f:
  subprocess.run(args,stdout=f,stderr=subprocess.STDOUT,check=True)
  print(json.dumps({'phase':'configured','arch':arch}),flush=True)
  subprocess.run(['cmake','--build',str(b),'--parallel','1','--target','wallet','rpc','currency_core','crypto','common','zlibstatic','libminiupnpc-static'],stdout=f,stderr=subprocess.STDOUT,check=True)
 print(json.dumps({'phase':'upstream-built','arch':arch}),flush=True)
