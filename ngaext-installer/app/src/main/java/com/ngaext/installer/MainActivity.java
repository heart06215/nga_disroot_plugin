package com.ngaext.installer;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.Gravity;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;

import androidx.core.content.FileProvider;

import java.io.File;

public class MainActivity extends Activity {

    private final Handler ui = new Handler(Looper.getMainLooper());
    private TextView status;
    private TextView log;
    private Button btnBuild, btnUninstall, btnInstall;
    private ProgressBar progress;
    private File patched;
    private boolean oneClickPending;
    private File pendingInstall;
    private int uninstallPolls;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(36, 48, 36, 36);
        root.setBackgroundColor(0xFFFBF7F0);

        TextView title = new TextView(this);
        title.setText("NGA 转译安装器");
        title.setTextSize(22);
        title.setTextColor(0xFF2F271C);

        status = new TextView(this);
        status.setText("一键安装：读取本机官方 NGA → 打插件 → 自动卸载 → 自动安装");
        status.setTextSize(14);
        status.setTextColor(0xFF8A6A22);
        status.setPadding(0, 12, 0, 16);

        TextView note = new TextView(this);
        note.setText("说明：官方版首次安装会先卸载（会清一次登录），随后自动打开安装确认。\n"
                + "已装同一密钥的改版则直接覆盖更新，通常保留登录。\n"
                + "全程在本机完成，不上传 NGA 安装包或账号数据。");
        note.setTextSize(12);
        note.setTextColor(0xFF6B5B45);
        note.setPadding(0, 0, 0, 20);

        btnBuild = new Button(this);
        btnBuild.setText("一键安装 / 更新 NGA 插件");
        btnBuild.setOnClickListener(v -> startBuild(true));

        btnUninstall = new Button(this);
        btnUninstall.setText("单独卸载 NGA（会清登录）");
        btnUninstall.setEnabled(false);
        btnUninstall.setOnClickListener(v -> uninstallTarget());

        btnInstall = new Button(this);
        btnInstall.setText("③ 安装补丁包");
        btnInstall.setEnabled(false);
        btnInstall.setOnClickListener(v -> installPatched());

        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setIndeterminate(true);
        progress.setVisibility(android.view.View.GONE);

        ScrollView scroll = new ScrollView(this);
        log = new TextView(this);
        log.setTextSize(11);
        log.setTextColor(0xFF5C4B33);
        log.setPadding(0, 16, 0, 0);
        scroll.addView(log);

        root.addView(title);
        root.addView(status);
        root.addView(note);
        root.addView(btnBuild);
        root.addView(btnUninstall);
        root.addView(btnInstall);
        root.addView(progress);

        Button diag = new Button(this);
        diag.setText("复制诊断信息");
        diag.setOnClickListener(v -> copyDiagnostics());
        root.addView(diag);
        root.addView(scroll, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f));
        setContentView(root);
        cleanupOldPatchCache();

        String savedPath = null;
        if (savedInstanceState != null) {
            savedPath = savedInstanceState.getString("patched");
        }
        if (savedPath == null) {
            savedPath = getPreferences(MODE_PRIVATE).getString("patched", null);
        }
        if (savedPath != null) {
            File f = new File(savedPath);
            if (f.exists()) {
                patched = f;
                btnInstall.setEnabled(true);
                btnUninstall.setEnabled(true);
                status.setText("已恢复上次生成的补丁包，可直接尝试安装");
            }
        }
    }

    /** 安装成功后清掉上一轮生成的补丁/临时 APK，避免缓存长期占空间 */
    private void cleanupOldPatchCache() {
        try {
            long lastUpdate = getPackageManager()
                    .getPackageInfo(PatchManager.TARGET, 0).lastUpdateTime;
            if (lastUpdate <= 0) return;
            File cache = getCacheDir();
            File[] roots = cache.listFiles();
            if (roots != null) {
                for (File f : roots) {
                    String n = f.getName();
                    if ((n.equals("base.apk") || n.equals("origin.apk")
                            || n.equals("base_norm.apk") || n.equals("lspatch-keystore.bks"))
                            && f.isFile() && f.lastModified() < lastUpdate) {
                        //noinspection ResultOfMethodCallIgnored
                        f.delete();
                    }
                }
            }
            File patchDir = new File(cache, "patch");
            File[] patches = patchDir.listFiles();
            if (patches != null) {
                for (File f : patches) {
                    if (f.isFile() && f.lastModified() < lastUpdate) {
                        //noinspection ResultOfMethodCallIgnored
                        f.delete();
                    }
                }
            }
        } catch (Throwable ignored) {
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (patched != null) outState.putString("patched", patched.getAbsolutePath());
    }

    private void append(String line) {
        ui.post(() -> log.append(line + "\n"));
    }

    private void copyDiagnostics() {
        try {
            String info = "NGAExt " + getPackageName() + " v" + getPackageManager()
                    .getPackageInfo(getPackageName(), 0).versionName
                    + "\nSDK " + android.os.Build.VERSION.SDK_INT
                    + " " + android.os.Build.MANUFACTURER + " " + android.os.Build.MODEL
                    + "\n--- log ---\n" + log.getText();
            android.content.ClipboardManager cm =
                    (android.content.ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
            cm.setPrimaryClip(android.content.ClipData.newPlainText("ngaext", info));
            status.setText("诊断信息已复制到剪贴板");
        } catch (Throwable t) {
            append("复制失败：" + t.getMessage());
        }
    }
    private void startBuild(boolean oneClick) {
        oneClickPending = oneClick;
        btnBuild.setEnabled(false);
        getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        progress.setVisibility(android.view.View.VISIBLE);
        status.setText("正在生成补丁包，请勿退出…");
        append("--- 开始 ---");
        PatchManager.build(this, new PatchManager.Callback() {
            @Override public void onLog(String line) { append(line); }
            @Override public void onDone(File apk) {
                patched = apk;
                getPreferences(MODE_PRIVATE).edit()
                        .putString("patched", apk.getAbsolutePath()).apply();
                final boolean auto = oneClickPending;
                oneClickPending = false;
                ui.post(() -> {
                    getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    progress.setVisibility(android.view.View.GONE);
                    btnBuild.setEnabled(true);
                    btnUninstall.setEnabled(true);
                    btnInstall.setEnabled(true);
                    append("补丁包已就绪：" + apk.getName());
                    if (!auto) {
                        status.setText("补丁包已生成，可手动安装");
                        return;
                    }
                    boolean alreadyPatched = false;
                    try {
                        alreadyPatched = PatchManager.hasModuleEntry(
                                PatchManager.targetApk(MainActivity.this));
                    } catch (Throwable ignored) {
                    }
                    if (alreadyPatched) {
                        // 同签名改版直接覆盖，避免多一次卸载和清登录
                        status.setText("正在打开安装确认…");
                        installPatched();
                    } else {
                        status.setText("正在打开卸载确认…");
                        uninstallThenInstall(apk);
                    }
                });
            }
            @Override public void onError(String message) {
                oneClickPending = false;
                ui.post(() -> {
                    getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    progress.setVisibility(android.view.View.GONE);
                    status.setText("生成失败");
                    btnBuild.setEnabled(true);
                    append("错误：" + message);
                });
            }
        });
    }

    /** 一键流程：先让系统卸载 NGA，包被移除后自动打开补丁安装确认 */
    private void uninstallThenInstall(File apk) {
        pendingInstall = apk;
        uninstallPolls = 0;
        try {
            Intent i = new Intent(Intent.ACTION_DELETE, Uri.parse("package:" + PatchManager.TARGET));
            startActivity(i);
            ui.postDelayed(this::pollAfterUninstall, 600);
        } catch (Throwable t) {
            append("无法打开卸载界面：" + t.getMessage());
            pendingInstall = null;
        }
    }

    private void pollAfterUninstall() {
        if (pendingInstall == null) return;
        if (!isTargetInstalled()) {
            File apk = pendingInstall;
            pendingInstall = null;
            patched = apk;
            status.setText("已卸载，正在打开安装确认…");
            installPatched();
            return;
        }
        if (++uninstallPolls > 120) {
            pendingInstall = null;
            status.setText("未检测到卸载完成，可稍后手动点“安装补丁包”");
            return;
        }
        ui.postDelayed(this::pollAfterUninstall, 500);
    }

    private boolean isTargetInstalled() {
        try {
            getPackageManager().getPackageInfo(PatchManager.TARGET, 0);
            return true;
        } catch (Throwable t) {
            return false;
        }
    }

    private void uninstallTarget() {
        try {
            Intent i = new Intent(Intent.ACTION_DELETE, Uri.parse("package:" + PatchManager.TARGET));
            startActivity(i);
            status.setText("步骤 3/3：卸载完成后，回来点“安装补丁包”");
            btnInstall.setEnabled(true);
        } catch (Throwable t) {
            append("无法打开卸载界面：" + t.getMessage());
        }
    }

    private void installPatched() {
        if (patched == null || !patched.exists()) {
            append("补丁包不存在，请重新生成");
            return;
        }
        if (android.os.Build.VERSION.SDK_INT >= 26
                && !getPackageManager().canRequestPackageInstalls()) {
            append("请先允许本应用安装未知来源应用");
            try {
                startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + getPackageName())));
            } catch (Throwable t) {
                append("请手动到系统设置里允许安装未知应用");
            }
            return;
        }
        try {
            Uri uri = FileProvider.getUriForFile(this,
                    "com.ngaext.installer.fileprovider", patched);
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(uri, "application/vnd.android.package-archive");
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
            status.setText("在系统弹窗中确认安装；如果提示签名不同，请先点②卸载再安装");
        } catch (Throwable t) {
            append("打开安装界面失败：" + t.getMessage());
        }
    }
}
