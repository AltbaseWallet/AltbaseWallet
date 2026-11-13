"""Promote verified binary data into the authorized wallet release; never compile."""
import hashlib,http.client,importlib.util,json,os,urllib.parse,urllib.request
from pathlib import Path
REPO='AltbaseWallet/AltbaseWallet';BASE='https://api.github.com/repos/'+REPO
TOKEN=os.environ['GH_TOKEN'];TRANSPORT=int(os.environ['TRANSPORT_RELEASE_ID'])
HEADERS={'Authorization':'Bearer '+TOKEN,'User-Agent':'Altbase-Verified-Packaging','Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}

def api(route,method='GET',data=None):
 body=json.dumps(data).encode() if data is not None else None
 with urllib.request.urlopen(urllib.request.Request(BASE+route,data=body,headers={**HEADERS,'Content-Type':'application/json'},method=method),timeout=90) as response:
  result=response.read();return json.loads(result) if result else {}

class Redirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,request,fp,code,message,headers,url):
  host=urllib.parse.urlsplit(url).hostname
  if not url.startswith('https://') or host not in ['api.github.com','release-assets.githubusercontent.com','objects.githubusercontent.com']:raise RuntimeError('Unexpected artifact origin')
  result=super().redirect_request(request,fp,code,message,headers,url)
  if host!='api.github.com':result.remove_header('Authorization')
  return result
opener=urllib.request.build_opener(Redirect())
def stream(asset):return opener.open(urllib.request.Request(BASE+'/releases/assets/'+str(asset['id']),headers={**HEADERS,'Accept':'application/octet-stream'}),timeout=120)
def sha(path):
 with path.open('rb') as source:return hashlib.file_digest(source,'sha256').hexdigest()
def upload(release,path,expected_old):
 current=api('/releases/'+str(release['id']));old=next((a for a in current['assets'] if a['name']==path.name),None);digest=sha(path)
 if old and old.get('digest')=='sha256:'+digest and old['size']==path.stat().st_size:return old
 if old:
  if old.get('digest')!=expected_old and not(old['state']=='starter' and old['size']==0):raise RuntimeError('Release changed unexpectedly: '+path.name)
  api('/releases/assets/'+str(old['id']),'DELETE')
 url=urllib.parse.urlsplit(release['upload_url'].split('{')[0]+'?'+urllib.parse.urlencode({'name':path.name}));assert url.hostname=='uploads.github.com'
 connection=http.client.HTTPSConnection(url.hostname,timeout=240);connection.putrequest('POST',url.path+'?'+url.query)
 for key,value in {**HEADERS,'Content-Type':'application/octet-stream','Content-Length':str(path.stat().st_size)}.items():connection.putheader(key,value)
 connection.endheaders()
 with path.open('rb') as source:
  for data in iter(lambda:source.read(1024*1024),b''):connection.send(data)
 response=connection.getresponse();data=response.read();connection.close();assert response.status==201,'Artifact upload failed'
 result=json.loads(data);assert result['digest']=='sha256:'+digest and result['size']==path.stat().st_size;return result

def main():
 transport=api('/releases/'+str(TRANSPORT));assert transport['draft'];assets={a['name']:a for a in transport['assets']}
 with stream(assets['transport-manifest.json']) as source:plan=json.load(source)
 assert plan['schemaVersion']==2 and plan['repository']==REPO and plan['releaseId']==TRANSPORT and plan['targetReleaseId']==443666223
 target=api('/releases/443666223');assert not target['draft'] and target['tag_name']=='v0.1.13'
 directory=Path(os.environ['RUNNER_TEMP'])/'altbase-release-repair';directory.mkdir(exist_ok=True)
 files=[]
 for row in plan['files']:
  assert row['name']=='Altbase-Wallet-macOS-universal-v0.1.13.zip'
  path=directory/row['name'];digest=hashlib.sha256();size=0
  with path.open('wb') as output:
   if plan.get('macSourceUrl'):
    url=urllib.parse.urlsplit(plan['macSourceUrl']);assert url.scheme=='https' and url.hostname=='altbase.io' and url.path.startswith('/downloads/altbase-transport-') and not url.username and not url.password and not url.query
    # This public binary relay never receives the repository token.
    with urllib.request.urlopen(urllib.request.Request(plan['macSourceUrl'],headers={'User-Agent':'Altbase-Verified-Packaging'}),timeout=240) as source:
     for data in iter(lambda:source.read(1024*1024),b''):output.write(data);digest.update(data);size+=len(data)
   else:
    for name in row['parts']:
     assert name.startswith(row['name']+'.transport-')
     with stream(assets[name]) as source:
      for data in iter(lambda:source.read(1024*1024),b''):output.write(data);digest.update(data);size+=len(data)
  assert size==row['size'] and digest.hexdigest()==row['sha256'];files.append(path)
 recipe=plan['derivedWindows'];assert recipe['msiName']=='Altbase-Wallet-Windows-x64-v0.1.13.msi' and recipe['zipName']=='Altbase-Wallet-Windows-v0.1.13.zip'
 msi=next(a for a in target['assets'] if a['name']==recipe['msiName']);assert msi.get('digest')=='sha256:'+recipe['msiSha256']
 installer=directory/recipe['msiName']
 with stream(msi) as source,installer.open('wb') as output:
  for data in iter(lambda:source.read(1024*1024),b''):output.write(data)
 assert sha(installer)==recipe['msiSha256']
 spec=importlib.util.spec_from_file_location('windows_installer_zip',Path(os.environ['RUNNER_TEMP'])/'package-windows-zip.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
 result=module.package_installer(directory,'0.1.13');assert result['zipSha256']==recipe['zipSha256'] and result['zipBytes']==recipe['zipSize'];files.append(directory/recipe['zipName'])
 allowed={'SHA256SUMS-v0.1.13.txt','RELEASE-NOTES-v0.1.13.txt','PACKAGING-RECEIPT-v0.1.13.json'}
 for row in plan['supplementalFiles']:
  assert row['name'] in allowed;path=directory/row['name'];path.write_text(row['contents']);assert sha(path)==row['sha256'];files.append(path)
 # Verify every complete file before replacing any public asset.
 results=[{'name':p.name,'sha256':sha(p),'size':p.stat().st_size} for p in files]
 for path in files:upload(target,path,plan['expectedOldAssets'].get(path.name))
 api('/releases/'+str(target['id']),'PATCH',{'body':plan['releaseBody'],'make_latest':'true'})
 for old in target['assets']:
  if old['name']=='ASSEMBLY-RECEIPT-v0.1.13.json':api('/releases/assets/'+str(old['id']),'DELETE')
 current=api('/releases/'+str(target['id']));assert not any(a['name'].startswith(('evm-','sol-','trx-')) for a in current['assets'])
 for row in results:
  match=next(a for a in current['assets'] if a['name']==row['name']);assert match['size']==row['size'] and match['digest']=='sha256:'+row['sha256']
 for asset in transport['assets']:api('/releases/assets/'+str(asset['id']),'DELETE')
 print(json.dumps({'passed':True,'targetReleaseId':target['id'],'files':results,'compiledOnGitHub':False,'sourceCheckout':False,'temporaryPartsRemoved':True}),flush=True)
if __name__=='__main__':main()
