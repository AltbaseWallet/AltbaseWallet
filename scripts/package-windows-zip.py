"""Distribute the Windows installer in a ZIP, verifying its exact payload."""
from pathlib import Path
import argparse, hashlib, json, os, zipfile, shutil

def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

def package_installer(directory, version, verify_only=False):
    installer = directory / f'Altbase-Wallet-Windows-x64-v{version}.msi'
    archive = directory / f'Altbase-Wallet-Windows-v{version}.zip'
    if not installer.is_file():
        raise RuntimeError('Build the Windows MSI before creating the release ZIP')
    temporary = archive.with_suffix('.zip.new')
    if not verify_only:
        try:
            with zipfile.ZipFile(temporary, 'w', zipfile.ZIP_STORED) as output:
                info = zipfile.ZipInfo(installer.name, (1980, 1, 1, 0, 0, 0))
                info.create_system = 3
                info.external_attr = 0o100644 << 16
                info.compress_type = zipfile.ZIP_STORED
                with installer.open('rb') as source, output.open(info, 'w') as target:
                    shutil.copyfileobj(source, target, length=1024 * 1024)
            verify_archive(temporary, installer)
            os.replace(temporary, archive)
        finally:
            temporary.unlink(missing_ok=True)
    verify_archive(archive, installer)
    return {'passed': True, 'zipContainsMsi': True, 'entries': [installer.name],
            'embeddedMsiSha256': digest(installer), 'zipSha256': digest(archive),
            'zipBytes': archive.stat().st_size}

def verify_archive(archive, installer):
    with zipfile.ZipFile(archive) as package:
        if package.namelist() != [installer.name] or package.testzip() is not None:
            raise RuntimeError('The release ZIP must contain exactly the verified MSI')
        with package.open(installer.name) as stream:
            embedded = hashlib.file_digest(stream, 'sha256').hexdigest()
    if embedded != digest(installer):
        raise RuntimeError('Embedded MSI differs from the verified installer')

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--verify', action='store_true')
    options = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    version = json.loads((root / 'package.json').read_text())['version']
    directory = Path(os.environ.get('ALTBASE_WINDOWS_INSTALLER_DIRECTORY', root / 'artifacts'))
    print(json.dumps(package_installer(directory, version, options.verify)))
