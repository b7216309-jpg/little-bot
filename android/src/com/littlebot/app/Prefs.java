package com.littlebot.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Pairing and settings. The device token is encrypted with a key kept in the Android Keystore. */
final class Prefs {
    private static final String FILE = "little-bot";
    private static final String KEY_ALIAS = "little-bot-token";

    private Prefs() {}

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    static String base(Context context) { return prefs(context).getString("base", ""); }

    static boolean paired(Context context) { return !base(context).isEmpty() && !token(context).isEmpty(); }

    static void savePairing(Context context, String base, String token) {
        prefs(context).edit().putString("base", base).putString("token", encrypt(token)).apply();
    }

    static void clear(Context context) {
        prefs(context).edit().remove("base").remove("token").putBoolean("location", false).apply();
    }

    static String token(Context context) {
        String stored = prefs(context).getString("token", "");
        if (stored.isEmpty()) return "";
        try { return decrypt(stored); } catch (Exception error) { return ""; }
    }

    static boolean locationEnabled(Context context) { return prefs(context).getBoolean("location", false); }

    static void setLocationEnabled(Context context, boolean enabled) { prefs(context).edit().putBoolean("location", enabled).apply(); }

    static long lastShared(Context context) { return prefs(context).getLong("lastShared", 0); }

    static void setLastShared(Context context, long at) { prefs(context).edit().putLong("lastShared", at).apply(); }

    private static SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(KEY_ALIAS)) return ((KeyStore.SecretKeyEntry) store.getEntry(KEY_ALIAS, null)).getSecretKey();
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build());
        return generator.generateKey();
    }

    private static String encrypt(String value) {
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key());
            byte[] iv = cipher.getIV();
            byte[] data = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
            byte[] joined = new byte[iv.length + data.length];
            System.arraycopy(iv, 0, joined, 0, iv.length);
            System.arraycopy(data, 0, joined, iv.length, data.length);
            return Base64.encodeToString(joined, Base64.NO_WRAP);
        } catch (Exception error) {
            throw new IllegalStateException("Could not protect the pairing token.", error);
        }
    }

    private static String decrypt(String stored) throws Exception {
        byte[] joined = Base64.decode(stored, Base64.NO_WRAP);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, joined, 0, 12));
        return new String(cipher.doFinal(joined, 12, joined.length - 12), StandardCharsets.UTF_8);
    }
}
