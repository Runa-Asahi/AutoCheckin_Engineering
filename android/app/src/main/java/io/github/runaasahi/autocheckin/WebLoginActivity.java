package io.github.runaasahi.autocheckin;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.util.ArrayList;
import org.json.JSONObject;

/**
 * 应用内登录页：只允许打开平台官方域名（https），其它链接一律拦截。
 * 每秒检查一次登录 Cookie，齐全后返回并立即清空 WebView 的 Cookie/存储，登录信息只保存在加密存储里。
 */
public class WebLoginActivity extends Activity {
    static final String EXTRA_URL = "url";
    static final String EXTRA_DOMAINS = "domains";
    static final String EXTRA_REQUIRED = "required";
    static final String EXTRA_COOKIE_URLS = "cookieUrls";
    static final String RESULT_COOKIES = "cookies";

    private final Handler handler = new Handler(Looper.getMainLooper());
    private WebView webView;
    private ArrayList<String> domains, required, cookieUrls;
    private boolean finished = false;

    private final Runnable poll = new Runnable() {
        @Override public void run() {
            if (finished) return;
            JSONObject jar = collect();
            boolean complete = true;
            for (String name : required) {
                String value = jar.optString(name, "");
                if (value.isEmpty() || value.equals("0") || value.equals("deleted")) { complete = false; break; }
            }
            if (complete) { done(RESULT_OK, jar.toString()); return; }
            handler.postDelayed(this, 1000);
        }
    };

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);
        setTitle("登录");
        Intent intent = getIntent();
        domains = intent.getStringArrayListExtra(EXTRA_DOMAINS);
        required = intent.getStringArrayListExtra(EXTRA_REQUIRED);
        cookieUrls = intent.getStringArrayListExtra(EXTRA_COOKIE_URLS);
        String url = intent.getStringExtra(EXTRA_URL);
        if (domains == null || required == null || cookieUrls == null || url == null || !allowed(url)) { done(RESULT_CANCELED, null); return; }

        clearWebData();
        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !allowed(request.getUrl().toString()); // true = 拦截
            }
        });
        setContentView(webView);
        webView.loadUrl(url);
        handler.postDelayed(poll, 1000);
    }

    private boolean allowed(String raw) {
        try {
            Uri uri = Uri.parse(raw);
            if (!"https".equals(uri.getScheme()) || uri.getHost() == null) return false;
            String host = uri.getHost().toLowerCase();
            for (String d : domains) if (host.equals(d) || host.endsWith("." + d)) return true;
        } catch (Exception ignored) { }
        return false;
    }

    private JSONObject collect() {
        JSONObject jar = new JSONObject();
        CookieManager manager = CookieManager.getInstance();
        for (String u : cookieUrls) {
            String header = manager.getCookie(u);
            if (header == null) continue;
            for (String part : header.split(";")) {
                int eq = part.indexOf('=');
                if (eq <= 0) continue;
                try { jar.put(part.substring(0, eq).trim(), part.substring(eq + 1).trim()); } catch (Exception ignored) { }
            }
        }
        return jar;
    }

    private void clearWebData() {
        CookieManager.getInstance().removeAllCookies(null);
        CookieManager.getInstance().flush();
        WebStorage.getInstance().deleteAllData();
    }

    private void done(int code, String cookies) {
        if (finished) return;
        finished = true;
        handler.removeCallbacks(poll);
        if (cookies != null) setResult(code, new Intent().putExtra(RESULT_COOKIES, cookies)); else setResult(code);
        if (webView != null) { webView.stopLoading(); webView.clearCache(true); webView.clearHistory(); webView.destroy(); webView = null; }
        clearWebData();
        finish();
    }

    @Override public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack(); else done(RESULT_CANCELED, null);
    }

    @Override protected void onDestroy() {
        if (!finished) done(RESULT_CANCELED, null);
        super.onDestroy();
    }
}
