"""Build pinned OpenSSL LTS for Darwin on Linux, using exactly one CPU."""
from pathlib import Path
import argparse,datetime,hashlib,json,os,subprocess,tarfile
VERSION='3.5.9'
SHA256='603f5602e2eef00d77fbd429d34dcd5822bb301757a1bc9cdb24c670f1eb859a'
ROOT=Path(__file__).resolve().parent.parent

def build(archive,architectures):
    if __import__('sys').platform!='linux':raise RuntimeError('Build on Linux only')
    with archive.open('rb') as stream:
        if hashlib.file_digest(stream,'sha256').hexdigest()!=SHA256:raise RuntimeError('Official OpenSSL source checksum mismatch')
    cache=Path.home()/'.cache/altbase-build/macos-deps'
    source=cache/'sources'/('openssl-'+VERSION)
    if not (source/'Configure').exists():
        source.parent.mkdir(exist_ok=True,parents=True)
        with tarfile.open(archive) as package:
            for member in package.getmembers():
                relative=Path(member.name)
                if relative.is_absolute() or '..' in relative.parts:raise RuntimeError('Invalid source archive path')
            package.extractall(source.parent,filter='data')
    receipts=[]
    for arch in architectures:
        target='darwin-'+arch
        command=['node','-e',"console.log(JSON.stringify(require('./scripts/macos-toolchain.cjs').macosToolchain(process.argv[1])))",target]
        tool=json.loads(subprocess.check_output(command,cwd=ROOT,text=True))
        output=Path(tool['openssl']);directory=cache/'build'/('openssl-'+VERSION+'-'+arch);directory.mkdir(parents=True,exist_ok=True)
        bindir=Path(tool['compiler']).parent;prefix=next(p.name[:-2] for p in bindir.iterdir() if p.name.startswith(('arm64' if arch=='arm64' else 'x86_64')+'-apple-darwin') and p.name.endswith('-ar'))
        environment={**os.environ,**tool['environment'],'CC':tool['compiler'].replace('clang++','clang'),'AR':str(bindir/(prefix+'ar')),'RANLIB':str(bindir/(prefix+'ranlib')),'MAKEFLAGS':'-j1','UV_THREADPOOL_SIZE':'1','RAYON_NUM_THREADS':'1'}
        arguments=[['perl',str(source/'Configure'),'darwin64-arm64-cc' if arch=='arm64' else 'darwin64-x86_64-cc','no-shared','no-tests','no-module','no-dso','--prefix='+str(output),'--libdir=lib','-mmacosx-version-min=12.0'],['make','-j1','build_libs'],['make','-j1','install_dev']]
        log=ROOT/'local-checks/release-corrections-2026-11-13'/('openssl-'+arch+'.log');log.parent.mkdir(exist_ok=True,parents=True)
        with log.open('w') as stream:
            for arguments in arguments:
                result=subprocess.run(['taskset','-c','0',*arguments],cwd=directory,env=environment,stdout=stream,stderr=subprocess.STDOUT)
                if result.returncode:raise RuntimeError('OpenSSL '+arch+' failed; inspect '+str(log))
        library=output/'lib/libcrypto.a'
        if not library.exists():raise RuntimeError('Expected static OpenSSL library was not installed')
        with library.open('rb') as stream:digest=hashlib.file_digest(stream,'sha256').hexdigest()
        receipts.append({'target':target,'version':VERSION,'library':str(library),'sha256':digest,'sourceSha256':SHA256,'compiledOn':'linux','cpu':0})
        print(json.dumps(receipts[-1]),flush=True)
    return receipts

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--source',type=Path,default=Path.home()/'.cache/altbase-build/macos-deps/downloads'/('openssl-'+VERSION+'.tar.gz'));parser.add_argument('--arch',choices=['x64','arm64','all'],default='all');args=parser.parse_args()
    rows=build(args.source,['x64','arm64'] if args.arch=='all' else [args.arch])
    receipt=ROOT/'local-checks/release-corrections-2026-11-13/openssl-builds.json';receipt.write_text(json.dumps({'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'passed':True,'sourceUrl':'https://github.com/openssl/openssl/releases/download/openssl-3.5.9/openssl-3.5.9.tar.gz','builds':rows},indent=2)+'\n')
