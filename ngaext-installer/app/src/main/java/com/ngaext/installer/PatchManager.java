package com.ngaext.installer;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.util.Log;

import com.android.apksig.ApkSigner;

import org.lsposed.patch.LSPatch;
import org.lsposed.patch.util.Logger;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.security.KeyStore;
import java.security.cert.Certificate;
import java.security.cert.X509Certificate;
import java.util.ArrayList;
import java.util.List;

/** 负责：读 NGA 的 APK -> 本地打补丁 -> 产出可安装的补丁包 */
public final class PatchManager {

    private static final String TAG = "NGAEXT";
    public static final String TARGET = "gov.pianzong.androidnga";

    public interface Callback {
        void onLog(String line);
        void onDone(File apk);
        void onError(String message);
    }

    private PatchManager() {}

    public static File targetApk(Context ctx) throws Exception {
        PackageInfo pi = ctx.getPackageManager().getPackageInfo(TARGET, 0);
        return new File(pi.applicationInfo.sourceDir);
    }

    /** 把内置的模块 APK 释放到缓存目录（每次补丁都重新释放，避免安装器升级后仍用旧模块） */
    public static File extractModule(Context ctx) throws Exception {
        File out = new File(ctx.getCacheDir(), "module.apk");
        try (InputStream in = ctx.getAssets().open("module.apk");
             FileOutputStream fos = new FileOutputStream(out)) {
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) fos.write(buf, 0, n);
        }
        return out;
    }

    /** 判断当前安装的 NGA 是否已经是改版（含 LSPatch 载荷） */
    static boolean isAlreadyPatched(File apk) {
        try (java.util.zip.ZipFile z = new java.util.zip.ZipFile(apk)) {
            java.util.Enumeration<? extends java.util.zip.ZipEntry> en = z.entries();
            while (en.hasMoreElements()) {
                String name = en.nextElement().getName();
                if (name.contains("liblspatch.so") || name.startsWith("assets/lspatch/")) return true;
            }
        } catch (Throwable ignored) {
        }
        return false;
    }
    /** 释放与电脑端 LSPatch 默认密钥一致的 BKS keystore，保证可以原地覆盖更新 */
    static File extractDefaultKeystore(Context ctx) throws Exception {
        File out = new File(ctx.getCacheDir(), "lspatch-keystore.bks");
        try (InputStream in = ctx.getAssets().open("default.bks");
             FileOutputStream fos = new FileOutputStream(out)) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) fos.write(buf, 0, n);
        }
        return out;
    }

    private static final String MODULE_ENTRY = "assets/lspatch/modules/com.ngaext.apk";
    // 调试开关：true 时跳过模块热替换，强制走完整 LSPatch 重打
    private static final boolean FORCE_FULL_PATCH = false;

    static boolean hasModuleEntry(File apk) {
        try (java.util.zip.ZipFile z = new java.util.zip.ZipFile(apk)) {
            return z.getEntry(MODULE_ENTRY) != null;
        } catch (Throwable t) {
            return false;
        }
    }

    /** 只替换已安装改版里的模块 APK，再用同一密钥重签；不需要重新打 LSPatch，登录不丢 */
    static File updatePatchedModule(Context ctx, File installed, File newModule, File outDir) throws Exception {
        File out = new File(outDir, "module-update.apk");
        java.security.Security.setProperty("keystore.type", "BKS");
        KeyStore keyStore = KeyStore.getInstance("BKS");
        File ksFile = extractDefaultKeystore(ctx);
        try (FileInputStream ksIn = new FileInputStream(ksFile)) {
            keyStore.load(ksIn, "123456".toCharArray());
        }
        KeyStore.PrivateKeyEntry entry = (KeyStore.PrivateKeyEntry) keyStore.getEntry(
                "key0", new KeyStore.PasswordProtection("123456".toCharArray()));
        Certificate[] chain = entry.getCertificateChain();
        X509Certificate[] certs = new X509Certificate[chain.length];
        for (int i = 0; i < chain.length; i++) certs[i] = (X509Certificate) chain[i];

        File unsigned = new File(outDir, "module-update-unsigned.apk");
        CountingOutputStream counter = new CountingOutputStream(
                new java.io.BufferedOutputStream(new FileOutputStream(unsigned), 1 << 16));
        try (java.util.zip.ZipFile zin = new java.util.zip.ZipFile(installed);
             java.util.zip.ZipOutputStream zout = new java.util.zip.ZipOutputStream(counter)) {
            java.util.Enumeration<? extends java.util.zip.ZipEntry> en = zin.entries();
            byte[] buf = new byte[1 << 16];
            boolean originCopied = false;
            while (en.hasMoreElements()) {
                java.util.zip.ZipEntry e = en.nextElement();
                String name = e.getName();
                if (name.equals("assets/lspatch/origin.apk")) originCopied = true;
                // origin.apk 是 LSPatch 运行时加载原应用代码所必需的，必须保留
                if (newModule != null && name.equals(MODULE_ENTRY)) continue;
                if (name.startsWith("META-INF/") && (
                        name.equals("META-INF/MANIFEST.MF")
                        || name.endsWith(".SF") || name.endsWith(".RSA") || name.endsWith(".DSA"))) {
                    continue;
                }
                java.util.zip.ZipEntry ne = new java.util.zip.ZipEntry(name);
                if (e.getMethod() == java.util.zip.ZipEntry.STORED) {
                    ne.setMethod(java.util.zip.ZipEntry.STORED);
                    ne.setSize(e.getSize());
                    ne.setCrc(e.getCrc());
                }
                alignEntry(counter.count, name, ne);
                zout.putNextEntry(ne);
                if (!e.isDirectory()) {
                    try (InputStream in = zin.getInputStream(e)) {
                        int n;
                        while ((n = in.read(buf)) > 0) zout.write(buf, 0, n);
                    }
                }
                zout.closeEntry();
            }
            if (!originCopied) {
                // 部分 ROM 的 ZipFile 枚举会跳过重叠的 origin 链接，单独补回去
                java.util.zip.ZipEntry oe = zin.getEntry("assets/lspatch/origin.apk");
                if (oe != null) {
                    java.util.zip.ZipEntry one = new java.util.zip.ZipEntry(oe.getName());
                    if (oe.getMethod() == java.util.zip.ZipEntry.STORED) {
                        one.setMethod(java.util.zip.ZipEntry.STORED);
                        one.setSize(oe.getSize());
                        one.setCrc(oe.getCrc());
                    }
                    alignEntry(counter.count, oe.getName(), one);
                    zout.putNextEntry(one);
                    try (InputStream in = zin.getInputStream(oe)) {
                        int n;
                        while ((n = in.read(buf)) > 0) zout.write(buf, 0, n);
                    }
                    zout.closeEntry();
                }
            }
            if (newModule != null) {
                java.util.zip.ZipEntry moduleEntry = new java.util.zip.ZipEntry(MODULE_ENTRY);
                alignEntry(counter.count, MODULE_ENTRY, moduleEntry);
                zout.putNextEntry(moduleEntry);
                try (InputStream moduleIn = new FileInputStream(newModule)) {
                    int n;
                    while ((n = moduleIn.read(buf)) > 0) zout.write(buf, 0, n);
                }
                zout.closeEntry();
            }
        }

        ApkSigner.SignerConfig signerConfig = new ApkSigner.SignerConfig.Builder(
                "key0", entry.getPrivateKey(), java.util.Collections.singletonList(certs[0])).build();
        new ApkSigner.Builder(java.util.Collections.singletonList(signerConfig))
                .setInputApk(unsigned)
                .setOutputApk(out)
                .setV1SigningEnabled(true)
                .setV2SigningEnabled(true)
                .setMinSdkVersion(28)
                .build()
                .sign();
        //noinspection ResultOfMethodCallIgnored
        unsigned.delete();
        return out;
    }

    /** 从已安装的改版 APK 里取出官方原版（LSPatch 会内嵌 assets/lspatch/origin.apk） */
    static File extractEmbeddedOrigin(Context ctx, File patchedApk) throws Exception {
        File out = new File(ctx.getCacheDir(), "origin.apk");
        try (java.util.zip.ZipFile z = new java.util.zip.ZipFile(patchedApk)) {
            java.util.zip.ZipEntry e = z.getEntry("assets/lspatch/origin.apk");
            if (e == null) {
                throw new IllegalStateException("当前改版中没有内置原版 APK，请先卸载 NGA 后安装官方版再打补丁");
            }
            try (InputStream in = z.getInputStream(e);
                 FileOutputStream fos = new FileOutputStream(out)) {
                byte[] buf = new byte[1 << 16];
                int n;
                while ((n = in.read(buf)) > 0) fos.write(buf, 0, n);
            }
        }
        if (out.length() < 10 * 1024 * 1024) {
            throw new IllegalStateException("内置原版 APK 异常");
        }
        return out;
    }

    /** 用标准 java.util.zip 重新打包，消除源 APK 的偏移怪癖（每次补丁都重建，避免 NGA 更新后仍用旧包） */
    static File normalize(Context ctx, File src) throws Exception {
        File out = new File(ctx.getCacheDir(), "base_norm.apk");
        java.util.zip.ZipFile zin = new java.util.zip.ZipFile(src);
        java.util.zip.ZipOutputStream zout = new java.util.zip.ZipOutputStream(
                new java.io.BufferedOutputStream(new FileOutputStream(out), 1 << 16));
        try {
            byte[] buf = new byte[1 << 16];
            java.util.Enumeration<? extends java.util.zip.ZipEntry> en = zin.entries();
            while (en.hasMoreElements()) {
                java.util.zip.ZipEntry e = en.nextElement();
                java.util.zip.ZipEntry ne = new java.util.zip.ZipEntry(e.getName());
                if (e.getMethod() == java.util.zip.ZipEntry.STORED) {
                    ne.setMethod(java.util.zip.ZipEntry.STORED);
                    ne.setSize(e.getSize());
                    ne.setCrc(e.getCrc());
                }
                zout.putNextEntry(ne);
                if (!e.isDirectory()) {
                    InputStream in = zin.getInputStream(e);
                    int n;
                    while ((n = in.read(buf)) > 0) zout.write(buf, 0, n);
                    in.close();
                }
                zout.closeEntry();
            }
        } finally {
            zout.close();
            zin.close();
        }
        return out;
    }
    private static void alignEntry(long offset, String name, java.util.zip.ZipEntry entry) {
        int align = name.endsWith(".so") ? 4096 : name.equals("resources.arsc") ? 4 : 1;
        if (align <= 1) return;
        int nameLen = name.getBytes(java.nio.charset.StandardCharsets.UTF_8).length;
        int pad = (int) ((align - ((offset + 30 + nameLen) % align)) % align);
        if (pad > 0 && pad < 4) pad += align;
        if (pad <= 0) return;
        byte[] extra = new byte[pad];
        // 自定义 extra 字段（Android 忽略），用于把本地头后的数据对齐
        extra[0] = (byte) 0xD9;
        extra[1] = 0x35;
        extra[2] = (byte) ((pad - 4) >>> 8);
        extra[3] = (byte) (pad - 4);
        entry.setExtra(extra);
    }

    private static final class CountingOutputStream extends java.io.FilterOutputStream {
        long count;
        CountingOutputStream(java.io.OutputStream out) { super(out); }
        @Override public void write(int b) throws java.io.IOException { out.write(b); count++; }
        @Override public void write(byte[] b, int off, int len) throws java.io.IOException {
            out.write(b, off, len);
            count += len;
        }
    }

    public static void build(Context ctx, Callback cb) {
        new Thread(() -> {
            try {
                System.setProperty("java.io.tmpdir", ctx.getCacheDir().getAbsolutePath());

                File installed = targetApk(ctx);
                if (!installed.canRead()) {
                    cb.onError("无法读取 NGA 的安装包（系统限制）。");
                    return;
                }
                File module = extractModule(ctx);
                File outDir = new File(ctx.getCacheDir(), "patch");
                if (!outDir.exists() && !outDir.mkdirs()) {
                    cb.onError("无法创建输出目录");
                    return;
                }
                File[] oldOutputs = outDir.listFiles();
                if (oldOutputs != null) {
                    for (File f : oldOutputs) f.delete();
                }

                // 已装改版：只替换内嵌模块并用同一密钥重签，速度最快且保留登录状态
                if (!FORCE_FULL_PATCH && hasModuleEntry(installed)) {
                    try {
                        cb.onLog("检测到已安装改版，替换模块并重签（保留登录）…");
                        File updated = updatePatchedModule(ctx, installed, module, outDir);
                        cb.onLog("生成成功: " + updated.getName() + " ("
                                + (updated.length() / 1024 / 1024) + " MB)");
                        cb.onDone(updated);
                        return;
                    } catch (Throwable t) {
                        Log.w(TAG, "module hot update failed, fallback to full patch", t);
                        cb.onLog("模块热替换失败，改用原版重打补丁…");
                    }
                }

                File src = installed;
                if (isAlreadyPatched(installed)) {
                    cb.onLog("检测到已安装改版，提取内置原版 APK 做原地更新…");
                    src = extractEmbeddedOrigin(ctx, installed);
                }
                cb.onLog("源 APK: " + src.getAbsolutePath());
                cb.onLog("大小: " + (src.length() / 1024 / 1024) + " MB");

                File local = new File(ctx.getCacheDir(), "base.apk");
                if (!local.exists() || local.length() != src.length()
                        || local.lastModified() < src.lastModified()) {
                    cb.onLog("复制安装包到本地缓存…");
                    try (java.io.FileInputStream in = new java.io.FileInputStream(src);
                         FileOutputStream out = new FileOutputStream(local)) {
                        byte[] buf = new byte[1 << 16];
                        int n;
                        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                    }
                    // 复制成功后对齐 mtime，避免下次误判为过期而重复复制 80MB
                    //noinspection ResultOfMethodCallIgnored
                    local.setLastModified(src.lastModified());
                }
                cb.onLog("本地副本: " + (local.length() / 1024 / 1024) + " MB");

                File normalized = normalize(ctx, local);
                cb.onLog("已重打包为规范 zip: " + (normalized.length() / 1024 / 1024) + " MB");

                cb.onLog("开始打补丁（约 30-90 秒）...");

                Logger logger = new Logger() {
                    @Override public void d(String s) { Log.d(TAG, s); }
                    @Override public void i(String s) { Log.i(TAG, s); if (s != null && s.trim().length() > 0) cb.onLog(s); }
                    @Override public void e(String s) { Log.e(TAG, String.valueOf(s)); if (s != null && s.trim().length() > 0) cb.onLog("! " + s); }
                };
                logger.verbose = true;

                List<String> args = new ArrayList<>();
                args.add("--output");
                args.add(outDir.getAbsolutePath());
                args.add("-m");
                args.add(module.getAbsolutePath());
                args.add("-l");
                // 与电脑端 install.ps1 的 -l 2 保持一致，启用签名绕过
                args.add("2");
                // 使用与电脑端 LSPatch 默认密钥相同的 keystore，才能原地覆盖更新
                args.add("-k");
                args.add(extractDefaultKeystore(ctx).getAbsolutePath());
                args.add("123456");
                args.add("key0");
                args.add("123456");
                args.add("--force");
                args.add(normalized.getAbsolutePath());

                // 安卓端用 BKS 读取与电脑端相同的默认密钥
                java.security.Security.setProperty("keystore.type", "BKS");
                new LSPatch(logger, args.toArray(new String[0])).doCommandLine();

                File[] outs = outDir.listFiles((d, name) -> name.endsWith(".apk"));
                if (outs == null || outs.length == 0) {
                    cb.onError("补丁包生成失败（没有输出文件）");
                    return;
                }
                File result = outs[0];
                // 部分 Android 版本要求 resources.arsc/so 对齐；重签时顺手修正
                try {
                    cb.onLog("修正 APK 对齐并重签…");
                    File aligned = updatePatchedModule(ctx, result, null, outDir);
                    //noinspection ResultOfMethodCallIgnored
                    result.delete();
                    result = aligned;
                } catch (Throwable t) {
                    Log.w(TAG, "align full patch failed", t);
                    cb.onLog("对齐修正失败，继续使用 LSPatch 原始输出");
                }
                new File(ctx.getCacheDir(), "base.apk").delete();
                new File(ctx.getCacheDir(), "base_norm.apk").delete();
                if (!src.equals(installed)) {
                    //noinspection ResultOfMethodCallIgnored
                    src.delete();
                }
                cb.onLog("生成成功: " + result.getName() + " (" + (result.length() / 1024 / 1024) + " MB)");
                cb.onDone(result);
            } catch (Throwable t) {
                Log.e(TAG, "patch failed", t);
                cb.onError(String.valueOf(t.getMessage() == null ? t : t.getMessage()));
            }
        }, "patch-worker").start();
    }
}
