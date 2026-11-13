"""Verify Mach-O CodeDirectory page hashes, including certificate-free ad-hoc code."""
import argparse,hashlib,json,re,struct
from pathlib import Path

def verify_macho(filename):
    filename=Path(filename)
    if re.search(r'wallet[ _-]?secret',filename.name,re.I):raise ValueError('Protected source path')
    data=filename.read_bytes()
    def u32(at):return struct.unpack_from('>I',data,at)[0]
    if data[:4]==b'\xcf\xfa\xed\xfe':slices=[(0,len(data))]
    elif data[:4] in (b'\xca\xfe\xba\xbe',b'\xca\xfe\xba\xbf'):
        wide=data[:4]==b'\xca\xfe\xba\xbf';count=u32(4)
        if not 1<=count<=8:raise ValueError('Invalid universal header')
        slices=[]
        for i in range(count):
            at=8+i*(32 if wide else 20)
            offset,size=struct.unpack_from('>QQ' if wide else '>II',data,at+8)
            if offset<8+count*(32 if wide else 20) or size<32 or offset+size>len(data):raise ValueError('Invalid universal slice')
            slices.append((offset,size))
    else:raise ValueError('Not a 64-bit Mach-O')
    result=[]
    for base,size in slices:
        if data[base:base+4]!=b'\xcf\xfa\xed\xfe':raise ValueError('Invalid Mach-O slice')
        cpu=struct.unpack_from('<I',data,base+4)[0];commands=struct.unpack_from('<I',data,base+16)[0];at=base+32;signature=None
        if commands>10000:raise ValueError('Invalid Mach-O command count')
        for _ in range(commands):
            command,length=struct.unpack_from('<II',data,at)
            if length<8 or at+length>base+size:raise ValueError('Invalid Mach-O load command')
            if command==0x1d:signature=struct.unpack_from('<II',data,at+8)
            at+=length
        if not signature:raise ValueError('Missing code signature')
        offset,length=signature;blob=base+offset
        if offset+length>size or u32(blob)!=0xfade0cc0:raise ValueError('Invalid signature container')
        total=u32(blob+4);count=u32(blob+8)
        if total>length or count>64 or 12+count*8>total:raise ValueError('Invalid signature indices')
        verified=0;pages=0;adhoc=False
        for i in range(count):
            kind,relative=struct.unpack_from('>II',data,blob+12+i*8)
            if kind!=0 and not 0x1000<=kind<=0x1005:continue
            cd=blob+relative
            if relative+44>total or u32(cd)!=0xfade0c02:raise ValueError('Invalid CodeDirectory')
            cd_length=u32(cd+4)
            if relative+cd_length>total:raise ValueError('Truncated CodeDirectory')
            version=u32(cd+8);flags=u32(cd+12);hash_offset=u32(cd+16);slots=u32(cd+28);limit=u32(cd+32)
            hash_size,hash_type,_,page_power=struct.unpack_from('BBBB',data,cd+36)
            if version>=0x20300 and limit==0:limit=struct.unpack_from('>Q',data,cd+56)[0]
            if page_power>20 or limit<32 or limit>offset or limit>size:raise ValueError('Invalid code-page bounds')
            page=1<<page_power if page_power else max(limit,1)
            if slots!=(limit+page-1)//page or hash_offset+slots*hash_size>cd_length:raise ValueError('Invalid code-page table')
            algorithms={1:'sha1',2:'sha256',3:'sha256',4:'sha384'}
            if hash_type not in algorithms:raise ValueError('Unsupported code digest')
            for n in range(slots):
                actual=hashlib.new(algorithms[hash_type],data[base+n*page:base+min((n+1)*page,limit)]).digest()[:hash_size]
                expected=data[cd+hash_offset+n*hash_size:cd+hash_offset+(n+1)*hash_size]
                if not actual or actual!=expected:raise ValueError('Code-page hash mismatch')
            verified+=1;pages+=slots;adhoc=adhoc or bool(flags&2)
        if not verified:raise ValueError('Missing verified CodeDirectory')
        result.append({'cpu':cpu,'codeDirectories':verified,'codePages':pages,'adhoc':adhoc})
    return {'passed':True,'file':str(filename),'slices':result,'certificateRequired':False}

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('file');args=parser.parse_args()
    print(json.dumps(verify_macho(args.file)))
