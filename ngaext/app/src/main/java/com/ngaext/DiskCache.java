package com.ngaext;

import android.content.Context;
import android.util.Log;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Comparator;

/** 解密结果磁盘缓存：PrivateBin 内容不可变，重复访问应瞬时返回。 */
final class DiskCache {

    private static final String TAG = "ngaext";
    private static final int MAX_FILES = 150;

    private DiskCache() {}

    private static File dir(Context ctx) {
        File d = new File(ctx.getCacheDir(), "ngaext");
        if (!d.exists() && !d.mkdirs()) return null;
        return d;
    }

    static String get(Context ctx, String url) {
        if (ctx == null) return null;
        try {
            File d = dir(ctx);
            if (d == null) return null;
            File f = new File(d, key(url) + ".json");
            if (!f.exists()) return null;
            byte[] b;
            try (FileInputStream in = new FileInputStream(f);
                 ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                b = out.toByteArray();
            }
            f.setLastModified(System.currentTimeMillis());
            return new String(b, StandardCharsets.UTF_8);
        } catch (Throwable t) {
            return null;
        }
    }

    static void put(Context ctx, String url, String payload) {
        if (ctx == null) return;
        try {
            File d = dir(ctx);
            if (d == null) return;
            File f = new File(d, key(url) + ".json");
            try (FileOutputStream out = new FileOutputStream(f)) {
                out.write(payload.getBytes(StandardCharsets.UTF_8));
            }
            trim(d);
        } catch (Throwable t) {
            Log.w(TAG, "disk cache write failed: " + t);
        }
    }

    private static void trim(File d) {
        File[] files = d.listFiles();
        if (files == null || files.length <= MAX_FILES) return;
        Arrays.sort(files, new Comparator<File>() {
            @Override
            public int compare(File a, File b) {
                return Long.compare(a.lastModified(), b.lastModified());
            }
        });
        int remove = files.length - MAX_FILES;
        for (int i = 0; i < remove; i++) {
            //noinspection ResultOfMethodCallIgnored
            files[i].delete();
        }
    }

    private static String key(String url) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] h = md.digest(url.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < 12; i++) sb.append(String.format("%02x", h[i]));
            return sb.toString();
        } catch (Exception e) {
            return Integer.toHexString(url.hashCode());
        }
    }
}
