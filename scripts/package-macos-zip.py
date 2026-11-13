"""Validate and archive the complete universal macOS application on Linux."""
from pathlib import Path
import datetime,hashlib,importlib.util,json,os,plistlib,re,stat,struct,zipfile
ROOT=Path(__file__).resolve().parent.parent

def package_application():
    app=ROOT/'artifacts/mac-universal/Altbase Wallet.app';version=json.loads((ROOT/'package.json').read_text())['version'];archive=ROOT/'artifacts'/f'Altbase-Wallet-macOS-universal-v{version}.zip'
    spec=importlib.util.spec_from_file_location('macsig',ROOT/'scripts/verify-macos-signature.py');signature=importlib.util.module_from_spec(spec);spec.loader.exec_module(signature)
    info=plistlib.loads((app/'Contents/Info.plist').read_bytes());assert info['CFBundleShortVersionString']==version and info['CFBundleIdentifier']=='com.altbase.wallet'
    runtime=json.loads((app/'Contents/Resources/coin-plugins/_core/runtime-package.json').read_text());assert runtime['target']=='darwin-universal' and set(runtime['targets'])=={'darwin-x64','darwin-arm64'}
    records=[];machos=[]
    def visit(directory):
        for entry in sorted(os.scandir(directory),key=lambda e:e.name):
            if re.search(r'wallet[ _-]?secret',entry.name,re.I):raise RuntimeError('Protected source path in package')
            path=Path(entry.path);relative=path.relative_to(app.parent).as_posix()
            if entry.is_symlink():
                link=os.readlink(path);assert not Path(link).is_absolute() and (path.parent/link).resolve().is_relative_to(app.resolve());records.append({'path':relative,'kind':'symlink','mode':0o120777,'target':link});continue
            if entry.is_dir(follow_symlinks=False):records.append({'path':relative+'/','kind':'directory','mode':0o40755});visit(path);continue
            if not entry.is_file(follow_symlinks=False):raise RuntimeError('Unsupported application resource')
            with path.open('rb') as source:magic=source.read(4)
            if magic==b'\x7fELF' or magic[:2]==b'MZ':raise RuntimeError('Foreign executable in macOS application: '+relative)
            if magic in (b'\xcf\xfa\xed\xfe',b'\xca\xfe\xba\xbe',b'\xca\xfe\xba\xbf'):
                result=signature.verify_macho(path);cpus={r['cpu'] for r in result['slices']}
                if '/darwin-x64/' in relative:assert cpus=={0x1000007}
                elif '/darwin-arm64/' in relative:assert cpus=={0x100000c}
                else:assert cpus=={0x1000007,0x100000c}, 'Non-universal executable: '+relative
                machos.append({'path':relative,'slices':result['slices']})
            with path.open('rb') as source:digest=hashlib.file_digest(source,'sha256').hexdigest()
            records.append({'path':relative,'kind':'file','mode':stat.S_IFREG|(path.stat().st_mode&0o777),'size':path.stat().st_size,'sha256':digest})
    records.append({'path':app.name+'/','kind':'directory','mode':0o40755});visit(app)
    temporary=archive.with_suffix('.zip.new')
    try:
        with zipfile.ZipFile(temporary,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as package:
            for row in records:
                info=zipfile.ZipInfo(row['path'],(1980,1,1,0,0,0));info.create_system=3;info.external_attr=row['mode']<<16
                info.compress_type=zipfile.ZIP_DEFLATED if row['kind']=='file' else zipfile.ZIP_STORED;info._compresslevel=6
                if row['kind']=='directory':package.writestr(info,b'');continue
                if row['kind']=='symlink':package.writestr(info,row['target'].encode());continue
                with (app.parent/row['path']).open('rb') as source,package.open(info,'w') as output:
                    for data in iter(lambda:source.read(1024*1024),b''):output.write(data)
        with zipfile.ZipFile(temporary) as package:
            assert package.testzip() is None and len(package.infolist())==len(records)
            for row in records:
                if row['kind']=='file':
                    with package.open(row['path']) as source:assert hashlib.file_digest(source,'sha256').hexdigest()==row['sha256']
        os.replace(temporary,archive)
    finally:temporary.unlink(missing_ok=True)
    with archive.open('rb') as source:digest=hashlib.file_digest(source,'sha256').hexdigest()
    result={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'passed':True,'version':version,'universal':True,'minimumSystemVersion':plistlib.loads((app/'Contents/Info.plist').read_bytes()).get('LSMinimumSystemVersion'),'machOFiles':len(machos),'filesCompared':sum(r['kind']=='file' for r in records),'archive':archive.name,'size':archive.stat().st_size,'sha256':digest,'nativeMacosExecution':False,'appleNotarization':False,'protectedSourceIncluded':False,'entries':records,'machos':machos}
    proof=ROOT/'local-checks/release-corrections-2026-11-13/macos-package-verification.json';proof.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({k:v for k,v in result.items() if k not in ['entries','machos']}))
if __name__=='__main__':package_application()
