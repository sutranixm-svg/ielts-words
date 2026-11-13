package com.dsh.ielts;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.AssetFileDescriptor;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.media.MediaRecorder;
import android.speech.tts.TextToSpeech;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class MainActivity extends Activity {
    private static final String UPDATE_FILE = "update.apk";
    private static final String ACTION_INSTALL = "com.dsh.ielts.INSTALL_UPDATE";
    private static final String CHANNEL = "ielts_updates";
    private static final int NOTIF_ID = 42;
    private static final int REQ_MIC = 1001;
    private static final int REQ_FILE = 1002;
    private static final int REQ_NOTIF = 1003;
    private static final int MAX_ATTEMPTS = 3;
    private static final long MAX_APK_BYTES = 80L * 1024L * 1024L;

    /**
     * 以前写死 raw/dist/ielts-vocab.apk，dist 上从来没有这个文件。
     * 兜底改为读取 dist 分支的 version.json，再用里面的 https 地址。
     */
    private static final String[] VERSION_JSONS = new String[] {
            "https://raw.githubusercontent.com/sutranixm-svg/ielts-words/dist/version.json",
            "https://ghfast.top/https://raw.githubusercontent.com/sutranixm-svg/ielts-words/dist/version.json",
            "https://cdn.jsdelivr.net/gh/sutranixm-svg/ielts-words@dist/version.json",
            "https://gcore.jsdelivr.net/gh/sutranixm-svg/ielts-words@dist/version.json"
    };

    private WebView web;
    private boolean dark;
    private boolean resumed;
    private boolean pendingInstall;
    private final AtomicBoolean downloading = new AtomicBoolean(false);
    private ValueCallback<Uri[]> fileCb;
    private MediaRecorder recorder;
    private MediaPlayer player;
    private TextToSpeech tts;
    private boolean ttsReady;
    private String recordName;
    private String lastDownloadError = "";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        dark = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
                == Configuration.UI_MODE_NIGHT_YES;
        applySystemBars();

        web = new WebView(this);
        web.setBackgroundColor(dark ? Color.parseColor("#0B0F1A") : Color.parseColor("#F4F7FB"));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setTextZoom(100);
        s.setMediaPlaybackRequiresUserGesture(false);
        web.setWebViewClient(new WebViewClient());
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCb != null) fileCb.onReceiveValue(null);
                fileCb = callback;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                try {
                    startActivityForResult(Intent.createChooser(i, "导入备份"), REQ_FILE);
                } catch (Exception e) {
                    fileCb = null;
                    Toast.makeText(MainActivity.this, "打不开文件选择器", Toast.LENGTH_SHORT).show();
                    return false;
                }
                return true;
            }
        });
        web.addJavascriptInterface(new Bridge(), "App");
        tts = new TextToSpeech(this, new TextToSpeech.OnInitListener() {
            @Override
            public void onInit(int status) {
                if (status == TextToSpeech.SUCCESS) {
                    int r = tts.setLanguage(Locale.US);
                    ttsReady = r != TextToSpeech.LANG_MISSING_DATA && r != TextToSpeech.LANG_NOT_SUPPORTED;
                }
            }
        });
        web.loadUrl("file:///android_asset/index.html");
        setContentView(web);
        handleInstallIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleInstallIntent(intent);
    }

    private void handleInstallIntent(Intent intent) {
        if (intent != null && ACTION_INSTALL.equals(intent.getAction())) {
            pendingInstall = true;
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        resumed = true;
        if (pendingInstall) {
            File f = new File(getCacheDir(), UPDATE_FILE);
            if (f.isFile()) {
                pendingInstall = false;
                launchInstaller(f);
            }
        }
    }

    @Override
    protected void onPause() {
        resumed = false;
        if (recorder != null) endRecord();
        super.onPause();
    }

    private void playFile(AssetFileDescriptor afd) {
        stopPlayer();
        try {
            player = new MediaPlayer();
            player.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build());
            if (afd != null) {
                player.setDataSource(afd.getFileDescriptor(), afd.getStartOffset(), afd.getLength());
                afd.close();
            }
            player.setOnCompletionListener(new MediaPlayer.OnCompletionListener() {
                @Override
                public void onCompletion(MediaPlayer mp) {
                    stopPlayer();
                }
            });
            player.setOnErrorListener(new MediaPlayer.OnErrorListener() {
                @Override
                public boolean onError(MediaPlayer mp, int what, int extra) {
                    stopPlayer();
                    emit("audiofail:asset");
                    return true;
                }
            });
            player.prepare();
            player.start();
        } catch (Exception e) {
            stopPlayer();
            emit("audiofail:asset" + e.getClass().getSimpleName());
        }
    }

    /** 直连流播在部分机型上会被拦，改成先落盘再播。只接受 https。 */
    private void playUrl(final String url) {
        if (url == null || !url.startsWith("https://")) {
            emit("audiofail:netscheme");
            return;
        }
        stopPlayer();
        new Thread(new Runnable() {
            @Override
            public void run() {
                File out = new File(getCacheDir(), "say.mp3");
                HttpURLConnection conn = null;
                InputStream in = null;
                FileOutputStream fos = null;
                try {
                    conn = (HttpURLConnection) new URL(url).openConnection();
                    conn.setConnectTimeout(10000);
                    conn.setReadTimeout(15000);
                    conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android)");
                    conn.setInstanceFollowRedirects(true);
                    if (conn.getResponseCode() != 200) {
                        emit("audiofail:net" + conn.getResponseCode());
                        return;
                    }
                    if (conn.getURL() == null || !"https".equalsIgnoreCase(conn.getURL().getProtocol())) {
                        emit("audiofail:netscheme");
                        return;
                    }
                    in = conn.getInputStream();
                    fos = new FileOutputStream(out);
                    byte[] buf = new byte[16 * 1024];
                    int n;
                    long total = 0;
                    while ((n = in.read(buf)) > 0) {
                        fos.write(buf, 0, n);
                        total += n;
                        if (total > 2 * 1024 * 1024) break;
                    }
                    fos.flush();
                    fos.close();
                    fos = null;
                    if (out.length() < 500) {
                        emit("audiofail:empty");
                        return;
                    }
                    final File f = out;
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            playLocal(f);
                        }
                    });
                } catch (Exception e) {
                    emit("audiofail:net" + e.getClass().getSimpleName());
                } finally {
                    try { if (fos != null) fos.close(); } catch (Exception ignored) { }
                    try { if (in != null) in.close(); } catch (Exception ignored) { }
                    if (conn != null) conn.disconnect();
                }
            }
        }).start();
    }

    private void playLocal(File f) {
        stopPlayer();
        try {
            player = new MediaPlayer();
            player.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build());
            player.setDataSource(f.getAbsolutePath());
            player.setOnCompletionListener(new MediaPlayer.OnCompletionListener() {
                @Override
                public void onCompletion(MediaPlayer mp) {
                    stopPlayer();
                }
            });
            player.setOnErrorListener(new MediaPlayer.OnErrorListener() {
                @Override
                public boolean onError(MediaPlayer mp, int what, int extra) {
                    stopPlayer();
                    emit("audiofail:decode" + what);
                    return true;
                }
            });
            player.prepare();
            player.start();
        } catch (Exception e) {
            stopPlayer();
            emit("audiofail:decode" + e.getClass().getSimpleName());
        }
    }

    private void stopPlayer() {
        if (player != null) {
            try {
                if (player.isPlaying()) player.stop();
            } catch (Exception ignored) {
            }
            try {
                player.release();
            } catch (Exception ignored) {
            }
            player = null;
        }
    }

    /** 暴露给网页的最小接口：版本号 + 下载安装 + 备份分享。 */
    private class Bridge {
        @JavascriptInterface
        public String version() {
            try {
                return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            } catch (PackageManager.NameNotFoundException e) {
                return "0";
            }
        }

        @JavascriptInterface
        public void installUpdate(final String payload) {
            if (!downloading.compareAndSet(false, true)) {
                emit("error:已有下载在进行");
                return;
            }
            emit("downloading");
            new Thread(new Runnable() {
                @Override
                public void run() {
                    boolean handedOff = false;
                    try {
                        String expect = "";
                        List<String> list = new ArrayList<String>();
                        String raw = payload == null ? "" : payload;
                        for (String u : raw.split("\n")) {
                            String t = u.trim();
                            if (t.toLowerCase(Locale.US).startsWith("sha256:")) {
                                expect = t.substring(7).trim();
                            } else if (t.startsWith("https://")) {
                                if (!list.contains(t)) list.add(t);
                            }
                        }
                        String[] shaBox = new String[] { expect };
                        addVersionJsonFallbacks(list, shaBox);
                        expect = shaBox[0];
                        if (list.isEmpty()) {
                            lastDownloadError = "没有可用的 https 下载地址";
                            emit("error:" + lastDownloadError);
                            return;
                        }
                        for (int i = 0; i < list.size(); i++) {
                            if (downloadWithRetry(list.get(i), expect)) {
                                handedOff = true;
                                final File apk = new File(getCacheDir(), UPDATE_FILE);
                                runOnUiThread(new Runnable() {
                                    @Override
                                    public void run() {
                                        try {
                                            presentInstaller(apk);
                                        } finally {
                                            downloading.set(false);
                                        }
                                    }
                                });
                                return;
                            }
                        }
                        if (lastDownloadError.length() == 0) lastDownloadError = "所有下载源都失败";
                        emit("error:" + lastDownloadError);
                    } catch (Exception e) {
                        lastDownloadError = e.getClass().getSimpleName();
                        emit("error:" + lastDownloadError);
                    } finally {
                        if (!handedOff) downloading.set(false);
                    }
                }
            }).start();
        }

        @JavascriptInterface
        public String platform() {
            return "android";
        }

        @JavascriptInterface
        public boolean startRecord() {
            if (Build.VERSION.SDK_INT >= 23 && checkSelfPermission(Manifest.permission.RECORD_AUDIO)
                    != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_MIC);
                return false;
            }
            return beginRecord();
        }

        @JavascriptInterface
        public String stopRecord() {
            return endRecord();
        }

        @JavascriptInterface
        public String recordUrl() {
            File f = new File(getCacheDir(), "rec.m4a");
            if (!f.isFile()) return "";
            return RecProvider.uriFor(MainActivity.this).toString();
        }

        @JavascriptInterface
        public boolean playAsset(String name) {
            if (name == null || name.contains("..") || name.contains("/") && !name.startsWith("audio/")) return false;
            if (name.contains("..")) return false;
            try {
                AssetFileDescriptor afd = getAssets().openFd(name);
                playFile(afd);
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public void playUrl(String url) {
            if (url == null || !url.startsWith("https://")) return;
            MainActivity.this.playUrl(url);
        }

        @JavascriptInterface
        public boolean hasTts() {
            return ttsReady;
        }

        @JavascriptInterface
        public void speakText(String text) {
            if (!ttsReady || text == null) {
                emit("audiofail:tts");
                return;
            }
            tts.speak(text, TextToSpeech.QUEUE_FLUSH, null);
        }

        @JavascriptInterface
        public void stopAudio() {
            stopPlayer();
            if (tts != null) tts.stop();
        }

        @JavascriptInterface
        public void openUrl(final String url) {
            if (url == null || !(url.startsWith("https://") || url.startsWith("http://"))) return;
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(i);
                    } catch (Exception e) {
                        Toast.makeText(MainActivity.this, "打不开链接", Toast.LENGTH_SHORT).show();
                    }
                }
            });
        }

        /** 分享 JSON 文本（系统分享面板里可以存到文件或发给自己）。 */
        @JavascriptInterface
        public void shareText(final String name, final String content) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        Intent send = new Intent(Intent.ACTION_SEND);
                        send.setType("application/json");
                        send.putExtra(Intent.EXTRA_SUBJECT, name == null ? "ielts-vocab-backup.json" : name);
                        send.putExtra(Intent.EXTRA_TEXT, content == null ? "" : content);
                        startActivity(Intent.createChooser(send, "导出学习数据"));
                    } catch (Exception e) {
                        saveText(name, content);
                    }
                }
            });
        }

        /** 把 JSON 写到应用专属目录，不需要存储权限。 */
        @JavascriptInterface
        public void saveText(final String name, final String content) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        String safe = name == null ? "ielts-vocab-backup.json" : name.replaceAll("[^A-Za-z0-9._-]", "_");
                        if (safe.length() == 0) safe = "ielts-vocab-backup.json";
                        File dir = getExternalFilesDir(null);
                        if (dir == null) dir = getFilesDir();
                        File out = new File(dir, safe);
                        FileOutputStream fos = new FileOutputStream(out);
                        byte[] bytes = (content == null ? "" : content).getBytes("UTF-8");
                        fos.write(bytes);
                        fos.close();
                        Toast.makeText(MainActivity.this, "已保存到 " + out.getAbsolutePath(), Toast.LENGTH_LONG).show();
                    } catch (Exception e) {
                        Toast.makeText(MainActivity.this, "保存失败：" + e.getClass().getSimpleName(), Toast.LENGTH_SHORT).show();
                    }
                }
            });
        }
    }

    private boolean beginRecord() {
        endRecord();
        try {
            File out = new File(getCacheDir(), "rec.m4a");
            if (out.exists()) out.delete();
            recorder = new MediaRecorder();
            recorder.setAudioSource(MediaRecorder.AudioSource.MIC);
            recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
            recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
            recorder.setAudioEncodingBitRate(64000);
            recorder.setAudioSamplingRate(44100);
            recorder.setOutputFile(out.getAbsolutePath());
            recorder.prepare();
            recorder.start();
            recordName = out.getName();
            return true;
        } catch (Exception e) {
            recorder = null;
            Toast.makeText(this, "无法开始录音：" + e.getClass().getSimpleName(), Toast.LENGTH_SHORT).show();
            return false;
        }
    }

    private String endRecord() {
        if (recorder == null) return recordName == null ? "" : recordName;
        try {
            recorder.stop();
        } catch (Exception ignored) {
        }
        try {
            recorder.release();
        } catch (Exception ignored) {
        }
        recorder = null;
        return recordName == null ? "" : recordName;
    }

    private void addVersionJsonFallbacks(List<String> list, String[] shaBox) {
        for (int i = 0; i < VERSION_JSONS.length; i++) {
            String body = httpGet(VERSION_JSONS[i], 120000);
            if (body == null || body.length() == 0) continue;
            if (shaBox[0] == null || shaBox[0].length() == 0) {
                Matcher m = Pattern.compile("\"sha256\"\\s*:\\s*\"([a-fA-F0-9]{64})\"").matcher(body);
                if (m.find()) shaBox[0] = m.group(1);
            }
            Matcher um = Pattern.compile("https://[^\"\\s]+?\\.apk").matcher(body);
            boolean any = false;
            while (um.find()) {
                String apk = um.group();
                if (!list.contains(apk)) list.add(apk);
                any = true;
            }
            if (any) return;
        }
    }

    private String httpGet(String url, int maxBytes) {
        if (url == null || !url.startsWith("https://")) return null;
        HttpURLConnection conn = null;
        InputStream in = null;
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(8000);
            conn.setInstanceFollowRedirects(true);
            conn.setRequestProperty("User-Agent", "ielts-words-updater");
            if (conn.getResponseCode() != 200) return null;
            if (conn.getURL() == null || !"https".equalsIgnoreCase(conn.getURL().getProtocol())) return null;
            in = conn.getInputStream();
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) > 0) {
                bos.write(buf, 0, n);
                if (bos.size() > maxBytes) return null;
            }
            return bos.toString("UTF-8");
        } catch (Exception e) {
            return null;
        } finally {
            try { if (in != null) in.close(); } catch (Exception ignored) { }
            if (conn != null) conn.disconnect();
        }
    }

    /** 网络错误和校验失败会重试；4xx 不重试。失败时不往界面报错，换下一个镜像。 */
    private boolean downloadWithRetry(String url, String expectSha) {
        for (int attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            String err = downloadOnce(url, expectSha);
            if (err == null) return true;
            lastDownloadError = err;
            if (err.startsWith("HTTP 4")) return false;
        }
        return false;
    }

    /** @return null 表示成功，否则是失败原因（调用方决定要不要展示）。 */
    private String downloadOnce(String url, String expectSha) {
        if (url == null || !url.startsWith("https://")) return "地址不是 https";
        File out = new File(getCacheDir(), UPDATE_FILE);
        File tmp = new File(getCacheDir(), UPDATE_FILE + ".part");
        if (tmp.exists() && !tmp.delete()) return "无法清理临时文件";
        HttpURLConnection conn = null;
        InputStream in = null;
        FileOutputStream fos = null;
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(45000);
            conn.setRequestProperty("User-Agent", "ielts-words-updater");
            conn.setInstanceFollowRedirects(true);
            int code = conn.getResponseCode();
            if (code != 200) return "HTTP " + code;
            if (conn.getURL() == null || !"https".equalsIgnoreCase(conn.getURL().getProtocol())) {
                return "重定向离开了 https";
            }
            long total = conn.getContentLength();
            if (total > MAX_APK_BYTES) return "安装包过大";
            in = conn.getInputStream();
            fos = new FileOutputStream(tmp);
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] buf = new byte[64 * 1024];
            long got = 0;
            int n;
            int lastPct = -1;
            int magicGot = 0;
            byte m0 = 0;
            byte m1 = 0;
            while ((n = in.read(buf)) > 0) {
                for (int i = 0; i < n && magicGot < 2; i++) {
                    if (magicGot == 0) m0 = buf[i];
                    else m1 = buf[i];
                    magicGot++;
                }
                if (magicGot >= 2 && (m0 != 'P' || m1 != 'K')) return "不是有效的 APK";
                fos.write(buf, 0, n);
                md.update(buf, 0, n);
                got += n;
                if (got > MAX_APK_BYTES) return "安装包过大";
                if (total > 0) {
                    int pct = (int) (got * 100 / total);
                    if (pct != lastPct && pct % 5 == 0) {
                        lastPct = pct;
                        emit("progress:" + pct);
                    }
                }
            }
            fos.flush();
            fos.close();
            fos = null;
            if (magicGot < 2 || m0 != 'P' || m1 != 'K') return "不是有效的 APK";
            if (total > 0 && got != total) {
                tmp.delete();
                return "下载不完整";
            }
            if (got < 4) {
                tmp.delete();
                return "文件过小";
            }
            String actual = hex(md.digest());
            if (!hashOk(actual, expectSha)) {
                tmp.delete();
                return "校验和不匹配";
            }
            if (out.exists() && !out.delete()) return "无法替换旧安装包";
            if (!tmp.renameTo(out)) return "无法保存安装包";
            return null;
        } catch (Exception e) {
            if (tmp.exists()) tmp.delete();
            return e.getClass().getSimpleName();
        } finally {
            try { if (fos != null) fos.close(); } catch (Exception ignored) { }
            try { if (in != null) in.close(); } catch (Exception ignored) { }
            if (conn != null) conn.disconnect();
        }
    }

    private static boolean hashOk(String actual, String expected) {
        if (expected == null) return true;
        String exp = expected.trim().toLowerCase(Locale.US);
        if (exp.startsWith("sha256:")) exp = exp.substring(7).trim();
        if (exp.length() == 0) return true;
        return actual != null && actual.equalsIgnoreCase(exp);
    }

    private static String hex(byte[] d) {
        StringBuilder sb = new StringBuilder(d.length * 2);
        for (int i = 0; i < d.length; i++) {
            sb.append(String.format(Locale.US, "%02x", d[i] & 0xff));
        }
        return sb.toString();
    }

    /** API 26 才有，编译期可能对着旧 android.jar，所以走反射。 */
    private boolean canInstallPackages() {
        try {
            Object r = getPackageManager().getClass().getMethod("canRequestPackageInstalls")
                    .invoke(getPackageManager());
            return Boolean.TRUE.equals(r);
        } catch (Throwable t) {
            return true;
        }
    }

    private void presentInstaller(File apk) {
        if (!resumed) {
            pendingInstall = true;
            notifyInstall();
            emit("installing");
            return;
        }
        launchInstaller(apk);
    }

    private void launchInstaller(File apk) {
        if (apk == null || !apk.isFile()) {
            emit("error:安装包不存在");
            return;
        }
        if (Build.VERSION.SDK_INT >= 26 && !canInstallPackages()) {
            emit("error:需要允许安装未知应用");
            Intent i = new Intent("android.settings.MANAGE_UNKNOWN_APP_SOURCES",
                    Uri.parse("package:" + getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try { startActivity(i); } catch (Exception ignored) { }
            pendingInstall = true;
            return;
        }
        try {
            Uri uri = ApkProvider.uriFor(this, apk);
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(uri, "application/vnd.android.package-archive");
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivity(i);
            emit("installing");
        } catch (Exception e) {
            Toast.makeText(this, "启动安装失败：" + e.getClass().getSimpleName(), Toast.LENGTH_LONG).show();
            emit("error:启动安装失败");
        }
    }

    private boolean canNotify() {
        if (Build.VERSION.SDK_INT < 33) return true;
        return checkSelfPermission("android.permission.POST_NOTIFICATIONS") == PackageManager.PERMISSION_GRANTED;
    }

    private void notifyInstall() {
        if (Build.VERSION.SDK_INT >= 33 && !canNotify()) {
            try {
                requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, REQ_NOTIF);
            } catch (Exception ignored) { }
        }
        try {
            if (Build.VERSION.SDK_INT >= 26) ensureChannel();
            Intent launch = new Intent(this, MainActivity.class);
            launch.setAction(ACTION_INSTALL);
            launch.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            int piFlags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
            PendingIntent pi = PendingIntent.getActivity(this, 1, launch, piFlags);
            Notification.Builder b = new Notification.Builder(this);
            b.setContentTitle("雅思单词");
            b.setContentText("更新已下载，点按完成安装");
            b.setSmallIcon(android.R.drawable.stat_sys_download_done);
            b.setContentIntent(pi);
            b.setAutoCancel(true);
            if (Build.VERSION.SDK_INT >= 26) {
                try {
                    b.getClass().getMethod("setChannelId", String.class).invoke(b, CHANNEL);
                } catch (Throwable ignored) { }
            }
            Notification n = b.build();
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(NOTIF_ID, n);
        } catch (Exception e) {
            emit("error:更新已下载，请回到应用安装");
        }
    }

    private void ensureChannel() {
        try {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm == null) return;
            Class<?> chCls = Class.forName("android.app.NotificationChannel");
            Object ch = chCls.getConstructor(String.class, CharSequence.class, int.class)
                    .newInstance(CHANNEL, "更新", 3);
            nm.getClass().getMethod("createNotificationChannel", chCls).invoke(nm, ch);
        } catch (Throwable ignored) { }
    }

    /** 把更新状态回传给网页，供提示条更新。 */
    private void emit(final String status) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (web == null) return;
                String js = "window.__updateStatus && window.__updateStatus(" + quote(status) + ")";
                web.evaluateJavascript(js, null);
            }
        });
    }

    private static String quote(String s) {
        StringBuilder b = new StringBuilder("'");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '\'' || c == '\\') b.append('\\');
            if (c == '\n' || c == '\r') continue;
            b.append(c);
        }
        return b.append('\'').toString();
    }

    private void applySystemBars() {
        Window window = getWindow();
        int bg = dark ? Color.parseColor("#0B0F1A") : Color.parseColor("#F4F7FB");
        window.setStatusBarColor(bg);
        window.setNavigationBarColor(bg);
        if (Build.VERSION.SDK_INT >= 23) {
            View decor = window.getDecorView();
            int flags = decor.getSystemUiVisibility();
            if (dark) flags &= ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            else flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            decor.setSystemUiVisibility(flags);
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_FILE && fileCb != null) {
            Uri[] out = null;
            if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                out = new Uri[]{data.getData()};
            }
            fileCb.onReceiveValue(out);
            fileCb = null;
        }
    }

    @Override
    public void onBackPressed() {
        if (web == null) {
            super.onBackPressed();
            return;
        }
        web.evaluateJavascript("(window.__ieltsBack && window.__ieltsBack()) ? '1' : '0'", new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String value) {
                if (value == null || !value.contains("1")) {
                    finish();
                }
            }
        });
    }

    @Override
    protected void onDestroy() {
        stopPlayer();
        if (tts != null) {
            tts.stop();
            tts.shutdown();
        }
        if (recorder != null) endRecord();
        if (fileCb != null) {
            fileCb.onReceiveValue(null);
            fileCb = null;
        }
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
