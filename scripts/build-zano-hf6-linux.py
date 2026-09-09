#!/usr/bin/env python3
"""Relink the read adapter and Zano core against an explicitly prepared HF6 tree.
Only two named sources are compiled; other adapter objects are reused.
Build subprocesses share one CPU. No wallet profile or credential is read.
"""
import argparse
import json
import os
from pathlib import Path
import shlex
import subprocess

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--source', type=Path, required=True)
p.add_argument('--build', type=Path, required=True)
p.add_argument('--output', type=Path, required=True)
p.add_argument('--compiler', default='/usr/bin/g++-13')
a = p.parse_args()
root = Path(__file__).resolve().parents[1]
previous = root / 'native/core/build/linux-x64-release'
a.output.mkdir(parents=True, exist_ok=True)
cpu = min(os.sched_getaffinity(0))
os.sched_setaffinity(0, {cpu})
os.nice(10)
old_source = str(root / 'native/core/../vendor/zano_native_lib/Zano')
old_build = old_source + '/build/altbase-linux-x64'


def run(argv):
    # Existing compiled objects may be reused, but prohibited source is never compiled.
    if any(Path(x).name == 'wallet_secret.cpp' for x in argv):
        raise RuntimeError('Unexpected source in compile command')
    subprocess.run(argv, cwd=previous, check=True)


def recipe(target):
    path = previous / f'CMakeFiles/{target}.dir'
    flags = {line.split(' = ', 1)[0]: shlex.split(line.split(' = ', 1)[1])
             for line in (path / 'flags.make').read_text().splitlines() if ' = ' in line}
    link = shlex.split((path / 'link.txt').read_text())
    link[0] = a.compiler
    link = [x for x in link if not x.startswith('-Wl,--dependency-file=')]
    link = ['-Wl,-rpath,$ORIGIN' if x.startswith('-Wl,-rpath,') else x for x in link]
    link[link.index('-o') + 1] = str(a.output / f'lib{target}.so')
    return flags, link


flags, link = recipe('altbase_zano_core')
def replace_paths(s):
    return s.replace(old_build, str(a.build)).replace(old_source, str(a.source))

includes = [replace_paths(s) for s in flags['CXX_INCLUDES']]
obj = str(a.output / 'zano_core_module.cpp.o')
run([a.compiler, *flags['CXX_DEFINES'], *includes, *flags['CXX_FLAGS'],
     '-c', str(root / 'native/core/src/zano_core_module.cpp'), '-o', obj])
link = [obj if s.endswith('/zano_core_module.cpp.o') else replace_paths(s) for s in link]
# HF6's stacktrace support requires libbacktrace; reject unresolved symbols.
link += ['-lbacktrace', '-ldl', '/usr/lib/x86_64-linux-gnu/libstdc++.so.6', '-Wl,-z,defs']
run(link)

flags, link = recipe('altbase_zano_wallet')
obj = str(a.output / 'privacy_light_wallet_impl.cpp.o')
run([a.compiler, *flags['CXX_DEFINES'], *[replace_paths(x) for x in flags['CXX_INCLUDES']], *flags['CXX_FLAGS'],
     '-c', str(root / 'native/core/src/privacy_light_wallet_impl.cpp'), '-o', obj])
link = [obj if s.endswith('/privacy_light_wallet_impl.cpp.o') else replace_paths(s) for s in link]
link = [str(previous / s) if s == 'bin/libaltbase_net_core.so' else s for s in link]
link += ['-lbacktrace', '-ldl', '/usr/lib/x86_64-linux-gnu/libstdc++.so.6', '-Wl,-z,defs']
run(link)
print(json.dumps({'compiledSources': ['zano_core_module.cpp', 'privacy_light_wallet_impl.cpp'],
                  'cpuAffinity': [cpu], 'output': str(a.output)}))
