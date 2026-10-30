package com.ngaext;

import android.webkit.WebView;

import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Collections;
import java.util.Map;
import java.util.WeakHashMap;

import de.robv.android.xposed.IXposedHookLoadPackage;
import de.robv.android.xposed.XC_MethodHook;
import de.robv.android.xposed.XposedBridge;
import de.robv.android.xposed.XposedHelpers;
import de.robv.android.xposed.callbacks.XC_LoadPackage;

public class NgaExtHook implements IXposedHookLoadPackage {

    private static final String TAG = "[ngaext] ";
    private static final String TARGET = "gov.pianzong.androidnga";
    private static final String BRIDGE_NAME = "NgaExtBridge";

    private static final Map<WebView, Boolean> INJECTED =
            Collections.synchronizedMap(new WeakHashMap<WebView, Boolean>());

    @Override
    public void handleLoadPackage(XC_LoadPackage.LoadPackageParam lpparam) {
        if (!TARGET.equals(lpparam.packageName)) return;
        XposedBridge.log(TAG + "loaded in " + lpparam.packageName);
        warmup();
        UpdateGuard.install(lpparam.classLoader);

        hookLoad(lpparam, "loadDataWithBaseURL", String.class, String.class, String.class, String.class, String.class);
        hookLoad(lpparam, "loadUrl", String.class);
        hookLoad(lpparam, "loadUrl", String.class, java.util.Map.class);
        hookLoad(lpparam, "postUrl", String.class, byte[].class);
        hookLoad(lpparam, "loadData", String.class, String.class, String.class);

        try {
            XposedHelpers.findAndHookMethod("android.webkit.WebViewClient", lpparam.classLoader,
                    "onPageStarted", WebView.class, String.class, android.graphics.Bitmap.class,
                    new XC_MethodHook() {
                        @Override
                        protected void beforeHookedMethod(MethodHookParam param) {
                            // 页面对 JS 可见之前注册接口
                            ensureInterface((WebView) param.args[0]);
                        }
                    });
        } catch (Throwable t) {
            XposedBridge.log(TAG + "hook onPageStarted failed: " + t);
        }

        try {
            XposedHelpers.findAndHookMethod("android.webkit.WebViewClient", lpparam.classLoader,
                    "onPageFinished", WebView.class, String.class, new XC_MethodHook() {
                        @Override
                        protected void afterHookedMethod(MethodHookParam param) {
                            inject((WebView) param.args[0]);
                        }
                    });
        } catch (Throwable t) {
            XposedBridge.log(TAG + "hook onPageFinished failed: " + t);
        }
    }

    private void hookLoad(XC_LoadPackage.LoadPackageParam lpparam, String method, Class<?>... params) {
        try {
            XposedHelpers.findAndHookMethod(WebView.class, method, merge(params, new XC_MethodHook() {
                @Override
                protected void beforeHookedMethod(MethodHookParam param) {
                    // 必须在 load 之前注册，否则当前文档拿不到 NgaExtBridge
                    ensureInterface((WebView) param.thisObject);
                }

                @Override
                protected void afterHookedMethod(MethodHookParam param) {
                    inject((WebView) param.thisObject);
                }
            }));
        } catch (Throwable t) {
            XposedBridge.log(TAG + "hook " + method + " failed: " + t);
        }
    }

    private static void ensureInterface(WebView webView) {
        if (webView == null) return;
        synchronized (INJECTED) {
            if (INJECTED.containsKey(webView)) return;
            try {
                webView.addJavascriptInterface(new Bridge(webView), BRIDGE_NAME);
                INJECTED.put(webView, Boolean.TRUE);
            } catch (Throwable t) {
                XposedBridge.log(TAG + "add bridge failed: " + t);
            }
        }
    }

    private static Object[] merge(Class<?>[] params, XC_MethodHook hook) {
        Object[] out = new Object[params.length + 1];
        System.arraycopy(params, 0, out, 0, params.length);
        out[params.length] = hook;
        return out;
    }

    private static volatile boolean warmed = false;

    /** 提前完成 DNS + TLS 握手，后续 6 条并发请求可复用会话，省掉每条的握手开销。 */
    private void warmup() {
        if (warmed) return;
        warmed = true;
        new Thread(new Runnable() {
            @Override
            public void run() {
                HttpURLConnection c = null;
                try {
                    c = (HttpURLConnection) new URL("https://bin.disroot.org/").openConnection();
                    c.setRequestMethod("HEAD");
                    c.setConnectTimeout(8000);
                    c.setReadTimeout(8000);
                    c.getResponseCode();
                    XposedBridge.log(TAG + "warmup ok");
                } catch (Throwable t) {
                    XposedBridge.log(TAG + "warmup failed: " + t);
                } finally {
                    if (c != null) c.disconnect();
                }
            }
        }, "ngaext-warmup").start();
    }

    private void inject(final WebView webView) {
        if (webView == null) return;
        ensureInterface(webView);
        final String prelude = versionPrelude();
        webView.post(new Runnable() {
            @Override
            public void run() {
                try {
                    ensureInterface(webView);
                    webView.evaluateJavascript(prelude + JsSource.SOURCE, null);
                } catch (Throwable t) {
                    XposedBridge.log(TAG + "inject failed: " + t);
                }
            }
        });
        // 页面可能随后才渲染出楼层，补一次
        webView.postDelayed(new Runnable() {
            @Override
            public void run() {
                try {
                    webView.evaluateJavascript(prelude + JsSource.SOURCE, null);
                } catch (Throwable ignored) {
                }
            }
        }, 1500);
    }

    /** 把运行中的 NGA 版本号传给前端，用于"未适配版本"提示 */
    private static String versionPrelude() {
        int targetCode = 90969;
        String targetName = "9.9.69";
        int code = 0;
        String name = "";
        try {
            Object app = XposedHelpers.callStaticMethod(
                    XposedHelpers.findClass("android.app.AndroidAppHelper", NgaExtHook.class.getClassLoader()),
                    "currentApplication");
            if (app != null) {
                android.content.pm.PackageInfo pi = ((android.content.Context) app).getPackageManager()
                        .getPackageInfo(TARGET, 0);
                code = pi.versionCode;
                name = pi.versionName;
            }
        } catch (Throwable ignored) {
        }
        boolean ok = (code == targetCode) || (code == 0);
        return "window.NGAEXT_VER={code:" + code + ",name:\"" + name + "\",targetCode:" + targetCode
                + ",targetName:\"" + targetName + "\",ok:" + ok + "};";
    }
}
