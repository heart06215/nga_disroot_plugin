package com.ngaext;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** 取密文 + 解密。密码可给多个候选，只抓一次密文，逐个尝试。 */
public final class PbClient {

    private static final int MAX_PASSWORDS = 6;
    private static final int MAX_KEY_LENGTHS = 4;

    private PbClient() {}

    public static String resolve(String urlWithFragment, String password) throws Exception {
        return resolveMulti(urlWithFragment, new String[]{password == null ? "" : password});
    }

    public static String resolveMulti(String urlWithFragment, String[] passwords) throws Exception {
        int hash = urlWithFragment.indexOf('#');
        if (hash < 0) throw new IllegalArgumentException("链接缺少解密密钥片段");
        String base = urlWithFragment.substring(0, hash);
        String fragment = urlWithFragment.substring(hash + 1).trim();
        if (fragment.isEmpty()) throw new IllegalArgumentException("解密密钥为空");

        // v1（2022 年前）用 base64 密钥，含 + / = 等非 base58 字符
        if (!fragment.matches("[1-9A-HJ-NP-Za-km-z]+")) {
            throw new IllegalArgumentException("检测到旧版（v1）加密格式，暂不支持");
        }

        String json = fetch(base);
        if (json.contains("\"status\":1")) throw new IllegalStateException("密文不存在或已过期");

        String[] pws = normalize(passwords);
        int[] lens = keyLengths(fragment);

        Exception last = null;
        for (String pw : pws) {
            for (int len : lens) {
                try {
                    return PbCrypto.decryptPaste(json, fragment.substring(0, len), pw);
                } catch (Exception e) {
                    last = e;
                }
            }
        }
        if (last != null) {
            String msg = last.getMessage();
            if (msg != null && msg.contains("GCM")) {
                throw new IllegalArgumentException("密码不匹配或密钥不完整");
            }
            throw new IllegalArgumentException(msg == null ? "解析失败" : msg);
        }
        throw new IllegalArgumentException("解析失败");
    }

    private static String[] normalize(String[] in) {
        if (in == null || in.length == 0) return new String[]{""};
        java.util.LinkedHashSet<String> set = new java.util.LinkedHashSet<>();
        // 先试无密码：大多数外链没有密码，可以避免为每条链接先跑多个 PBKDF2
        set.add("");
        for (String s : in) {
            if (s == null) continue;
            String v = s.trim();
            if (v.length() == 0) continue;
            set.add(v);
            if (set.size() >= MAX_PASSWORDS) break;
        }
        return set.toArray(new String[0]);
    }

    /** base58 密钥长度不固定（前导零会多字符），按 32 字节解码结果精确筛选 */
    private static int[] keyLengths(String fragment) {
        int max = Math.min(fragment.length(), 46);
        java.util.LinkedHashSet<Integer> set = new java.util.LinkedHashSet<>();
        // PrivateBin 的密钥是 32 字节，base58 长度只可能是 43..46。
        // 链接后面常紧跟 "PrivateBin" 等文字，不能直接取最长片段；
        // 用 base58 解码后的字节数过滤，避免漏掉 43 字符的合法密钥。
        for (int len : new int[]{44, 43, 45, 46}) {
            if (len > max) continue;
            try {
                if (PbCrypto.base58(fragment.substring(0, len)).length == 32) set.add(len);
            } catch (Throwable ignored) {
            }
        }
        if (set.isEmpty()) {
            for (int len : new int[]{max, 44, 43, 45, 46}) {
                if (len <= max && len >= 40) set.add(len);
            }
        }
        int[] out = new int[Math.min(set.size(), MAX_KEY_LENGTHS)];
        int i = 0;
        for (int v : set) {
            if (i >= out.length) break;
            out[i++] = v;
        }
        return out;
    }

    static String fetch(String url) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        try {
            c.setRequestMethod("GET");
            c.setConnectTimeout(15000);
            c.setReadTimeout(25000);
            c.setInstanceFollowRedirects(true);
            c.setRequestProperty("X-Requested-With", "JSONHttpRequest");
            c.setRequestProperty("Accept", "application/json");
            c.setRequestProperty("Connection", "keep-alive");
            c.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 12; wv) AppleWebKit/537.36");
            int code = c.getResponseCode();
            if (code != 200) throw new IOException("HTTP " + code);
            InputStream is = c.getInputStream();
            BufferedReader r = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = r.readLine()) != null) sb.append(line);
            r.close();
            String body = sb.toString();
            if (!body.isEmpty() && body.charAt(0) == '\uFEFF') body = body.substring(1);
            if (!body.trim().startsWith("{")) {
                throw new IOException("站点返回了非 PrivateBin 内容（可能正在维护或被拦截）");
            }
            // 成功读完响应后不要 disconnect，让 HttpURLConnection 复用 TLS 连接
            return body;
        } catch (IOException e) {
            c.disconnect();
            throw e;
        }
    }

    static String domainOf(String url) {
        try {
            return new URL(url).getHost();
        } catch (Exception e) {
            return "unknown";
        }
    }
}
