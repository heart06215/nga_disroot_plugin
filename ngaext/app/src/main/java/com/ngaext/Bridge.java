package com.ngaext;

import android.content.Context;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONObject;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

import de.robv.android.xposed.XposedHelpers;

/** JS 与原生之间的桥：JS 发起解析，原生解密后回调 JS。 */
public class Bridge {

    private static final String TAG = "ngaext";
    private static final int CACHE_MAX = 64;

    private static final Map<String, String> MEM_CACHE = Collections.synchronizedMap(
            new LinkedHashMap<String, String>(16, 0.75f, true) {
                @Override
                protected boolean removeEldestEntry(Map.Entry<String, String> eldest) {
                    return size() > CACHE_MAX;
                }
            });

    private static final int TEXT_CAP = 300000;

    /** 固定 3 线程 + 有界队列，避免一页 25 条链接时线程爆炸把 App 拖崩 */
    private static final java.util.concurrent.ThreadPoolExecutor POOL =
            new java.util.concurrent.ThreadPoolExecutor(
                    3, 3, 30L, java.util.concurrent.TimeUnit.SECONDS,
                    new java.util.concurrent.LinkedBlockingQueue<Runnable>(64),
                    new java.util.concurrent.ThreadFactory() {
                        @Override
                        public Thread newThread(Runnable r) {
                            Thread t = new Thread(r, "ngaext-resolve");
                            t.setDaemon(true);
                            return t;
                        }
                    },
                    new java.util.concurrent.ThreadPoolExecutor.AbortPolicy());

    private final WebView webView;

    Bridge(WebView webView) {
        this.webView = webView;
    }

    private static Context appContext() {
        try {
            return (Context) XposedHelpers.callStaticMethod(
                    XposedHelpers.findClass("android.app.AndroidAppHelper", Bridge.class.getClassLoader()),
                    "currentApplication");
        } catch (Throwable t) {
            return null;
        }
    }

    @JavascriptInterface
    public void request(final String cbId, final String url, final String passwordsJson) {
        try {
            POOL.execute(new Runnable() {
                @Override
                public void run() {
                    long start = System.currentTimeMillis();
                    String payload = MEM_CACHE.get(url);
                    String source = "memory";

                    if (payload == null) {
                        Context ctx = appContext();
                        payload = DiskCache.get(ctx, url);
                        if (payload != null) {
                            source = "disk";
                            MEM_CACHE.put(url, payload);
                        } else {
                            source = "network";
                            payload = resolveAndBuild(url, parsePasswords(passwordsJson), ctx);
                        }
                    }

                    Log.i(TAG, "resolve " + source + " " + (System.currentTimeMillis() - start) + "ms");
                    dispatch(cbId, payload);
                }
            });
        } catch (Throwable rejected) {
            Log.w(TAG, "queue full, skip " + url, rejected);
            dispatch(cbId, "{\"ok\":false,\"error\":\"解析队列已满，请稍后重试\"}");
        }
    }

    private static String[] parsePasswords(String raw) {
        if (raw == null || raw.length() == 0) return new String[]{""};
        String s = raw.trim();
        if (s.startsWith("[")) {
            try {
                org.json.JSONArray arr = new org.json.JSONArray(s);
                String[] out = new String[arr.length()];
                for (int i = 0; i < arr.length(); i++) out[i] = arr.optString(i, "");
                return out;
            } catch (Throwable ignored) {
            }
        }
        return new String[]{s};
    }

    private String resolveAndBuild(String url, String[] passwords, Context ctx) {
        try {
            String text = PbClient.resolveMulti(url, passwords);
            if (text.length() > TEXT_CAP) text = text.substring(0, TEXT_CAP) + "\n\n…（内容过长，已截断）";
            JSONObject o = new JSONObject();
            o.put("ok", true);
            o.put("text", text);
            o.put("chars", text.length());
            o.put("domain", PbClient.domainOf(url));
            String payload = o.toString();
            MEM_CACHE.put(url, payload);
            DiskCache.put(ctx, url, payload);
            return payload;
        } catch (Throwable t) {
            try {
                JSONObject o = new JSONObject();
                o.put("ok", false);
                String msg = t.getMessage();
                o.put("error", msg == null ? t.getClass().getSimpleName() : msg);
                return o.toString();
            } catch (Throwable ignored) {
                return "{\"ok\":false,\"error\":\"unknown\"}";
            }
        }
    }

    private void dispatch(final String cbId, final String payload) {
        final String js = "window.__ngaext&&window.__ngaext.onResult("
                + JSONObject.quote(cbId) + "," + JSONObject.quote(payload) + ");";
        webView.post(new Runnable() {
            @Override
            public void run() {
                try {
                    webView.evaluateJavascript(js, null);
                } catch (Throwable ignored) {
                }
            }
        });
    }
}
