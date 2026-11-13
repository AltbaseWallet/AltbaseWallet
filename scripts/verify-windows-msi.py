"""Reject MSI metadata/UI defects that Wine's installer does not enforce."""
from pathlib import Path
import json
import hashlib
import struct
import subprocess
import sys
import gi

gi.require_version('Libmsi', '1.0')
from gi.repository import Libmsi


def verify(filename, application=None):
    filename = str(Path(filename).resolve())
    summary = subprocess.check_output(['msiinfo', 'extract', filename, '\x05SummaryInformation'])
    section = struct.unpack_from('<I', summary, 44)[0]
    count = struct.unpack_from('<I', summary, section + 4)[0]
    offsets = dict(struct.unpack_from('<II', summary, section + 8 + i * 8) for i in range(count))
    position = section + offsets[1]
    codepage = struct.unpack_from('<H', summary, position + 4)[0]
    if struct.unpack_from('<I', summary, position)[0] != 2 or codepage != 1252:
        raise ValueError('SummaryInformation must use Windows-1252; UTF-8 causes native Windows error 1620')
    database = Libmsi.Database.new(filename, Libmsi.DbFlags.READONLY, None)

    def rows(sql, width):
        query = Libmsi.Query.new(database, sql)
        query.execute(None)
        result = []
        while (record := query.fetch()) is not None:
            result.append([record.get_string(i) for i in range(1, width + 1)])
        query.close()
        return result

    controls = {}
    for dialog, name, kind, next_name in rows('SELECT `Dialog_`, `Control`, `Type`, `Control_Next` FROM `Control`', 4):
        controls.setdefault(dialog, {})[name] = (kind, next_name)
    dialogs = rows('SELECT `Dialog`, `Control_First`, `Control_Default`, `Control_Cancel` FROM `Dialog`', 4)
    for dialog, first, default, cancel in dialogs:
        children = controls[dialog]
        if first not in children or children[first][0] != 'PushButton':
            raise ValueError(f'{dialog}: initial focus must target an interactive button')
        for target in [default, cancel]:
            if target and (target not in children or children[target][0] != 'PushButton'):
                raise ValueError(f'{dialog}: default/cancel control is not an interactive button')
        visited = set()
        current = first
        while current not in visited:
            if current not in children:
                raise ValueError(f'{dialog}: broken tab order (native Windows error 2834)')
            visited.add(current)
            current = children[current][1]
        linked = {name for name, (_, next_name) in children.items() if next_name}
        if current != first or visited != linked:
            raise ValueError(f'{dialog}: tab order is not a single closed cycle (native Windows error 2834)')
        if not {name for name, (kind, _) in children.items() if kind == 'PushButton'} <= visited:
            raise ValueError(f'{dialog}: a button cannot be reached with Tab')
    checked_versions = 0
    if application:
        helper = Path(__file__).with_name('windows-msi-file-versions.cjs')
        versions = json.loads(subprocess.check_output(['node', str(helper), str(Path(application).resolve())], text=True))
        installed = {name: (version, language) for name, version, language in rows('SELECT `File`, `Version`, `Language` FROM `File`', 3)}
        for relative, metadata in versions.items():
            file_id = 'f' + hashlib.sha256(relative.encode()).hexdigest()[:24]
            if installed.get(file_id) != (metadata['version'], metadata['language']):
                raise ValueError(f'{relative}: MSI file version/language differs from the compiled PE; upgrade may omit the file')
            checked_versions += 1
    return {'passed': True, 'summaryCodepage': codepage, 'dialogCount': len(dialogs), 'closedTabCycles': True, 'versionedFilesChecked': checked_versions}



if __name__ == '__main__':
    try:
        print(json.dumps(verify(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)))
    except Exception as error:
        sys.exit(str(error))
