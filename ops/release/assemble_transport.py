"""Reassemble already compiled release files; never check out wallet source."""
import hashlib,http.client,json,os,re,urllib.request,urllib.parse
from pathlib import Path

REPO='AltbaseWallet/AltbaseWallet'
RELEASE=int(os.environ['RELEASE_ID'])
TOKEN=os.environ['GH_TOKEN']
HEADERS={'Authorization':'Bearer '+TOKEN,'User-Agent':'Altbase-Release-Assembly','Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}
BASE='https://api.github.com/repos/'+REPO

def api(route,method='GET'):
    with urllib.request.urlopen(urllib.request.Request(BASE+route,headers=HEADERS,method=method),timeout=90) as response:
        body=response.read();return json.loads(body) if body else {}

class Redirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,request,fp,code,message,headers,url):
        host=urllib.parse.urlsplit(url).hostname
        if not url.startswith('https://') or host not in ['api.github.com','release-assets.githubusercontent.com','objects.githubusercontent.com']:
            raise RuntimeError('Unexpected artifact download origin')
        result=super().redirect_request(request,fp,code,message,headers,url)
        if host!='api.github.com':result.remove_header('Authorization')
        return result

opener=urllib.request.build_opener(Redirect())
def stream_asset(asset):
    headers={**HEADERS,'Accept':'application/octet-stream'}
    return opener.open(urllib.request.Request(BASE+'/releases/assets/'+str(asset['id']),headers=headers),timeout=120)

def upload(release,path):
    url=urllib.parse.urlsplit(release['upload_url'].split('{')[0]+'?'+urllib.parse.urlencode({'name':path.name}))
    assert url.hostname=='uploads.github.com'
    connection=http.client.HTTPSConnection(url.hostname,timeout=240)
    connection.putrequest('POST',url.path+'?'+url.query)
    for name,value in {**HEADERS,'Content-Type':'application/octet-stream','Content-Length':str(path.stat().st_size)}.items():connection.putheader(name,value)
    connection.endheaders()
    with path.open('rb') as source:
        for chunk in iter(lambda:source.read(1024*1024),b''):connection.send(chunk)
    response=connection.getresponse();body=response.read();connection.close()
    if response.status!=201:raise RuntimeError('Assembly upload HTTP '+str(response.status))
    result=json.loads(body)
    with path.open('rb') as source:digest=hashlib.file_digest(source,'sha256').hexdigest()
    assert result.get('digest')=='sha256:'+digest
    return result

def main():
    release=api('/releases/'+str(RELEASE));assert release['draft']
    assets={a['name']:a for a in release['assets']}
    with stream_asset(assets['transport-manifest.json']) as response:manifest=json.load(response)
    assert manifest['repository']==REPO and manifest['releaseId']==RELEASE
    directory=Path(os.environ['RUNNER_TEMP'])/'altbase-assembled';directory.mkdir(exist_ok=True)
    results=[]
    for row in manifest['files']:
        name=row['name'];assert re.fullmatch(r'[A-Za-z0-9._-]+',name) and 'wallet_secret' not in name.lower()
        assert re.fullmatch(r'[a-f0-9]{64}',row['sha256'])
        existing=assets.get(name)
        if existing and existing.get('digest')=='sha256:'+row['sha256'] and existing['size']==row['size']:
            results.append({'name':name,'sha256':row['sha256'],'size':row['size']});continue
        if existing:
            assert existing['state']=='starter' and existing['size']==0
            api('/releases/assets/'+str(existing['id']),'DELETE')
        target=directory/name;digest=hashlib.sha256();size=0
        with target.open('wb') as out:
            for part in row['parts']:
                assert re.fullmatch(r'[A-Za-z0-9._-]+',part)
                with stream_asset(assets[part]) as source:
                    for chunk in iter(lambda:source.read(1024*1024),b''):
                        out.write(chunk);digest.update(chunk);size+=len(chunk)
        assert size==row['size'] and digest.hexdigest()==row['sha256'], 'Original artifact checksum mismatch'
        uploaded=upload(release,target);assert uploaded['size']==size
        target.unlink();results.append({'name':name,'sha256':row['sha256'],'size':size})
        print(json.dumps({'verifiedOriginalArtifact':name,'sha256':row['sha256']}),flush=True)
    receipt=directory/'ASSEMBLY-RECEIPT-v0.1.13.json'
    receipt.write_text(json.dumps({'passed':True,'compilation':False,'sourceCheckout':False,'oneCpu':True,'releaseId':RELEASE,'files':results},indent=2)+'\n')
    upload(release,receipt)
    for asset in release['assets']:
        if asset['name']=='transport-manifest.json' or '.transport-' in asset['name']:api('/releases/assets/'+str(asset['id']),'DELETE')

if __name__=='__main__':main()
