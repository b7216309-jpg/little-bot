package com.littlebot.app;

import android.content.Context;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** Small blocking JSON client for the Little Bot relay on the PC. Call off the main thread. */
final class Api {
    static final class Unauthorized extends Exception {
        Unauthorized() { super("This phone is no longer paired."); }
    }

    private Api() {}

    static JSONObject post(String base, String token, String path, JSONObject body) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(base + path).openConnection();
        connection.setConnectTimeout(10000);
        connection.setReadTimeout(20000);
        connection.setRequestMethod("POST");
        connection.setDoOutput(true);
        connection.setRequestProperty("Content-Type", "application/json");
        if (token != null && !token.isEmpty()) connection.setRequestProperty("Authorization", "Bearer " + token);
        byte[] data = body.toString().getBytes(StandardCharsets.UTF_8);
        try (OutputStream out = connection.getOutputStream()) { out.write(data); }
        int status = connection.getResponseCode();
        String text = read(status >= 400 ? connection.getErrorStream() : connection.getInputStream());
        connection.disconnect();
        if (status == 401 && token != null && !token.isEmpty()) throw new Unauthorized();
        JSONObject json = text.isEmpty() ? new JSONObject() : new JSONObject(text);
        if (status >= 400) throw new Exception(json.optString("error", "Little Bot answered " + status + "."));
        return json;
    }

    static JSONObject post(Context context, String path, JSONObject body) throws Exception {
        return post(Prefs.base(context), Prefs.token(context), path, body);
    }

    static String read(InputStream stream) throws Exception {
        if (stream == null) return "";
        try (InputStream in = stream; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int count;
            while ((count = in.read(buffer)) > 0) out.write(buffer, 0, count);
            return out.toString("UTF-8");
        }
    }

    /** Accepts https://host/#pair=CODE or littlebot://pair?base=...&code=... and returns {base, code}. */
    static String[] parsePairing(String link) {
        if (link == null) return null;
        link = link.trim();
        try {
            if (link.startsWith("littlebot://")) {
                android.net.Uri uri = android.net.Uri.parse(link);
                String base = uri.getQueryParameter("base"), code = uri.getQueryParameter("code");
                if (base != null && code != null && (base.startsWith("https://") || base.startsWith("http://"))) return new String[] { trimSlash(base), code };
                return null;
            }
            int hash = link.indexOf("#pair=");
            if ((link.startsWith("https://") || link.startsWith("http://")) && hash > 0) {
                URL url = new URL(link.substring(0, hash));
                String base = url.getProtocol() + "://" + url.getAuthority();
                String code = link.substring(hash + 6);
                if (code.matches("[A-Za-z0-9_-]{8,64}")) return new String[] { base, code };
            }
        } catch (Exception ignored) {
            return null;
        }
        return null;
    }

    static String trimSlash(String value) {
        while (value.endsWith("/")) value = value.substring(0, value.length() - 1);
        return value;
    }
}
