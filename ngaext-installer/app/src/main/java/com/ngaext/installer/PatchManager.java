package com.ngaext.installer;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.util.Log;

import org.lsposed.patch.LSPatch;
import org.lsposed.patch.util.Logger;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
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
    /** 运行时生成 PKCS12 签名密钥库（安卓不支持桌面 JKS） */
    static File ensureKeystore(Context ctx) throws Exception {
        File out = new File(ctx.getCacheDir(), "ks.p12");
        // 优先每次从 assets 重新释放，保证安装器升级后使用新的密钥库
        try (InputStream in = ctx.getAssets().open("ks.p12");
             FileOutputStream fos = new FileOutputStream(out)) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) fos.write(buf, 0, n);
            java.security.Security.setProperty("keystore.type", "PKCS12");
            return out;
        } catch (Throwable ignored) {
            if (out.exists() && out.length() > 0) return out;
        }
        java.security.Security.addProvider(new org.bouncycastle.jce.provider.BouncyCastleProvider());
        java.security.KeyPairGenerator kpg = java.security.KeyPairGenerator.getInstance("RSA");
        kpg.initialize(2048);
        java.security.KeyPair kp = kpg.generateKeyPair();
        long now = System.currentTimeMillis();
        org.bouncycastle.asn1.x500.X500Name subj = new org.bouncycastle.asn1.x500.X500Name("CN=NGAExt");
        org.bouncycastle.cert.jcajce.JcaX509v3CertificateBuilder b =
            new org.bouncycastle.cert.jcajce.JcaX509v3CertificateBuilder(
                subj, java.math.BigInteger.valueOf(now),
                new java.util.Date(now - 86400000L),
                new java.util.Date(now + 30L * 365 * 86400000L),
                subj, kp.getPublic());
        org.bouncycastle.operator.ContentSigner cs =
            new org.bouncycastle.operator.jcajce.JcaContentSignerBuilder("SHA256withRSA")
                .build(kp.getPrivate());
        java.security.cert.X509Certificate cert =
            new org.bouncycastle.cert.jcajce.JcaX509CertificateConverter().getCertificate(b.build(cs));
        java.security.KeyStore ks = java.security.KeyStore.getInstance("PKCS12");
        ks.load(null, null);
        ks.setKeyEntry("key0", kp.getPrivate(), "123456".toCharArray(),
                new java.security.cert.Certificate[]{cert});
        try (FileOutputStream fos = new FileOutputStream(out)) {
            ks.store(fos, "123456".toCharArray());
        }
        java.security.Security.setProperty("keystore.type", "PKCS12");
        return out;
    }

    /** 释放内置签名密钥库 */
    static File extractKeystore(Context ctx) throws Exception {
        File out = new File(ctx.getCacheDir(), "keystore.bks");
        if (out.exists() && out.length() > 0) return out;
        try (InputStream in = ctx.getAssets().open("keystore");
             FileOutputStream fos = new FileOutputStream(out)) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) fos.write(buf, 0, n);
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
    public static void build(Context ctx, Callback cb) {
        new Thread(() -> {
            try {
                System.setProperty("java.io.tmpdir", ctx.getCacheDir().getAbsolutePath());

                File src = targetApk(ctx);
                cb.onLog("源 APK: " + src.getAbsolutePath());
                cb.onLog("大小: " + (src.length() / 1024 / 1024) + " MB");
                if (!src.canRead()) {
                    cb.onError("无法读取 NGA 的安装包（系统限制）。");
                    return;
                }

                if (isAlreadyPatched(src)) {
                    cb.onError("当前 NGA 已经是改版，无法再次打补丁。\n"
                            + "请先卸载 NGA，从应用商店安装官方版，再运行本安装器。");
                    return;
                }

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

                File module = extractModule(ctx);
                File outDir = new File(ctx.getCacheDir(), "patch");
                if (!outDir.exists() && !outDir.mkdirs()) {
                    cb.onError("无法创建输出目录");
                    return;
                }
                for (File f : outDir.listFiles()) f.delete();

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
                args.add("-k");
                args.add(ensureKeystore(ctx).getAbsolutePath());
                java.security.Security.setProperty("keystore.type", "PKCS12");
                args.add("123456");
                args.add("key0");
                args.add("123456");
                args.add("--force");
                args.add(normalized.getAbsolutePath());

                new LSPatch(logger, args.toArray(new String[0])).doCommandLine();

                File[] outs = outDir.listFiles((d, name) -> name.endsWith(".apk"));
                if (outs == null || outs.length == 0) {
                    cb.onError("补丁包生成失败（没有输出文件）");
                    return;
                }
                File result = outs[0];
                new File(ctx.getCacheDir(), "base.apk").delete();
                new File(ctx.getCacheDir(), "base_norm.apk").delete();
                cb.onLog("生成成功: " + result.getName() + " (" + (result.length() / 1024 / 1024) + " MB)");
                cb.onDone(result);
            } catch (Throwable t) {
                Log.e(TAG, "patch failed", t);
                cb.onError(String.valueOf(t.getMessage() == null ? t : t.getMessage()));
            }
        }, "patch-worker").start();
    }
}
