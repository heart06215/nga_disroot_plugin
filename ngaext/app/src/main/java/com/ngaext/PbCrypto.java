package com.ngaext;

import android.util.Base64;

import java.io.ByteArrayOutputStream;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.zip.Inflater;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * PrivateBin v2 解密器（AES-GCM + PBKDF2-SHA256）。
 * 关键点：
 *  - URL fragment 是 base58 编码的 32 字节密钥（左补 NUL）
 *  - 若填了密码，密钥字节后拼接密码字节一起作为 PBKDF2 的口令
 *  - AAD 是完整的 adata 数组 JSON 文本
 *  - 压缩字段写 zlib，实际是 raw deflate
 */
public final class PbCrypto {

    private static final String B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

    private PbCrypto() {}

    public static String decryptPaste(String json, String fragment, String password) throws Exception {
        long t1 = System.currentTimeMillis();
        String ctB64 = jsonField(json, "ct");
        int a = json.indexOf("\"adata\":");
        if (ctB64 == null || a < 0) throw new IllegalArgumentException("不是有效的 PrivateBin 响应");

        // 不能假设 "meta" 紧跟 adata：paste.to 等实例的顺序是 adata,v,ct,meta。
        // AAD 必须是完整的 adata 外层数组文本，按括号配对截取。
        int start = json.indexOf('[', a + 8);
        String arr = extractArray(json, start);
        if (arr == null) throw new IllegalArgumentException("adata 解析失败");
        String adataRaw = unescapeJson(arr);
        String inner = firstArray(adataRaw);
        if (inner == null) throw new IllegalArgumentException("adata 解析失败");

        String[] parts = inner.substring(1, inner.length() - 1).split(",");
        if (parts.length < 8) throw new IllegalArgumentException("adata 字段不足");

        byte[] iv = decodeB64(parts[0].replace("\"", ""));
        byte[] salt = decodeB64(parts[1].replace("\"", ""));
        int iterations = Integer.parseInt(parts[2].trim());
        int keyBits = Integer.parseInt(parts[3].trim());
        String compression = parts[7].replace("\"", "");

        byte[] keyBytes = pad32(base58(fragment));
        byte[] secret;
        if (password != null && password.length() > 0) {
            byte[] pw = password.getBytes(StandardCharsets.UTF_8);
            secret = new byte[keyBytes.length + pw.length];
            System.arraycopy(keyBytes, 0, secret, 0, keyBytes.length);
            System.arraycopy(pw, 0, secret, keyBytes.length, pw.length);
        } else {
            secret = keyBytes;
        }

        byte[] aesKey = pbkdf2(secret, salt, iterations, keyBits / 8);
        long t2 = System.currentTimeMillis();
        byte[] plain = gcm(aesKey, iv, adataRaw.getBytes(StandardCharsets.UTF_8), decodeB64(ctB64));
        long t3 = System.currentTimeMillis();
        android.util.Log.i("ngaext", "crypto pbkdf2=" + (t2 - t1) + "ms gcm=" + (t3 - t2) + "ms");

        byte[] inflated = "zlib".equals(compression) ? inflateRaw(plain) : null;
        byte[] payload = (inflated != null && inflated.length > 0) ? inflated : plain;
        String text = new String(payload, StandardCharsets.UTF_8);

        String body = extractPasteField(text);
        return body != null ? body : text;
    }

    private static byte[] decodeB64(String s) {
        return Base64.decode(s, Base64.DEFAULT);
    }

    static byte[] base58(String s) {
        BigInteger n = BigInteger.ZERO;
        BigInteger base = BigInteger.valueOf(58);
        for (int i = 0; i < s.length(); i++) {
            int d = B58.indexOf(s.charAt(i));
            if (d < 0) throw new IllegalArgumentException("非法 base58 字符: " + s.charAt(i));
            n = n.multiply(base).add(BigInteger.valueOf(d));
        }
        byte[] mag = n.toByteArray();
        if (mag.length > 1 && mag[0] == 0) mag = Arrays.copyOfRange(mag, 1, mag.length);
        int zeros = 0;
        while (zeros < s.length() && s.charAt(zeros) == '1') zeros++;
        byte[] out = new byte[zeros + mag.length];
        System.arraycopy(mag, 0, out, zeros, mag.length);
        return out;
    }

    static byte[] pad32(byte[] in) {
        if (in.length == 32) return in;
        if (in.length > 32) throw new IllegalArgumentException("密钥长度异常: " + in.length);
        byte[] out = new byte[32];
        System.arraycopy(in, 0, out, 32 - in.length, in.length);
        return out;
    }

    static byte[] pbkdf2(byte[] secret, byte[] salt, int iterations, int keyLen) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        byte[] k = secret.length > 64 ? md.digest(secret) : secret;
        byte[] ipad = new byte[64];
        byte[] opad = new byte[64];
        Arrays.fill(ipad, (byte) 0x36);
        Arrays.fill(opad, (byte) 0x5c);
        for (int i = 0; i < k.length; i++) {
            ipad[i] ^= k[i];
            opad[i] ^= k[i];
        }
        int blocks = (keyLen + 31) / 32;
        byte[] out = new byte[blocks * 32];
        byte[] u1 = new byte[32];
        byte[] u2 = new byte[32];
        byte[] t = new byte[32];
        byte[] inner = new byte[32];
        byte[] counter = new byte[4];
        for (int b = 1; b <= blocks; b++) {
            counter[0] = (byte) (b >>> 24);
            counter[1] = (byte) (b >>> 16);
            counter[2] = (byte) (b >>> 8);
            counter[3] = (byte) b;
            hmac2(md, ipad, opad, salt, counter, inner, u1);
            System.arraycopy(u1, 0, t, 0, 32);
            for (int c = 1; c < iterations; c++) {
                hmac1(md, ipad, opad, u1, inner, u2);
                for (int i = 0; i < 32; i++) t[i] ^= u2[i];
                byte[] swap = u1;
                u1 = u2;
                u2 = swap;
            }
            System.arraycopy(t, 0, out, (b - 1) * 32, 32);
        }
        return keyLen == out.length ? out : Arrays.copyOf(out, keyLen);
    }

    private static void hmac2(MessageDigest md, byte[] ipad, byte[] opad, byte[] p1, byte[] p2, byte[] inner, byte[] out) throws Exception {
        md.update(ipad);
        md.update(p1);
        md.update(p2);
        md.digest(inner, 0, 32);
        md.update(opad);
        md.update(inner);
        md.digest(out, 0, 32);
    }

    private static void hmac1(MessageDigest md, byte[] ipad, byte[] opad, byte[] p1, byte[] inner, byte[] out) throws Exception {
        md.update(ipad);
        md.update(p1);
        md.digest(inner, 0, 32);
        md.update(opad);
        md.update(inner);
        md.digest(out, 0, 32);
    }

    static byte[] gcm(byte[] key, byte[] iv, byte[] aad, byte[] ct) throws Exception {
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, iv));
        if (aad != null && aad.length > 0) c.updateAAD(aad);
        return c.doFinal(ct);
    }

    static byte[] inflateRaw(byte[] in) {
        try {
            Inflater inf = new Inflater(true);
            inf.setInput(in);
            byte[] buf = new byte[8192];
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            while (!inf.finished()) {
                int n = inf.inflate(buf);
                if (n == 0) {
                    if (inf.needsInput() || inf.needsDictionary()) break;
                }
                out.write(buf, 0, n);
            }
            inf.end();
            return out.toByteArray();
        } catch (Exception e) {
            return null;
        }
    }

    /** 服务端会把 base64 里的 / 转义成 \/，AAD 必须用反转义后的 JSON 文本 */
    static String unescapeJson(String s) {
        StringBuilder sb = new StringBuilder(s.length());
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '\\' && i + 1 < s.length()) {
                char e = s.charAt(i + 1);
                switch (e) {
                    case 'n': sb.append('\n'); i++; break;
                    case 'r': sb.append('\r'); i++; break;
                    case 't': sb.append('\t'); i++; break;
                    case 'b': sb.append('\b'); i++; break;
                    case 'f': sb.append('\f'); i++; break;
                    case 'u': {
                        boolean ok = false;
                        if (i + 5 < s.length()) {
                            try {
                                sb.append((char) Integer.parseInt(s.substring(i + 2, i + 6), 16));
                                i += 5;
                                ok = true;
                            } catch (NumberFormatException ignored) { }
                        }
                        if (!ok) { sb.append(e); i++; }
                        break;
                    }
                    default: sb.append(e); i++;
                }
            } else {
                sb.append(c);
            }
        }
        return sb.toString();
    }

    /** 从 JSON 原文中截取从 start 开始的完整数组（按括号配对，忽略字符串内的括号） */
    static String extractArray(String json, int start) {
        if (json == null || start < 0 || start >= json.length() || json.charAt(start) != '[') return null;
        int depth = 0;
        boolean inStr = false, esc = false;
        for (int i = start; i < json.length(); i++) {
            char c = json.charAt(i);
            if (inStr) {
                if (esc) esc = false;
                else if (c == '\\') esc = true;
                else if (c == '"') inStr = false;
            } else {
                if (c == '"') inStr = true;
                else if (c == '[') depth++;
                else if (c == ']') {
                    depth--;
                    if (depth == 0) return json.substring(start, i + 1);
                }
            }
        }
        return null;
    }

    static String firstArray(String s) {
        int depth = 0, start = -1;
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '[') {
                depth++;
                if (depth == 2 && start < 0) start = i;
            } else if (c == ']') {
                depth--;
                if (depth == 1 && start >= 0) return s.substring(start, i + 1);
            }
        }
        return null;
    }

    static String jsonField(String json, String field) {
        String pat = "\"" + field + "\":";
        int i = json.indexOf(pat);
        if (i < 0) return null;
        i += pat.length();
        if (i >= json.length() || json.charAt(i) != '"') return null;
        int j = i + 1;
        StringBuilder sb = new StringBuilder();
        while (j < json.length()) {
            char c = json.charAt(j);
            if (c == '\\') {
                if (j + 1 < json.length()) sb.append(json.charAt(j + 1));
                j += 2;
                continue;
            }
            if (c == '"') break;
            sb.append(c);
            j++;
        }
        return sb.toString();
    }

    /** 明文通常是 {"paste":"..."}，抽出 paste 并做 JSON 反转义 */
    static String extractPasteField(String text) {
        String pat = "\"paste\"";
        int i = text.indexOf(pat);
        if (i < 0) return null;
        i = text.indexOf(':', i + pat.length());
        if (i < 0) return null;
        i++;
        while (i < text.length() && Character.isWhitespace(text.charAt(i))) i++;
        if (i >= text.length() || text.charAt(i) != '"') return null;
        i++;
        StringBuilder sb = new StringBuilder();
        while (i < text.length()) {
            char c = text.charAt(i);
            if (c == '\\') {
                i++;
                if (i >= text.length()) break;
                char e = text.charAt(i);
                switch (e) {
                    case 'n': sb.append('\n'); break;
                    case 'r': sb.append('\r'); break;
                    case 't': sb.append('\t'); break;
                    case 'b': sb.append('\b'); break;
                    case 'f': sb.append('\f'); break;
                    case 'u':
                        if (i + 4 < text.length()) {
                            try {
                                sb.append((char) Integer.parseInt(text.substring(i + 1, i + 5), 16));
                                i += 4;
                            } catch (NumberFormatException ignored) { }
                        }
                        break;
                    default: sb.append(e);
                }
                i++;
                continue;
            }
            if (c == '"') break;
            sb.append(c);
            i++;
        }
        return sb.toString();
    }
}
