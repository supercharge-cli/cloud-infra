#!/usr/bin/env python3
"""Check that duplicate Flutter asset filenames retain their directories."""
from pathlib import Path
import shutil
import subprocess
import tempfile

config_template = Path(__file__).with_name('nfpm.yaml').read_text()
with tempfile.TemporaryDirectory(prefix='vectra-package-test-') as temp:
    root = Path(temp)
    stage = root / 'stage'
    bundle = stage / 'opt/vectra-cloud'
    for relative, contents in {
        'vectra_cloud': 'executable',
        'data/flutter_assets/shaders/ink_sparkle.frag': 'first shader',
        'data/flutter_assets/packages/material_ui/shaders/ink_sparkle.frag': 'second shader',
        'lib/libflutter_linux_gtk.so': 'library',
    }.items():
        path = bundle / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(contents)
    for relative in [
        'usr/share/applications/vectra-cloud.desktop',
        'usr/share/icons/hicolor/512x512/apps/vectra-cloud.png',
    ]:
        path = stage / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('fixture')
    config = root / 'nfpm.yaml'
    config.write_text(config_template.replace('${PACKAGE_ROOT}', str(stage)).replace('${VERSION}', '1.2.3'))
    expected = [
        '/opt/vectra-cloud/data/flutter_assets/shaders/ink_sparkle.frag',
        '/opt/vectra-cloud/data/flutter_assets/packages/material_ui/shaders/ink_sparkle.frag',
        '/opt/vectra-cloud/lib/libflutter_linux_gtk.so',
    ]
    for kind in ('deb', 'rpm'):
        package = root / f'vectra.{kind}'
        subprocess.run(['nfpm', 'package', '--config', str(config), '--packager', kind, '--target', str(package)], check=True)
        if kind == 'deb':
            listing = subprocess.check_output(['dpkg-deb', '-c', str(package)], text=True)
        elif shutil.which('rpm'):
            listing = subprocess.check_output(['rpm', '-qpl', str(package)], text=True)
        else:
            continue
        for path in expected:
            if path not in listing:
                raise SystemExit(f'{kind} package is missing {path}')
print('Linux packages preserve nested assets with duplicate filenames')
