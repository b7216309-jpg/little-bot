package com.littlebot.app;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Keeps one quiet connection to Little Bot on the PC while the app is closed, turns its "notify" events into
 * notifications, and shares the phone's location and battery every few minutes when the user allows it.
 */
public class LiveService extends Service {
    static final String CHANNEL_MESSAGES = "messages";
    static final String CHANNEL_CONNECTION = "connection";
    static final String ACTION_REFRESH = "com.littlebot.app.REFRESH";
    static final String ACTION_SHARE_NOW = "com.littlebot.app.SHARE_NOW";
    private static final int ONGOING_ID = 1;
    private static final long LOCATION_INTERVAL_MS = 5 * 60 * 1000;
    private static final float LOCATION_DISTANCE_M = 100;
    private static final long CONTEXT_REFRESH_MS = 30 * 60 * 1000;

    static volatile boolean appVisible = false;
    static volatile String status = "";

    private final ExecutorService network = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private Thread stream;
    private volatile boolean running;
    private volatile HttpURLConnection current;
    private Location lastLocation;
    private boolean listening;

    private final LocationListener listener = this::onLocation;
    private final Runnable periodic = new Runnable() {
        @Override public void run() {
            shareContext();
            main.postDelayed(this, CONTEXT_REFRESH_MS);
        }
    };

    static void start(Context context) {
        if (!Prefs.paired(context)) return;
        context.startForegroundService(new Intent(context, LiveService.class));
    }

    static void refresh(Context context) {
        if (!Prefs.paired(context)) return;
        context.startForegroundService(new Intent(context, LiveService.class).setAction(ACTION_REFRESH));
    }

    static void stop(Context context) {
        context.stopService(new Intent(context, LiveService.class));
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override public void onCreate() {
        super.onCreate();
        createChannels(this);
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        Notification ongoing = new Notification.Builder(this, CHANNEL_CONNECTION)
                .setSmallIcon(R.drawable.ic_stat_bot)
                .setContentTitle("Little Bot")
                .setContentText("Connected to your PC")
                .setContentIntent(openApp(this, 0))
                .setOngoing(true)
                .build();
        if (Build.VERSION.SDK_INT >= 34) startForeground(ONGOING_ID, ongoing, ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING);
        else startForeground(ONGOING_ID, ongoing);
        if (!Prefs.paired(this)) { stopSelf(); return START_NOT_STICKY; }
        if (stream == null || !stream.isAlive()) {
            running = true;
            stream = new Thread(this::listen, "little-bot-stream");
            stream.start();
        }
        updateLocation();
        if (intent != null && ACTION_SHARE_NOW.equals(intent.getAction())) shareNow();
        return START_STICKY;
    }

    @Override public void onDestroy() {
        running = false;
        HttpURLConnection connection = current;
        if (connection != null) connection.disconnect();
        stopLocation();
        main.removeCallbacks(periodic);
        network.shutdownNow();
        super.onDestroy();
    }

    // Live connection: the PC sends {"type":"notify"} only while nobody is looking at the chat.
    private void listen() {
        long delay = 2000;
        while (running) {
            try {
                HttpURLConnection connection = (HttpURLConnection) new URL(Prefs.base(this) + "/api/events?background=1").openConnection();
                current = connection;
                connection.setConnectTimeout(15000);
                connection.setReadTimeout(70000); // The PC pings every 25 seconds.
                connection.setRequestProperty("Authorization", "Bearer " + Prefs.token(this));
                int code = connection.getResponseCode();
                if (code == 401) { unpairedRemotely(); return; }
                if (code != 200) throw new Exception("HTTP " + code);
                status = "connected";
                delay = 2000;
                try (BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8))) {
                    String line;
                    while (running && (line = reader.readLine()) != null) {
                        if (line.startsWith("data: ")) handle(line.substring(6));
                    }
                }
            } catch (Exception error) {
                status = "offline";
            }
            if (!running) return;
            try { Thread.sleep(delay); } catch (InterruptedException interrupted) { return; }
            delay = Math.min(delay * 2, 60000);
        }
    }

    private void handle(String data) {
        try {
            JSONObject event = new JSONObject(data);
            if (!"notify".equals(event.optString("type")) || appVisible) return;
            JSONArray notes = event.optJSONArray("notes");
            if (notes == null) return;
            for (int index = 0; index < notes.length(); index++) {
                JSONObject note = notes.getJSONObject(index);
                notifyUser(note.optString("title", "Little Bot"), note.optString("body", "New message"), note.optString("tag", "little-bot"));
            }
        } catch (Exception ignored) {
            // A malformed event is skipped; the next one still arrives.
        }
    }

    private void notifyUser(String title, String body, String tag) {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        Notification notification = new Notification.Builder(this, CHANNEL_MESSAGES)
                .setSmallIcon(R.drawable.ic_stat_bot)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new Notification.BigTextStyle().bigText(body))
                .setContentIntent(openApp(this, tag.hashCode()))
                .setAutoCancel(true)
                .setCategory(Notification.CATEGORY_MESSAGE)
                .build();
        manager.notify(tag, 2, notification);
    }

    private void unpairedRemotely() {
        Prefs.clear(this);
        running = false;
        main.post(this::stopSelf);
    }

    // Location
    private boolean locationAllowed() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private String provider(LocationManager manager) {
        if (Build.VERSION.SDK_INT >= 31 && manager.hasProvider(LocationManager.FUSED_PROVIDER)) return LocationManager.FUSED_PROVIDER;
        if (manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) return LocationManager.NETWORK_PROVIDER;
        return LocationManager.GPS_PROVIDER;
    }

    private void updateLocation() {
        if (Prefs.locationEnabled(this) && locationAllowed()) {
            if (listening) return;
            try {
                LocationManager manager = getSystemService(LocationManager.class);
                manager.requestLocationUpdates(provider(manager), LOCATION_INTERVAL_MS, LOCATION_DISTANCE_M, listener, Looper.getMainLooper());
                listening = true;
                main.removeCallbacks(periodic);
                main.post(periodic);
            } catch (SecurityException | IllegalArgumentException error) {
                listening = false;
            }
        } else stopLocation();
    }

    private void stopLocation() {
        if (!listening) return;
        try { getSystemService(LocationManager.class).removeUpdates(listener); } catch (Exception ignored) { /* Already stopped. */ }
        listening = false;
        main.removeCallbacks(periodic);
    }

    private void shareNow() {
        if (!Prefs.locationEnabled(this) || !locationAllowed()) return;
        try {
            LocationManager manager = getSystemService(LocationManager.class);
            manager.getCurrentLocation(provider(manager), null, getMainExecutor(), location -> { if (location != null) onLocation(location); });
        } catch (SecurityException ignored) {
            // Permission was withdrawn; the menu shows it.
        }
    }

    private void onLocation(Location location) {
        lastLocation = location;
        shareContext();
    }

    private void shareContext() {
        final Location location = lastLocation;
        final Context context = this;
        if (!Prefs.locationEnabled(this)) return;
        network.execute(() -> {
            try {
                JSONObject body = new JSONObject();
                if (location != null) {
                    JSONObject where = new JSONObject();
                    where.put("lat", location.getLatitude());
                    where.put("lon", location.getLongitude());
                    if (location.hasAccuracy()) where.put("accuracy", location.getAccuracy());
                    where.put("at", location.getTime());
                    body.put("location", where);
                }
                Intent battery = registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
                if (battery != null) {
                    int level = battery.getIntExtra(BatteryManager.EXTRA_LEVEL, -1), scale = battery.getIntExtra(BatteryManager.EXTRA_SCALE, 100);
                    int plugged = battery.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0);
                    if (level >= 0 && scale > 0) {
                        JSONObject power = new JSONObject();
                        power.put("level", level * 100.0 / scale);
                        power.put("charging", plugged != 0);
                        body.put("battery", power);
                    }
                }
                Api.post(context, "/api/context", body);
                Prefs.setLastShared(context, System.currentTimeMillis());
            } catch (Api.Unauthorized unauthorized) {
                unpairedRemotely();
            } catch (Exception ignored) {
                // The PC is offline; the next update retries.
            }
        });
    }

    // Helpers
    static PendingIntent openApp(Context context, int request) {
        Intent intent = new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(context, request, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    static void createChannels(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        NotificationChannel messages = new NotificationChannel(CHANNEL_MESSAGES, "Messages from Little Bot", NotificationManager.IMPORTANCE_HIGH);
        messages.setDescription("When Little Bot reaches out, replies, or needs an answer.");
        NotificationChannel connection = new NotificationChannel(CHANNEL_CONNECTION, "Connection to your PC", NotificationManager.IMPORTANCE_MIN);
        connection.setDescription("Shown while Little Bot keeps in touch with your PC. You can hide it.");
        connection.setShowBadge(false);
        manager.createNotificationChannel(messages);
        manager.createNotificationChannel(connection);
    }
}
