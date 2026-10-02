package com.littlebot.app;

import android.Manifest;
import android.app.Activity;
import android.content.ClipboardManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** The chat (the PC's own phone web app, in a WebView), pairing, and the permission flows. */
public class MainActivity extends Activity {
    private static final int REQUEST_NOTIFICATIONS = 1;
    private static final int REQUEST_LOCATION = 2;
    private static final int REQUEST_BACKGROUND_LOCATION = 3;

    private final ExecutorService network = Executors.newSingleThreadExecutor();
    private FrameLayout root;
    private WebView web;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        if (getActionBar() != null) getActionBar().hide();
        getWindow().setStatusBarColor(Color.parseColor("#242d2a"));
        getWindow().setNavigationBarColor(dark() ? Color.parseColor("#171c1a") : Color.parseColor("#fcfbf8"));
        root = new FrameLayout(this);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return WindowInsets.CONSUMED;
        });
        setContentView(root);
        LiveService.createChannels(this);
        if (!handlePairingIntent(getIntent())) show();
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handlePairingIntent(intent);
    }

    @Override protected void onResume() {
        super.onResume();
        LiveService.appVisible = true;
        if (web != null) web.evaluateJavascript("window.littleBotNativeChanged && window.littleBotNativeChanged()", null);
    }

    @Override protected void onPause() {
        LiveService.appVisible = false;
        super.onPause();
    }

    @Override public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else moveTaskToBack(true);
    }

    private boolean dark() {
        return (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
    }

    private void show() {
        if (Prefs.paired(this)) showChat(); else showSetup(null);
    }

    // Pairing
    private boolean handlePairingIntent(Intent intent) {
        Uri data = intent == null ? null : intent.getData();
        if (data == null || !"littlebot".equals(data.getScheme())) return false;
        String[] pairing = Api.parsePairing(data.toString());
        if (pairing == null) { showSetup("This pairing link is not valid."); return true; }
        pair(pairing[0], pairing[1]);
        return true;
    }

    private void pair(String base, String code) {
        showMessage("Pairing with your PC…");
        network.execute(() -> {
            try {
                JSONObject body = new JSONObject();
                body.put("code", code);
                body.put("name", Build.MODEL);
                JSONObject result = Api.post(base, null, "/api/pair", body);
                String token = result.getString("token");
                Prefs.savePairing(this, base, token);
                runOnUiThread(() -> {
                    Toast.makeText(this, "Paired with Little Bot", Toast.LENGTH_SHORT).show();
                    showChat();
                    askNotifications();
                });
            } catch (Exception error) {
                runOnUiThread(() -> showSetup(error.getMessage()));
            }
        });
    }

    private void showSetup(String error) {
        destroyWeb();
        LiveService.stop(this);
        LinearLayout column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setGravity(Gravity.CENTER_HORIZONTAL);
        int pad = dp(28);
        column.setPadding(pad, dp(64), pad, pad);
        ImageView logo = new ImageView(this);
        logo.setImageResource(R.mipmap.ic_launcher);
        column.addView(logo, new LinearLayout.LayoutParams(dp(88), dp(88)));
        TextView title = text("Pair with your PC", 24, true);
        title.setPadding(0, dp(20), 0, dp(10));
        column.addView(title);
        column.addView(text("On your PC, open Little Bot › Settings › Phone relay › Pair a phone. Scan the QR code with your camera, open it in Chrome, and tap “Pair the Android app instead”.\n\nOr copy the pairing link and paste it here:", 15, false));
        EditText link = new EditText(this);
        link.setHint("https://…/#pair=…");
        link.setSingleLine(true);
        link.setInputType(InputType.TYPE_TEXT_VARIATION_URI);
        ClipboardManager clipboard = getSystemService(ClipboardManager.class);
        if (clipboard != null && clipboard.hasPrimaryClip() && clipboard.getPrimaryClip().getItemCount() > 0) {
            CharSequence copied = clipboard.getPrimaryClip().getItemAt(0).getText();
            if (copied != null && Api.parsePairing(copied.toString()) != null) link.setText(copied);
        }
        LinearLayout.LayoutParams wide = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        wide.topMargin = dp(16);
        column.addView(link, wide);
        Button button = new Button(this);
        button.setText("Pair");
        button.setOnClickListener(view -> {
            String[] pairing = Api.parsePairing(link.getText().toString());
            if (pairing == null) Toast.makeText(this, "Paste the whole pairing link from your PC.", Toast.LENGTH_LONG).show();
            else pair(pairing[0], pairing[1]);
        });
        column.addView(button, wide);
        if (error != null) {
            TextView problem = text(error, 14, false);
            problem.setTextColor(Color.parseColor("#c4533e"));
            problem.setPadding(0, dp(14), 0, 0);
            column.addView(problem);
        }
        root.removeAllViews();
        root.setBackgroundColor(dark() ? Color.parseColor("#171c1a") : Color.parseColor("#fcfbf8"));
        root.addView(column);
    }

    private void showMessage(String message) {
        destroyWeb();
        TextView view = text(message, 16, false);
        view.setGravity(Gravity.CENTER);
        root.removeAllViews();
        root.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    private TextView text(String value, int size, boolean bold) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(dark() ? Color.parseColor("#ecebe5") : Color.parseColor("#242d2a"));
        view.setGravity(Gravity.CENTER_HORIZONTAL);
        if (bold) view.setTypeface(view.getTypeface(), android.graphics.Typeface.BOLD);
        return view;
    }

    // Chat
    private void showChat() {
        destroyWeb();
        web = new WebView(this);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        final String base = Prefs.base(this);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (url.toString().startsWith(base + "/")) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, url)); } catch (Exception ignored) { /* No app for this link. */ }
                return true;
            }
        });
        web.addJavascriptInterface(new Bridge(), "LittleBotNative");
        web.setBackgroundColor(dark() ? Color.parseColor("#171c1a") : Color.parseColor("#fcfbf8"));
        root.removeAllViews();
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        web.loadUrl(base + "/");
        LiveService.start(this);
    }

    private void destroyWeb() {
        if (web == null) return;
        root.removeView(web);
        web.destroy();
        web = null;
    }

    private void askNotifications() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, REQUEST_NOTIFICATIONS);
        }
    }

    // Location: while-in-use first, then "Allow all the time" so it keeps working when the app is closed.
    private void enableLocation() {
        Prefs.setLocationEnabled(this, true);
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED
                && checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[] { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }, REQUEST_LOCATION);
            return;
        }
        if (checkSelfPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            Toast.makeText(this, "Choose “Allow all the time” so Little Bot knows when you leave or get home.", Toast.LENGTH_LONG).show();
            requestPermissions(new String[] { Manifest.permission.ACCESS_BACKGROUND_LOCATION }, REQUEST_BACKGROUND_LOCATION);
            return;
        }
        LiveService.refresh(this);
        shareNow();
    }

    private void shareNow() {
        if (!Prefs.paired(this)) return;
        startForegroundService(new Intent(this, LiveService.class).setAction(LiveService.ACTION_SHARE_NOW));
    }

    @Override public void onRequestPermissionsResult(int request, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(request, permissions, results);
        boolean granted = results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED;
        if (request == REQUEST_LOCATION) {
            if (granted) enableLocation();
            else { Prefs.setLocationEnabled(this, false); Toast.makeText(this, "Location stays off.", Toast.LENGTH_SHORT).show(); }
        } else if (request == REQUEST_BACKGROUND_LOCATION) {
            // Without "all the time", sharing still works while the app is open.
            LiveService.refresh(this);
            shareNow();
        }
        if (web != null) web.evaluateJavascript("window.littleBotNativeChanged && window.littleBotNativeChanged()", null);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    /** Called from the chat page. Only the PC's own page is ever loaded in this WebView. */
    private final class Bridge {
        @JavascriptInterface public String token() { return Prefs.token(MainActivity.this); }

        @JavascriptInterface public void unpaired() {
            runOnUiThread(() -> {
                Prefs.clear(MainActivity.this);
                showSetup(null);
            });
        }

        @JavascriptInterface public boolean locationEnabled() { return Prefs.locationEnabled(MainActivity.this); }

        @JavascriptInterface public void setLocationEnabled(boolean enabled) {
            runOnUiThread(() -> {
                if (enabled) enableLocation();
                else {
                    Prefs.setLocationEnabled(MainActivity.this, false);
                    LiveService.refresh(MainActivity.this);
                }
            });
        }

        @JavascriptInterface public void shareNow() { runOnUiThread(MainActivity.this::shareNow); }

        @JavascriptInterface public String locationStatus() {
            MainActivity activity = MainActivity.this;
            if (!Prefs.locationEnabled(activity)) return "Little Bot does not see your location. Share it so it knows when you are home or out.";
            boolean allowed = activity.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                    || activity.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
            if (!allowed) return "Location permission is off for Little Bot in Android settings.";
            boolean always = activity.checkSelfPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED;
            long last = Prefs.lastShared(activity);
            String when = last == 0 ? "not sent yet" : "last sent " + Math.max(0, (System.currentTimeMillis() - last) / 60000) + " min ago";
            return "Sharing your location with your PC every few minutes (" + when + ")."
                    + (always ? "" : " Allow location “All the time” in Android settings so it also works when the app is closed.");
        }
    }
}
