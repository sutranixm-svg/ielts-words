#!/usr/bin/env bash
# 构建雅思单词 APK。
# 签名材料只从环境变量读取，绝不写进命令行参数，也绝不自动生成 keystore。
# 本地只想检查能不能编过时：SIGN=0 bash build.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
OUT="$ROOT/build"

# 可选：本地 .env（已 gitignore）。只在当前 shell 生效，不打印。
if [ -f "$ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$ROOT/.env"
  set +a
fi

log() { printf '%s\n' "$*" >&2; }
die() { log "$*"; exit 1; }

# ---------- JDK ----------
if [ -n "${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/javac" ]; then
  JAVAC="$JAVA_HOME/bin/javac"
elif command -v javac >/dev/null 2>&1; then
  JAVAC="$(command -v javac)"
else
  die "找不到 javac。请安装 JDK 17+ 并设置 JAVA_HOME。"
fi

# ---------- Android SDK ----------
SDK_ROOT="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"
if [ -z "$SDK_ROOT" ]; then
  for c in /usr/lib/android-sdk /opt/android-sdk "$HOME/Android/Sdk" "$HOME/android-sdk"; do
    if [ -d "$c" ]; then SDK_ROOT="$c"; break; fi
  done
fi
[ -n "$SDK_ROOT" ] || die "找不到 Android SDK。请设置 ANDROID_SDK_ROOT（或 ANDROID_HOME）。"

if [ -n "${ANDROID_JAR:-}" ]; then
  SDK_JAR="$ANDROID_JAR"
else
  SDK_JAR="$(find "$SDK_ROOT/platforms" -name android.jar 2>/dev/null | sort -V | tail -1 || true)"
fi
[ -n "${SDK_JAR:-}" ] && [ -f "$SDK_JAR" ] || die "找不到 android.jar。用 sdkmanager 安装 platforms;android-35，或设置 ANDROID_JAR。"

if [ -n "${BUILD_TOOLS:-}" ]; then
  BT="$BUILD_TOOLS"
else
  BT="$(find "$SDK_ROOT/build-tools" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort -V | tail -1 || true)"
fi
[ -n "${BT:-}" ] && [ -d "$BT" ] || die "找不到 build-tools。请安装 build-tools;35.0.0 或设置 BUILD_TOOLS。"

AAPT="$(command -v aapt || true)"
[ -x "$BT/aapt" ] && AAPT="$BT/aapt"
[ -n "$AAPT" ] && [ -x "$AAPT" ] || die "找不到 aapt（在 $BT 或 PATH）。"

ZIPALIGN="$BT/zipalign"
[ -x "$ZIPALIGN" ] || ZIPALIGN="$(command -v zipalign || true)"
[ -n "$ZIPALIGN" ] && [ -x "$ZIPALIGN" ] || die "找不到 zipalign。"

APKSIGNER="$BT/apksigner"
[ -x "$APKSIGNER" ] || APKSIGNER="$(command -v apksigner || true)"

D8=""
if [ -x "$BT/d8" ]; then D8="$BT/d8"; elif command -v d8 >/dev/null 2>&1; then D8="$(command -v d8)"; fi
DX=""
if [ -x "$BT/dx" ]; then DX="$BT/dx"; elif command -v dx >/dev/null 2>&1; then DX="$(command -v dx)"; fi
if [ -z "$D8" ] && [ -z "$DX" ]; then
  # Debian 旧包把 dx 放在固定路径
  if [ -x /usr/lib/android-sdk/build-tools/debian/dx ]; then
    DX=/usr/lib/android-sdk/build-tools/debian/dx
  fi
fi
[ -n "$D8" ] || [ -n "$DX" ] || die "找不到 d8 或 dx。请安装 Android build-tools。"

MANIFEST="$ROOT/android/AndroidManifest.xml"
VER_NAME="$(sed -n 's/.*android:versionName="\([^"]*\)".*/\1/p' "$MANIFEST" | head -1)"
VER_CODE="$(sed -n 's/.*android:versionCode="\([^"]*\)".*/\1/p' "$MANIFEST" | head -1)"
[ -n "$VER_NAME" ] && [ -n "$VER_CODE" ] || die "AndroidManifest 缺少 versionName / versionCode。"

# 发布流水线把 tag 写成 VERSION_NAME。不一致就失败，避免打出和 tag 对不上的包。
if [ -n "${VERSION_NAME:-}" ] && [ "$VERSION_NAME" != "$VER_NAME" ]; then
  die "manifest versionName=$VER_NAME 与 VERSION_NAME=$VERSION_NAME 不一致。"
fi
if [ -n "${VERSION_CODE:-}" ] && [ "$VERSION_CODE" != "$VER_CODE" ]; then
  die "manifest versionCode=$VER_CODE 与 VERSION_CODE=$VERSION_CODE 不一致。"
fi

log "javac: $JAVAC"
log "android.jar: $SDK_JAR"
log "build-tools: $BT"
log "dexer: ${D8:-$DX}"
log "version: $VER_NAME ($VER_CODE)"

rm -rf "$OUT"
mkdir -p "$OUT/classes" "$OUT/dex"

if ! "$JAVAC" --release 8 -encoding UTF-8 -classpath "$SDK_JAR" -d "$OUT/classes" \
  "$ROOT"/android/src/com/dsh/ielts/*.java >"$OUT/javac.log" 2>&1; then
  log "javac 编译失败："
  cat "$OUT/javac.log" >&2
  exit 1
fi
cat "$OUT/javac.log" >&2 || true

CLASS_LIST="$(find "$OUT/classes" -name '*.class' | sort)"
[ -n "$CLASS_LIST" ] || die "没有生成 class 文件。"

if [ -n "$D8" ]; then
  # shellcheck disable=SC2086
  if ! "$D8" --min-api 23 --output "$OUT/dex" $CLASS_LIST; then
    # shellcheck disable=SC2086
    "$D8" --output "$OUT/dex" $CLASS_LIST
  fi
else
  "$DX" --dex --min-sdk-version=23 --output="$OUT/dex/classes.dex" "$OUT/classes"
fi
[ -f "$OUT/dex/classes.dex" ] || die "没有生成 classes.dex。"

# -0 mp3：发音资源保持 STORED（不压缩），避免部分机型解压后播不了。
"$AAPT" package -f -0 mp3 \
  -M "$MANIFEST" \
  -S "$ROOT/android/res" \
  -A "$ROOT/web" \
  -I "$SDK_JAR" \
  -F "$OUT/app.unsigned.apk"

(
  cd "$OUT" && "$AAPT" add app.unsigned.apk dex/classes.dex >/dev/null
)
# aapt add 会把 dex 放在 dex/classes.dex。安装器要的是根上的 classes.dex。
# 同时强制 mp3 为 STORED，避免 aapt 仍然压缩它们。
python3 - "$OUT/app.unsigned.apk" <<'PY'
import sys, zipfile, io
path = sys.argv[1]
buf = io.BytesIO()
with zipfile.ZipFile(path, "r") as zin, zipfile.ZipFile(buf, "w") as zout:
    for info in zin.infolist():
        data = zin.read(info.filename)
        name = info.filename
        if name == "dex/classes.dex":
            name = "classes.dex"
        # mp3 必须保持不压缩；其余沿用原压缩方式
        if name.endswith(".mp3"):
            zout.writestr(zipfile.ZipInfo(filename=name, date_time=info.date_time), data, compress_type=zipfile.ZIP_STORED)
        else:
            zi = zipfile.ZipInfo(filename=name, date_time=info.date_time)
            zi.compress_type = info.compress_type
            zi.external_attr = info.external_attr
            zout.writestr(zi, data, compress_type=info.compress_type)
open(path, "wb").write(buf.getvalue())
bad = []
with zipfile.ZipFile(path) as z:
    if "classes.dex" not in z.namelist():
        raise SystemExit("classes.dex 不在 APK 根目录")
    for info in z.infolist():
        if info.filename.endswith(".mp3") and info.compress_type != zipfile.ZIP_STORED:
            bad.append(info.filename)
if bad:
    raise SystemExit("这些 mp3 被压缩了: " + ", ".join(bad[:5]))
print("mp3 stored ok, count", sum(1 for i in __import__('zipfile').ZipFile(path).infolist() if i.filename.endswith('.mp3')))
PY

"$ZIPALIGN" -f -p 4 "$OUT/app.unsigned.apk" "$OUT/app.aligned.apk"

APK="$OUT/ielts-vocab-${VER_NAME}.apk"
SIGN="${SIGN:-1}"

if [ "$SIGN" = "0" ]; then
  cp "$OUT/app.aligned.apk" "$APK"
  log "未签名 APK: $APK"
  log "发布签名不会在这里生成密钥。设置 KEYSTORE、KEYSTORE_PASSWORD、KEY_ALIAS、KEY_PASSWORD 后再编。"
  exit 0
fi

if [ -z "${KEYSTORE:-}" ] || [ ! -f "$KEYSTORE" ]; then
  die "缺少 KEYSTORE 文件。build.sh 不会自动生成 keystore。本地验证请用 SIGN=0；发布请从密钥库提供路径。"
fi
: "${KEYSTORE_PASSWORD:?请设置 KEYSTORE_PASSWORD（环境变量或 .env，不要写进命令行）}"
KEY_ALIAS="${KEY_ALIAS:-ielts}"
if [ -z "${KEY_PASSWORD:-}" ]; then
  export KEY_PASSWORD="$KEYSTORE_PASSWORD"
fi
[ -n "$APKSIGNER" ] && [ -x "$APKSIGNER" ] || die "找不到 apksigner。"

# 口令通过 env: 传给 apksigner，不出现在进程参数里。
"$APKSIGNER" sign \
  --ks "$KEYSTORE" \
  --ks-key-alias "$KEY_ALIAS" \
  --ks-pass env:KEYSTORE_PASSWORD \
  --key-pass env:KEY_PASSWORD \
  --v1-signing-enabled true \
  --v2-signing-enabled true \
  --out "$APK" \
  "$OUT/app.aligned.apk"

"$APKSIGNER" verify --print-certs "$APK" | head -8
log "APK: $APK"
