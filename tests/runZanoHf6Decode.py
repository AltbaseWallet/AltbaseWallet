#!/usr/bin/env python3
"""Compare existing pre-HF6 objects with the upgraded codec using public blobs."""
from pathlib import Path
import argparse, os, shlex, subprocess, json, datetime
p=argparse.ArgumentParser();p.add_argument('--cache',type=Path,required=True);a=p.parse_args()
root=Path(__file__).resolve().parents[1];r=a.cache;old=root/'native/vendor/zano_native_lib/Zano';previous=root/'native/core/build/linux-x64-release'
os.sched_setaffinity(0,{min(os.sched_getaffinity(0))});os.nice(10)
for label,source,build in [('old',old,old/'build/altbase-linux-x64'),('hf6',r/'upstream',r/'build')]:
 includes=[source/'src',source/'contrib',source/'contrib/epee/include',source/'contrib/eos_portable_archive',source/'contrib/jwt-cpp/include',build/'version',build/'contrib/zlib']
 obj=str(r/f'decode-{label}.o')
 args=['g++-13','-std=c++20','-DDISABLE_PFR_SERIALIZATION_SELFCHECK','-DDISABLE_TOR','-DMOBILE_WALLET_BUILD=1','-DUSE_OPEN_SSL_FOR_ECDSA',*[f'-I{x}' for x in includes],'-c',str(root/'tests/zanoHf6Decode.cpp'),'-o',obj]
 with (r/f'logs/decode-build-{label}.log').open('w') as log:
  subprocess.run(args,stdout=log,stderr=subprocess.STDOUT,check=True)
  if label=='old':
   link=shlex.split((previous/'CMakeFiles/altbase_zano_core.dir/link.txt').read_text());link[0]='g++-13'
   link=[x for x in link if x!='-shared' and not x.startswith(('-Wl,--dependency-file=','-Wl,-soname,','-Wl,-rpath,'))]
   link=[obj if x.endswith('/zano_core_module.cpp.o') else x for x in link];link[link.index('-o')+1]=str(r/'decode-old')
  else:link=['g++-13',obj,f'-L{r}','-laltbase_zano_core','-lboost_serialization',f'-Wl,-rpath,{r}','-o',str(r/'decode-hf6')]
  # Host Boost requires the host C++ runtime; GCC 13 is retained for old LTO objects.
  link.append('/usr/lib/x86_64-linux-gnu/libstdc++.so.6')
  subprocess.run(link,cwd=previous,stdout=log,stderr=subprocess.STDOUT,check=True)
fixtures=json.loads((root/'tests/fixtures/zano-hf6-public.json').read_text())['transactions']
results=[]
for i,fixture in enumerate(fixtures):
 blob=fixture['hex']
 row={'fixture':i,'bytes':len(blob)//2}
 for label in ('old','hf6'):
  p=subprocess.run([str(r/f'decode-{label}')],input=blob,text=True,capture_output=True,check=True)
  row[label]=json.loads(p.stdout.strip().splitlines()[-1])
 assert not row['old']['parsed'] and row['hf6']['parsed'],row
 assert row['hf6']['txid']==fixture['txid'],row
 results.append(row)
out=root/'artifacts/privacy-followup-20260908';(out/'public-hf6-txs.json').write_text(json.dumps({'source':'https://node.zano.org/gettransactions','transactions':[f['hex'] for f in fixtures]},indent=2))
(out/'hf6-decode-fixtures.json').write_text(json.dumps({'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'cpuAffinity':list(os.sched_getaffinity(0)),'results':results},indent=2))
print(json.dumps(results))
