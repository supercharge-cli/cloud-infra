#!/usr/bin/env bash
set -euo pipefail
: "${VERSION:?}" "${GITHUB_REPOSITORY:?}" "${APPIMAGE_RUNTIME:?}"
root="$(pwd)"
bundle="$root/apps/mobile/build/linux/x64/release/bundle"
out="$root/linux-packages"
mkdir -p "$out" "$out/stage/usr/share/applications" "$out/stage/usr/share/icons/hicolor/512x512/apps" "$out/stage/usr/bin" "$out/stage/opt/vectra-cloud"
cp -a "$bundle/." "$out/stage/opt/vectra-cloud/"
cp apps/mobile/ios/Runner/Assets.xcassets/AppIcon.appiconset/Icon-App-1024x1024@1x.png "$out/stage/usr/share/icons/hicolor/512x512/apps/vectra-cloud.png"
cp "$out/stage/usr/share/icons/hicolor/512x512/apps/vectra-cloud.png" "$bundle/vectra-cloud.png"
cat > "$out/stage/usr/share/applications/vectra-cloud.desktop" <<'DESKTOP'
[Desktop Entry]
Type=Application
Name=Vectra Cloud
Exec=vectra-cloud
Icon=vectra-cloud
Categories=Network;Development;
Terminal=false
DESKTOP
ln -s /opt/vectra-cloud/vectra_cloud "$out/stage/usr/bin/vectra-cloud"
tar -C "$(dirname "$bundle")" -czf "$out/vectra-linux-x64.tar.gz" bundle
export PACKAGE_ROOT="$out/stage"
python3 - <<'PY'
import os
from pathlib import Path
template = Path('apps/mobile/linux/packaging/nfpm.yaml').read_text()
Path('linux-packages/nfpm.yaml').write_text(template.replace('${PACKAGE_ROOT}', os.environ['PACKAGE_ROOT']).replace('${VERSION}', os.environ['VERSION']))
PY
nfpm package --config "$out/nfpm.yaml" --packager deb --target "$out/vectra-linux-amd64.deb"
nfpm package --config "$out/nfpm.yaml" --packager rpm --target "$out/vectra-linux-x86_64.rpm"
mkdir -p "$out/AppDir/usr/bin"
cp -a "$bundle/." "$out/AppDir/usr/bin/"
cp "$out/stage/usr/share/icons/hicolor/512x512/apps/vectra-cloud.png" "$out/AppDir/vectra-cloud.png"
sed 's/^Exec=.*/Exec=vectra_cloud/' "$out/stage/usr/share/applications/vectra-cloud.desktop" > "$out/AppDir/vectra-cloud.desktop"
cat > "$out/AppDir/AppRun" <<'APPRUN'
#!/usr/bin/env bash
HERE="$(dirname "$(readlink -f "$0")")"
exec "$HERE/usr/bin/vectra_cloud" "$@"
APPRUN
chmod +x "$out/AppDir/AppRun"
ARCH=x86_64 APPIMAGE_EXTRACT_AND_RUN=1 appimagetool --runtime-file "$APPIMAGE_RUNTIME" "$out/AppDir" "$out/vectra-linux-x86_64.AppImage"
sha=$(sha256sum "$out/vectra-linux-x64.tar.gz" | cut -d' ' -f1)
mkdir -p "$out/vectra-cloud-bin"
cat > "$out/vectra-cloud-bin/PKGBUILD" <<PKG
pkgname=vectra-cloud-bin
pkgver=$VERSION
pkgrel=1
pkgdesc='Vectra Cloud desktop client'
arch=('x86_64')
url='https://github.com/$GITHUB_REPOSITORY'
license=('custom')
depends=('gtk3' 'webkit2gtk-4.1' 'libsecret' 'mpv')
source=("vectra-linux-x64.tar.gz::https://github.com/$GITHUB_REPOSITORY/releases/download/v$VERSION/vectra-linux-x64.tar.gz")
sha256sums=('$sha')
package() {
  install -dm755 "\$pkgdir/opt/vectra-cloud" "\$pkgdir/usr/bin" "\$pkgdir/usr/share/applications"
  cp -a "\$srcdir/bundle/." "\$pkgdir/opt/vectra-cloud/"
  ln -s /opt/vectra-cloud/vectra_cloud "\$pkgdir/usr/bin/vectra-cloud"
  printf '[Desktop Entry]\\nType=Application\\nName=Vectra Cloud\\nExec=vectra-cloud\\nIcon=vectra-cloud\\nCategories=Network;Development;\\nTerminal=false\\n' > "\$pkgdir/usr/share/applications/vectra-cloud.desktop"
  install -Dm644 "\$srcdir/bundle/vectra-cloud.png" "\$pkgdir/usr/share/icons/hicolor/512x512/apps/vectra-cloud.png"
}
PKG
tar -C "$out" -czf "$out/vectra-cloud-aur-recipe.tar.gz" vectra-cloud-bin
