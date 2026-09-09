"""Run with the path to a built libaltbase_net_core.so; uses loopback only."""
import base64,ctypes,gzip,http.server,json,sys,threading
connections=0
class Server(http.server.ThreadingHTTPServer):
 daemon_threads=True
 def get_request(self):
  global connections
  sock,addr=super().get_request();connections+=1;return sock,addr
class Handler(http.server.BaseHTTPRequestHandler):
 protocol_version='HTTP/1.1'
 def log_message(self,*args):pass
 def do_GET(self):self.respond()
 def do_POST(self):self.respond()
 def respond(self):
  body=self.rfile.read(int(self.headers.get('content-length',0))).decode()
  payload=json.dumps({'method':self.command,'body':body,'contentType':self.headers.get('content-type'),'encoding':self.headers.get('accept-encoding','')}).encode()
  compressed='gzip' in self.headers.get('accept-encoding','')
  if compressed:payload=gzip.compress(payload)
  self.send_response(200);self.send_header('Content-Length',len(payload))
  if compressed:self.send_header('Content-Encoding','gzip')
  self.end_headers();self.wfile.write(payload)
server=Server(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
lib=ctypes.CDLL(sys.argv[1]);lib.altbase_net_request.argtypes=[ctypes.c_char_p];lib.altbase_net_request.restype=ctypes.c_void_p
lib.altbase_net_free.argtypes=[ctypes.c_void_p]
def call(method,body=''):
 data={'method':method,'url':f'http://127.0.0.1:{server.server_port}/read','bodyB64':base64.b64encode(body.encode()).decode(),'timeoutMs':2000,'contentType':'application/json'}
 ptr=lib.altbase_net_request(json.dumps(data).encode())
 try:r=json.loads(ctypes.string_at(ptr))
 finally:lib.altbase_net_free(ptr)
 assert r.get('status')==200,r
 return json.loads(base64.b64decode(r['bodyB64']))
a=call('POST','public test payload');b=call('GET')
assert a['body']=='public test payload'
assert b['method']=='GET' and b['body']=='' and b['contentType'] is None
print(json.dumps({'connections':connections,'compressed':bool(b['encoding']),'postToGetIsolation':True}))
assert connections==1
assert 'gzip' in b['encoding']
server.shutdown()
