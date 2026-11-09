#!/usr/bin/env bash
# 构建雅思单词 APK：WebView 外壳 + 本地网页。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
SDK_JAR="/usr/lib/android-sdk/platforms/android-23/android.jar"
JAVA_BIN="/usr/lib/jvm/java-17-openjdk-arm64/bin"
OUT="$ROOT/build"
APK="$OUT/ielts-vocab.apk"

# 签名口令只从环境变量或本地 .env 读，不进仓库。
if [ -z "${KS_PASS:-}" ] && [ -f "$ROOT/.env" ]; then
  # shellcheck disable=SC1091
  set -a; . "$ROOT/.env"; set +a
fi
: "${KS_PASS:?请先设置 KS_PASS（写到 .env 或环境变量里）}"

if [ ! -f "$SDK_JAR" ]; then
  echo "missing android.jar: $SDK_JAR" >&2
  exit 1
fi

rm -rf "$OUT"
mkdir -p "$OUT/classes"

"$JAVA_BIN/javac" -encoding UTF-8 -source 1.8 -target 1.8 \
  -bootclasspath "$SDK_JAR" -d "$OUT/classes" \
  "$ROOT"/android/src/com/dsh/ielts/*.java 2>&1 | grep -v "bootstrap class path" || true

/usr/lib/android-sdk/build-tools/debian/dx --dex --output="$OUT/classes.dex" "$OUT/classes"

aapt package -f \
  -M "$ROOT/android/AndroidManifest.xml" \
  -S "$ROOT/android/res" \
  -A "$ROOT/web" \
  -I "$SDK_JAR" \
  -F "$OUT/app.unsigned.apk"

( cd "$OUT" && aapt add app.unsigned.apk classes.dex >/dev/null )

zipalign -f 4 "$OUT/app.unsigned.apk" "$OUT/app.aligned.apk"

KEYSTORE="$ROOT/.keystore/ielts.jks"
if [ ! -f "$KEYSTORE" ]; then
  mkdir -p "$ROOT/.keystore"
  "$JAVA_BIN/keytool" -genkeypair -keystore "$KEYSTORE" -storepass "$KS_PASS" -keypass "$KS_PASS" \
    -alias ielts -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=IELTS Vocab, O=DSH, C=CN" >/dev/null 2>&1
fi

apksigner sign --ks "$KEYSTORE" --ks-pass "pass:$KS_PASS" --key-pass "pass:$KS_PASS" \
  --v1-signing-enabled true --v2-signing-enabled true \
  --out "$APK" "$OUT/app.aligned.apk"

apksigner verify --print-certs "$APK" | head -5
echo "APK: $APK ($(du -h "$APK" | cut -f1))"
