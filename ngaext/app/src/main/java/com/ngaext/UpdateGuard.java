package com.ngaext;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;

import java.util.Map;

import de.robv.android.xposed.XC_MethodHook;
import de.robv.android.xposed.XposedBridge;
import de.robv.android.xposed.XposedHelpers;

/**
 * 更新守卫：
 * NGA 内更新下载完 APK 准备安装时，拦截安装并提示用户先卸载增强版（签名不同装不上），
 * 然后引导重新运行安装器，在新版官方包上重新打补丁。
 */
public final class UpdateGuard {

    private static final String TAG = "[ngaext] ";
    private static final String PKG = "gov.pianzong.androidnga";

    private static volatile boolean shown = false;

    private UpdateGuard() {}

    static void install(ClassLoader cl) {
        XC_MethodHook hook = new XC_MethodHook() {
            @Override
            protected void beforeHookedMethod(MethodHookParam param) {
                try {
                    Intent it = (Intent) param.args[0];
                    if (!isApkInstall(it)) return;
                    param.setResult(null);
                    XposedBridge.log(TAG + "blocked apk install intent: " + it);
                    prompt();
                } catch (Throwable t) {
                    XposedBridge.log(TAG + "guard error: " + t);
                }
            }
        };
        try {
            XposedHelpers.findAndHookMethod("android.content.ContextWrapper", cl,
                    "startActivity", Intent.class, hook);
            XposedHelpers.findAndHookMethod("android.content.ContextWrapper", cl,
                    "startActivity", Intent.class, Bundle.class, hook);
            XposedBridge.log(TAG + "update guard installed");
        } catch (Throwable t) {
            XposedBridge.log(TAG + "guard hook failed: " + t);
        }
    }

    private static boolean isApkInstall(Intent i) {
        if (i == null) return false;
        boolean apk = false;
        String type = i.getType();
        if (type != null && type.contains("package-archive")) apk = true;
        if (Intent.ACTION_INSTALL_PACKAGE.equals(i.getAction())) apk = true;
        if (i.getData() != null) {
            String s = i.getData().toString().toLowerCase();
            if (s.endsWith(".apk") || s.contains(".apk?")) apk = true;
        }
        if (!apk) return false;
        return looksLikeNga(i);
    }

    /** 只拦与 NGA 相关的安装包，避免误伤其他下载 */
    private static boolean looksLikeNga(Intent i) {
        StringBuilder sb = new StringBuilder();
        if (i.getData() != null) sb.append(i.getData());
        if (i.getClipData() != null) sb.append(' ').append(i.getClipData());
        CharSequence t = i.getStringExtra(Intent.EXTRA_TEXT);
        if (t != null) sb.append(' ').append(t);
        CharSequence s = i.getStringExtra(Intent.EXTRA_SUBJECT);
        if (s != null) sb.append(' ').append(s);
        String l = sb.toString().toLowerCase();
        return l.contains("nga") || l.contains("178.com") || l.contains("ngacn") || l.contains("pianzong");
    }

    private static void prompt() {
        if (shown) return;
        shown = true;
        new Handler(Looper.getMainLooper()).post(new Runnable() {
            @Override
            public void run() {
                try {
                    final Activity act = currentActivity();
                    if (act == null) {
                        shown = false;
                        return;
                    }
                    new AlertDialog.Builder(act)
                            .setTitle("NGA 更新被插件挡住了")
                            .setMessage("因为装了插件，官方更新装不进去。\n\n"
                                    + "请卸载 NGA，重新下载官方 NGA 本体装好，"
                                    + "再运行一次安装器把插件打上（如果你还需要这个插件的话）。\n\n"
                                    + "卸载会清掉登录状态。")
                            .setPositiveButton("卸载 NGA", new DialogInterface.OnClickListener() {
                                @Override
                                public void onClick(DialogInterface d, int which) {
                                    try {
                                        Intent del = new Intent(Intent.ACTION_DELETE, Uri.parse("package:" + PKG));
                                        del.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                                        act.startActivity(del);
                                    } catch (Throwable t) {
                                        XposedBridge.log(TAG + "uninstall failed: " + t);
                                    }
                                }
                            })
                            .setNegativeButton("稍后", null)
                            .setCancelable(true)
                            .show();
                } catch (Throwable t) {
                    XposedBridge.log(TAG + "dialog failed: " + t);
                    shown = false;
                }
            }
        });
    }

    @SuppressWarnings("unchecked")
    private static Activity currentActivity() {
        try {
            Class<?> at = Class.forName("android.app.ActivityThread");
            Object thread = XposedHelpers.callStaticMethod(at, "currentActivityThread");
            if (thread == null) return null;
            Map<Object, Object> acts = (Map<Object, Object>) XposedHelpers.getObjectField(thread, "mActivities");
            if (acts == null) return null;
            Activity last = null;
            for (Object rec : acts.values()) {
                Activity a = (Activity) XposedHelpers.getObjectField(rec, "activity");
                if (a != null && !a.isFinishing()) last = a;
            }
            return last;
        } catch (Throwable t) {
            return null;
        }
    }
}
