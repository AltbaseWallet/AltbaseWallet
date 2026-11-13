from pathlib import Path
import hashlib, json, os, shutil, subprocess, sys, uuid
import xml.etree.ElementTree as ET

root = Path(__file__).resolve().parent.parent
package = json.loads((root / 'package.json').read_text())
app = Path(os.environ.get('ALTBASE_WINDOWS_APP_DIRECTORY', root / 'artifacts/win-unpacked')).resolve()
output = Path(os.environ.get('ALTBASE_WINDOWS_MSI_OUTPUT', root / 'artifacts' / f"Altbase-Wallet-Windows-x64-v{package['version']}.msi")).resolve()
work = root / 'local-checks/msi-2026-11-11'
work.mkdir(parents=True, exist_ok=True)
if any(not shutil.which(tool) for tool in ['wixl', 'msibuild', 'msiinfo']):
    raise SystemExit('Install wixl, msitools, python3-gi and gir1.2-libmsi-1.0 on the Linux build machine first.')

namespace = 'http://wixtoolset.org/schemas/v4/wxs'
ET.register_namespace('', namespace)
def add(parent, tag, **attributes):
    return ET.SubElement(parent, '{'+namespace+'}'+tag, {k: str(v) for k,v in attributes.items()})
def ident(prefix, name):
    return prefix + hashlib.sha256(name.encode()).hexdigest()[:24]

# English MSI metadata uses an ANSI code page; wallet translations are separate.
tree = ET.Element('{'+namespace+'}Wix')
product = add(tree, 'Product', Id=str(uuid.uuid4()).upper(), Name=package['productName'],
              Version=package['version'], Manufacturer='Altbase', Language='1033', Codepage='1252',
              UpgradeCode='6269A41C-B41D-598D-A2C1-ED9946CE1CA0')
add(product, 'Package', InstallerVersion='500', Compressed='yes', InstallScope='perUser',
    Description='Altbase Wallet for Windows x64')
add(product, 'MajorUpgrade', AllowSameVersionUpgrades='yes',
    DowngradeErrorMessage='A newer version of Altbase Wallet is already installed.')
add(product, 'Media', Id='1', Cabinet='application.cab', EmbedCab='yes')
add(product, 'Property', Id='MSIINSTALLPERUSER', Value='1')
add(product, 'Property', Id='ARPNOMODIFY', Value='1')
saved_directory = add(product, 'Property', Id='INSTALLFOLDER', Secure='yes')
add(saved_directory, 'RegistrySearch', Id='PreviousInstallDirectory', Root='HKCU',
    Key='Software\\Altbase\\Wallet', Name='InstallDirectory', Type='raw', Win64='yes')
add(product, 'Icon', Id='AltbaseIcon', SourceFile=str(root/'build/icon.ico'))
add(product, 'Property', Id='ARPPRODUCTICON', Value='AltbaseIcon')
condition = add(product, 'Condition', Message='A 64-bit Windows installation is required.')
condition.text = 'VersionNT64'

target = add(product, 'Directory', Id='TARGETDIR', Name='SourceDir')
local = add(target, 'Directory', Id='LocalAppDataFolder')
programs = add(local, 'Directory', Id='LocalProgramsFolder', Name='Programs')
install = add(programs, 'Directory', Id='INSTALLFOLDER', Name=package['productName'])
menu = add(target, 'Directory', Id='ProgramMenuFolder')
menu_folder = add(menu, 'Directory', Id='AltbaseMenuFolder', Name=package['productName'])
add(target, 'Directory', Id='DesktopFolder')
directories = {Path('.'): install}
feature = add(product, 'Feature', Id='Complete', Title=package['productName'], Level='1')
files = []
versions = json.loads(subprocess.check_output(['node', str(root/'scripts/windows-msi-file-versions.cjs'), str(app)], cwd=root, text=True))
for file in sorted(app.rglob('*')):
    if file.is_symlink():
        raise SystemExit('Symlinks are not valid Windows installer inputs.')
    relative = file.relative_to(app)
    if 'wallet_secret' in relative.as_posix().lower():
        raise SystemExit('Protected source is not an installer input.')
    if not file.is_file():
        continue
    parent = relative.parent
    for directory in [*reversed(parent.parents), parent]:
        if directory == Path('.') or directory in directories:
            continue
        directories[directory] = add(directories[directory.parent], 'Directory',
                                     Id=ident('d',directory.as_posix()), Name=directory.name)
    component_id = ident('c', relative.as_posix())
    component = add(directories[parent], 'Component', Id=component_id, Win64='yes',
                    Guid=str(uuid.uuid5(uuid.UUID('6269a41c-b41d-598d-a2c1-ed9946ce1ca0'), relative.as_posix())).upper())
    file_id = ident('f', relative.as_posix())
    attributes = {'DefaultVersion': versions[relative.as_posix()]['version']} if relative.as_posix() in versions else {}
    add(component, 'File', Id=file_id, Source=str(file), Name=file.name, KeyPath='yes', **attributes)
    add(feature, 'ComponentRef', Id=component_id)
    files.append(relative.as_posix())
    if relative.as_posix() == package['productName']+'.exe':
        add(component, 'Shortcut', Id='DesktopShortcut', Directory='DesktopFolder',
            Name=package['productName'], Target='[#'+file_id+']', WorkingDirectory='INSTALLFOLDER', Icon='AltbaseIcon')
        add(component, 'Shortcut', Id='StartMenuShortcut', Directory='AltbaseMenuFolder',
            Name=package['productName'], Target='[#'+file_id+']', WorkingDirectory='INSTALLFOLDER', Icon='AltbaseIcon')
        shortcut_component = add(menu_folder, 'Component', Id='MenuCleanup', Win64='yes', Guid=str(uuid.uuid5(uuid.UUID('6269a41c-b41d-598d-a2c1-ed9946ce1ca0'), 'menu-cleanup')).upper())
        add(shortcut_component, 'RegistryValue', Root='HKCU', Key='Software\\Altbase\\Wallet', Name='InstallDirectory', Value='[INSTALLFOLDER]', Type='string', KeyPath='yes')
        add(shortcut_component, 'RemoveFolder', Id='RemoveStartMenuFolder', On='uninstall')
        add(feature, 'ComponentRef', Id='MenuCleanup')

fragment = add(tree, 'Fragment')
ui = add(fragment, 'UI', Id='AltbaseSetupUI')
add(product, 'UIRef', Id='AltbaseSetupUI')
add(ui, 'TextStyle', Id='Normal', FaceName='Tahoma', Size='9')
add(ui, 'TextStyle', Id='Title', FaceName='Tahoma', Size='14', Bold='yes')
add(product, 'Property', Id='DefaultUIFont', Value='Normal')
def dialog(name, title, description):
    element = add(ui, 'Dialog', Id=name, Width='370', Height='230', Title='[ProductName] Setup')
    add(element, 'Control', Id='Title', Type='Text', X='15', Y='15', Width='340', Height='36', TabSkip='yes', Text='{\\Title}'+title)
    add(element, 'Control', Id='Description', Type='Text', X='15', Y='58', Width='340', Height='110', TabSkip='yes', Text=description)
    return element
def button(parent, name, text, x, event='EndDialog', value='Return'):
    control = add(parent, 'Control', Id=name, Type='PushButton', X=x, Y='198', Width='75', Height='20', Text=text)
    if name in ['Install', 'Finish', 'Repair']: control.set('Default','yes')
    if name in ['Cancel', 'Finish']: control.set('Cancel','yes')
    publish = add(control, 'Publish', Event=event, Value=value)
    publish.text = '1'
    return control

welcome = dialog('WelcomeInstall', 'Install [ProductName]', 'Version [ProductVersion]\n\nThe application is installed for the current Windows user.\n\nInstallation folder:\n[INSTALLFOLDER]')
button(welcome, 'Install', 'Install', '190'); button(welcome, 'Cancel', 'Cancel', '275', value='Exit')
complete = dialog('SetupComplete', '[ProductName] setup completed', 'The requested installation or maintenance operation is complete.\n\nClick Finish to close this window.')
button(complete, 'Finish', 'Finish', '275')
maintenance = dialog('Maintenance', '[ProductName] maintenance', 'Repair the installed application or uninstall it.\n\nWallet profiles and coin module data are kept.')
repair = button(maintenance, 'Repair', 'Repair', '105')
remove = button(maintenance, 'Uninstall', 'Uninstall', '190')
button(maintenance, 'Cancel', 'Cancel', '275', value='Exit')
for parent,prop,value in [(repair,'REINSTALL','ALL'),(repair,'REINSTALLMODE','amus'),(remove,'REMOVE','ALL')]:
    action=add(parent,'Publish',Property=prop,Value=value,Order='1');action.text='1'
    parent[0].set('Order','10')
sequence = add(ui, 'InstallUISequence')
add(sequence, 'Show', Dialog='WelcomeInstall', Sequence='1250', Condition='NOT Installed')
add(sequence, 'Show', Dialog='Maintenance', Sequence='1240', Condition='Installed AND NOT REMOVE AND NOT REINSTALL')
add(sequence, 'Show', Dialog='SetupComplete', OnExit='success')

wxs = work / 'installer.wxs'
ET.indent(tree)
ET.ElementTree(tree).write(wxs, encoding='utf-8', xml_declaration=True)
command = ['wixl', '--ext', 'ui', '-a', 'x64', '-o', str(output), str(wxs)]
subprocess.run(command, cwd=root, check=True)
# wixl 0.106 starts focus on the first XML control even if TabSkip is set,
# and omits the self-loop for a single button. Native Windows requires both.
queries = []
for dialog_id, buttons in [('WelcomeInstall', ['Install', 'Cancel']),
                           ('SetupComplete', ['Finish']),
                           ('Maintenance', ['Repair', 'Uninstall', 'Cancel'])]:
    queries += ['-q', f"UPDATE `Dialog` SET `Control_First`='{buttons[0]}' WHERE `Dialog`='{dialog_id}'"]
    for index, name in enumerate(buttons):
        following = buttons[(index + 1) % len(buttons)]
        queries += ['-q', f"UPDATE `Control` SET `Control_Next`='{following}' WHERE `Dialog_`='{dialog_id}' AND `Control`='{name}'"]
for relative, metadata in versions.items():
    file_id = ident('f', relative)
    queries += ['-q', f"UPDATE `File` SET `Version`='{metadata['version']}', `Language`='{metadata['language']}' WHERE `File`='{file_id}'"]
    queries += ['-q', f"DELETE FROM `MsiFileHash` WHERE `File_`='{file_id}'"]
subprocess.run(['msibuild', str(output), *queries], cwd=root, check=True)
subprocess.run([sys.executable, str(root/'scripts/verify-windows-msi.py'), str(output), str(app)], cwd=root, check=True)
(work/'input-files.json').write_text(json.dumps({'application':str(app),'files':files},indent=2)+'\n')
print(json.dumps({'msi':str(output),'files':len(files),'nativeLinuxBuilder':'wixl'}),flush=True)
