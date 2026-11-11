package com.dsh.ielts;

import android.app.Activity;
import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.AssetFileDescriptor;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.media.MediaRecorder;
import android.speech.tts.TextToSpeech;
import java.util.Locale;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

public class MainActivity extends Activity {
    private static final String UPDATE_FILE = "update.apk";
    // 下载地址由网页从镜像清单里给出，用 \n 分隔，按顺序逐个尝试
    private static final String LAST_RESORT =
            "https://gh-proxy.com/https://github.com/sutranixm-svg/ielts-words/raw/dist/ielts-vocab.apk";

    private WebView web;
    private boolean dark;
    private MediaRecorder recorder;
    private MediaPlayer player;
    private TextToSpeech tts;
    private boolean ttsReady;
    private String recordName;
    private static final int REQ_MIC = 1001;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        dark = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
                == Configuration.UI_MODE_NIGHT_YES;
        applySystemBars();

        web = new WebView(this);
        web.setBackgroundColor(dark ? Color.parseColor("#0a0e13") : Color.parseColor("#f5f7f9"));
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

    /** 直连流播在部分机型上会被拦，改成先落盘再播。 */
    private void playUrl(final String url) {
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

    /** 暴露给网页的最小接口：版本号 + 下载安装。 */
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
        public void installUpdate(final String url) {
            if (url == null || !(url.startsWith("https://") || url.startsWith("http://"))) {
                emit("error:地址不合法");
                return;
            }
            emit("downloading");
            new Thread(new Runnable() {
                @Override
                public void run() {
                    java.util.List<String> list = new java.util.ArrayList<String>();
                    for (String u : url.split("\n")) {
                        String t = u.trim();
                        if (t.startsWith("http")) list.add(t);
                    }
                    if (list.isEmpty()) {
                        emit("error:没有可用的下载地址");
                        return;
                    }
                    list.add(LAST_RESORT);
                    for (int i = 0; i < list.size(); i++) {
                        if (i > 0) emit("mirror:" + i);
                        if (download(list.get(i), 0)) return;
                    }
                    emit("error:所有下载源都失败");
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
            return ApkProvider.uriFor(MainActivity.this, f).toString();
        }

        /** 用系统浏览器打开外部链接（外刊原文）。 */
        @JavascriptInterface
        public boolean playAsset(String name) {
            if (name == null || name.contains("..")) return false;
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
            if (url == null || !(url.startsWith("http://") || url.startsWith("https://"))) return;
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

    private boolean download(String url, int retries) {
        File out = new File(getCacheDir(), UPDATE_FILE);
        if (out.exists() && !out.delete()) {
            emit("error:无法清理旧文件");
            return false;
        }
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
            if (code != 200) {
                emit("error:HTTP " + code);
                return false;
            }
            long total = conn.getContentLength();
            in = conn.getInputStream();
            fos = new FileOutputStream(out);
            byte[] buf = new byte[64 * 1024];
            long got = 0;
            int n;
            int lastPct = -1;
            while ((n = in.read(buf)) > 0) {
                fos.write(buf, 0, n);
                got += n;
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
            if (total > 0 && got != total) {
                out.delete();
                emit("error:下载不完整");
                return false;
            }
            install(out);
            return true;
        } catch (Exception e) {
            if (out.exists()) out.delete();
            emit("error:" + e.getClass().getSimpleName());
            return false;
        } finally {
            try { if (fos != null) fos.close(); } catch (Exception ignored) { }
            try { if (in != null) in.close(); } catch (Exception ignored) { }
            if (conn != null) conn.disconnect();
        }
    }

    /** API 26 才有，编译期用 android-23 的 jar，所以走反射。 */
    private boolean canInstallPackages() {
        try {
            Object r = getPackageManager().getClass().getMethod("canRequestPackageInstalls")
                    .invoke(getPackageManager());
            return Boolean.TRUE.equals(r);
        } catch (Throwable t) {
            return true;
        }
    }

    private void install(File apk) {
        if (Build.VERSION.SDK_INT >= 26 && !canInstallPackages()) {
            emit("error:需要允许安装未知应用");
            Intent i = new Intent("android.settings.MANAGE_UNKNOWN_APP_SOURCES",
                    Uri.parse("package:" + getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try { startActivity(i); } catch (Exception ignored) { }
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
            b.append(c);
        }
        return b.append('\'').toString();
    }

    private void applySystemBars() {
        Window window = getWindow();
        int bg = dark ? Color.parseColor("#0a0e13") : Color.parseColor("#f5f7f9");
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
    protected void onPause() {
        if (recorder != null) endRecord();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        stopPlayer();
        if (tts != null) {
            tts.stop();
            tts.shutdown();
        }
        if (recorder != null) endRecord();
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
