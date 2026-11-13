#!/usr/bin/env python3
"""Select only released Windows runtime resources from a local Altbase MSI."""
import csv
import ctypes as c
import ctypes.util
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
source = Path(sys.argv[1]).resolve()
if source.suffix.lower() != '.msi':
    raise SystemExit('Expected a local released MSI')
work = ROOT / 'local-checks/windows-staging'
work.mkdir(parents=True, exist_ok=True)

def table(name):
    output = subprocess.check_output(['msiinfo', 'export', str(source), name], text=True)
    rows = list(csv.reader(io.StringIO(output), delimiter='\t'))
    return [dict(zip(rows[0], row)) for row in rows[3:] if row]

directories = {row['Directory']: row for row in table('Directory')}
components = {row['Component']: row for row in table('Component')}

def directory(key):
    if key == 'INSTALLFOLDER':
        return PurePosixPath()
    row = directories[key]
    name = row['DefaultDir'].split('|')[-1].split(':')[0]
    return directory(row['Directory_Parent']) / name

selected = {}
for row in table('File'):
    relative = directory(components[row['Component_']]['Directory_']) / row['FileName'].split('|')[-1]
    name = str(relative)
    if re.search(r'wallet[ _-]?secret', name, re.I) or '..' in relative.parts:
        continue
    if name.startswith('resources/native-core/') and relative.suffix.lower() in ('.dll', '.exe'):
        destination = ROOT / 'native-core-stage/win32-x64' / relative.name
    elif name.startswith('resources/coin-runtimes/win32-x64/'):
        destination = ROOT / 'coin-runtimes-stage' / PurePosixPath(*relative.parts[2:])
    elif name == 'resources/coin-runtimes/manifest.json':
        destination = work / 'released-runtime-manifest.json'
    else:
        continue
    selected[row['File']] = (destination, int(row['FileSize']))
if not selected:
    raise SystemExit('MSI has no compatible runtime resources')

cabinet = work / 'runtime.cab'
with cabinet.open('wb') as stream:
    subprocess.run(['msiinfo', 'extract', str(source), 'ALTBASE'], stdout=stream, check=True)

lib = c.CDLL(ctypes.util.find_library('archive'))
def function(name, result, *args):
    method = getattr(lib, name); method.restype = result; method.argtypes = list(args)
    return method
new = function('archive_read_new', c.c_void_p)
support = function('archive_read_support_format_all', c.c_int, c.c_void_p)
open_file = function('archive_read_open_filename', c.c_int, c.c_void_p, c.c_char_p, c.c_size_t)
next_header = function('archive_read_next_header', c.c_int, c.c_void_p, c.POINTER(c.c_void_p))
pathname = function('archive_entry_pathname', c.c_char_p, c.c_void_p)
read = function('archive_read_data', c.c_ssize_t, c.c_void_p, c.c_void_p, c.c_size_t)
skip = function('archive_read_data_skip', c.c_int, c.c_void_p)
free = function('archive_read_free', c.c_int, c.c_void_p)
archive = new(); support(archive)
if open_file(archive, bytes(cabinet), 1024 * 1024) != 0:
    raise SystemExit('Could not open the release cabinet')
entry = c.c_void_p(); buffer = c.create_string_buffer(1024 * 1024); extracted = []
try:
    while True:
        result = next_header(archive, c.byref(entry))
        if result == 1:
            break
        if result != 0:
            raise RuntimeError('Could not read cabinet metadata')
        key = pathname(entry).decode('utf8')
        if key not in selected:
            if skip(archive) != 0: raise RuntimeError('Could not skip cabinet entry')
            continue
        destination, expected_size = selected.pop(key)
        destination.parent.mkdir(parents=True, exist_ok=True)
        digest = hashlib.sha256(); size = 0
        with destination.open('wb') as stream:
            while True:
                count = read(archive, buffer, len(buffer))
                if count < 0: raise RuntimeError('Cabinet data error')
                if count == 0: break
                data = buffer.raw[:count]; stream.write(data); digest.update(data); size += count
        if size != expected_size: raise RuntimeError('Runtime size mismatch')
        extracted.append({'path': str(destination.relative_to(ROOT)), 'size': size, 'sha256': digest.hexdigest()})
finally:
    free(archive)
if selected:
    raise RuntimeError('Cabinet was missing selected runtime files')
released = json.loads((work / 'released-runtime-manifest.json').read_text())
manifest_file = ROOT / 'coin-runtimes-stage/manifest.json'
current = json.loads(manifest_file.read_text()) if manifest_file.exists() else []
windows = [row for row in released if row['platform'] == 'win32-x64']
if {row['coin'] for row in windows} != {'xelis', 'mwc'}:
    raise RuntimeError('Windows runtime manifest is incomplete')
for row in windows:
    file = ROOT / 'coin-runtimes-stage' / row['path']
    with file.open('rb') as stream: digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    if digest != row['sha256'] or file.stat().st_size != row['size']:
        raise RuntimeError('Released runtime checksum mismatch')
manifest_file.write_text(json.dumps([row for row in current if row['platform'] != 'win32-x64'] + windows, indent=2) + '\n')
with source.open('rb') as stream: source_hash = hashlib.file_digest(stream, 'sha256').hexdigest()
report = {'source': source.name, 'sourceSha256': source_hash, 'target': 'win32-x64',
          'sourceProjectModified': False, 'selectedRuntimeFiles': extracted}
(ROOT / 'docs/windows-runtime-source.json').write_text(json.dumps(report, indent=2) + '\n')
cabinet.unlink()
print(json.dumps({'stagedRuntimeFiles': len(extracted), 'target': 'win32-x64', 'sourceSha256': source_hash}))
