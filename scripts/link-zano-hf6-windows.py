#!/usr/bin/env python3
"""Build Windows Zano wrappers on Linux using prepared HF6 archives and SDK.

Only the explicit source list below is compiled. The existing secret-storage
object is reused without accessing its source. Every child shares one CPU.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--cache', type=Path, required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
cache = args.cache.resolve()
out = cache / 'modules'
out.mkdir(exist_ok=True)
src = root / 'native/core/src'
sdk = Path.home() / '.cache/altbase-build/xwin-sdk'
previous = Path.home() / '.cache/altbase-build/windows-native-incremental'
source = cache / 'upstream'
build = cache / 'build'
boost = cache / 'boost/app'
openssl = cache / 'openssl-win'
cpu = min(os.sched_getaffinity(0))
os.sched_setaffinity(0, {cpu})
os.nice(10)

allowed = {'zano_core_module.cpp', 'privacy_light_wallet_impl.cpp',
           'coin_wallet_module.cpp', 'protocol.cpp', 'native_http.cpp',
           'zanoHf6Decode.cpp', 'zanoNativeReadiness.cpp'}

def run(argv, capture=False):
    for value in argv:
        if str(value).endswith('.cpp') and Path(value).name not in allowed:
            raise RuntimeError('Source is not on the compile allowlist')
    return subprocess.run([str(v) for v in argv], check=True,
                          capture_output=capture, text=capture)

includes = [src, source/'src', source/'src/platform/msc', source/'contrib',
            source/'contrib/epee/include', source/'contrib/eos_portable_archive',
            source/'contrib/jwt-cpp/include', build/'version', build/'contrib/zlib',
            boost, openssl/'include',
            root/'native/core/build/linux-x64-release/_deps/secp256k1-src/include']
system = [sdk/'crt/include', sdk/'sdk/include/ucrt',
          sdk/'sdk/include/shared', sdk/'sdk/include/um']
flags = ['--target=x86_64-pc-windows-msvc', '/nologo', '/std:c++20', '/O2',
         '/MT', '/EHsc', '/Gy', '/Gw', '/Brepro', '/DNDEBUG', '/DNOMINMAX',
         '/DWIN32', '/D_WINDOWS', '/DWIN64', '/D_WIN64',
         '/DBOOST_ALL_NO_LIB',
         '/DBOOST_NO_CXX98_FUNCTION_BASE', '/FIstddef.h', '/FIcstdint',
         '/FIinline_c.h', '/D_WIN32_WINNT=0x0600',
         '/DSTATICLIB', '/DDISABLE_TOR', '/DDISABLE_PFR_SERIALIZATION_SELFCHECK',
         '/DUSE_OPEN_SSL_FOR_ECDSA', '/DALTBASE_RELEASE_BINARY=1',
         '/DMOBILE_WALLET_BUILD=1', '/D_CRT_SECURE_NO_WARNINGS',
         *[f'/imsvc{p}' for p in system], *[f'/I{p}' for p in includes]]

def compile_file(file, name, definitions=()):
    obj = out / (name + '.obj')
    # Compile protocol-facing code with the same language mode as upstream.
    mode = ['/std:c++17'] if file.name in ('zano_core_module.cpp', 'zanoHf6Decode.cpp') else []
    if file.parent == root / 'tests':
        mode.append('/UNDEBUG')
    run(['clang-cl-19', *flags, *mode, *[f'/D{d}' for d in definitions],
         '/c', file, f'/Fo{obj}'])
    return obj

linkflags = ['/release', '/dynamicbase', '/nxcompat', '/highentropyva',
             '/cetcompat', '/Brepro', '/opt:ref', '/opt:icf', '/machine:x64',
             f'/libpath:{boost}/lib64-msvc-14.3',
             *[f'/libpath:{sdk/p}' for p in ['crt/lib/x86_64',
               'sdk/lib/ucrt/x86_64', 'sdk/lib/um/x86_64']]]
systemlibs = ['kernel32.lib', 'user32.lib', 'shell32.lib', 'advapi32.lib',
              'bcrypt.lib', 'crypt32.lib', 'ntdll.lib', 'ws2_32.lib',
              'mswsock.lib', 'iphlpapi.lib', 'dbghelp.lib', 'gdi32.lib',
              'ole32.lib']
archives = [build/'src'/f'{n}.lib' for n in
            ['wallet', 'rpc', 'currency_core', 'crypto', 'common']]
archives += [build/'contrib/db/liblmdb/lmdb.lib',
             build/'contrib/db/libmdbx/mdbx.lib',
             build/'contrib/zlib/zlibstatic.lib',
             build/'contrib/miniupnp/miniupnpc/miniupnpc.lib',
             openssl/'lib/libssl.lib', openssl/'lib/libcrypto.lib']
archives += [boost/'lib64-msvc-14.3'/f'libboost_{n}-vc143-mt-s-x64-1_84.lib'
             for n in ['system', 'filesystem', 'thread', 'timer', 'date_time',
                       'chrono', 'regex', 'serialization', 'atomic',
                       'program_options', 'locale', 'log', 'log_setup']]
for archive in archives:
    if not archive.is_file():
        raise RuntimeError(f'Required prepared archive missing: {archive}')

# Upstream clang-cl objects retain Boost's compiler-specific autolink names.
# Both names refer to the exact same verified MSVC-ABI static archive.
for archive in archives:
    if '-vc143-' in archive.name:
        alias = archive.with_name(archive.name.replace('-vc143-', '-clangw19-'))
        if not alias.exists():
            alias.symlink_to(archive.name)

def import_library(dll):
    report = run(['x86_64-w64-mingw32-objdump', '-p', dll], True).stdout
    table = report.split('[Ordinal/Name Pointer] Table')[1].split('The Function Table')[0]
    exports = [name for name in re.findall(r'^\s*\[\s*\d+\].*\s(\S+)\s*$', table, re.M)
               if name.startswith(('altbase_', 'secp256k1_'))]
    if not exports:
        raise RuntimeError(f'No exports found: {dll.name}')
    definition = out / (dll.stem + '.def')
    definition.write_text('LIBRARY ' + dll.name + '\nEXPORTS\n' +
                          '\n'.join('  ' + x for x in exports) + '\n')
    library = out / (dll.stem + '-import.lib')
    run(['llvm-dlltool-19', '-m', 'i386:x86-64', '-d', definition, '-l', library])
    return library

core = compile_file(src/'zano_core_module.cpp', 'zano-core', ['ALTBASE_ZANO_CORE_EXPORTS'])
run(['lld-link-19', '/dll', f'/out:{out}/altbase_zano_core.dll',
     core, *archives, *linkflags, *systemlibs])
defs = ['ALTBASE_ZANO_WALLET_EXPORTS', 'ALTBASE_ZANO_WALLET_ONLY=1']
objects = [compile_file(src/name, name.removesuffix('.cpp'), defs) for name in
           ['coin_wallet_module.cpp', 'privacy_light_wallet_impl.cpp',
            'protocol.cpp', 'native_http.cpp']]
secret_object = previous/'epic-wallet-secret.obj'
if not secret_object.is_file():
    raise RuntimeError('Existing storage object is required; source is never compiled')
objects.append(secret_object)
runtime = root/'release/win-unpacked/resources/native-core'
imports = [import_library(out/'altbase_zano_core.dll'),
           import_library(runtime/'altbase_net_core.dll'),
           import_library(runtime/'libsecp256k1-6.dll')]
run(['lld-link-19', '/dll', f'/out:{out}/altbase_zano_wallet.dll',
     *objects, *imports, *linkflags, *systemlibs])
fixture = compile_file(root/'tests/zanoHf6Decode.cpp', 'zano-hf6-decode')
run(['lld-link-19', f'/out:{out}/zano-hf6-decode.exe', '/subsystem:console',
     fixture, *archives, *linkflags, *systemlibs])
readiness = compile_file(root/'tests/zanoNativeReadiness.cpp', 'zano-readiness')
run(['lld-link-19', f'/out:{out}/zano-readiness.exe', '/subsystem:console',
     readiness, *linkflags, *systemlibs])
manifest = {'buildHost': 'Linux', 'cpuAffinity': [cpu],
            'compiledSources': sorted(allowed), 'storageObjectReused': True,
            'fixtureAssertionsEnabled': True,
            'files': [{'name': f.name, 'bytes': f.stat().st_size,
                       'sha256': hashlib.sha256(f.read_bytes()).hexdigest()}
                      for f in sorted(out.iterdir()) if f.suffix in ('.dll', '.exe')]}
(out/'build-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(json.dumps(manifest))
