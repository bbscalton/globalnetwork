package gn.globalnetwork.desk;

import android.annotation.SuppressLint;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.appcompat.app.AppCompatActivity;
import androidx.browser.customtabs.CustomTabsIntent;

/**
 * Desk shell that always loads the live ops site. Used because GitHub Project Pages
 * cannot publish Digital Asset Links at https://bbscalton.github.io/.well-known/,
 * so Trusted Web Activity verification fails and the old launcher exited immediately.
 * Google / OAuth URLs open in Chrome Custom Tabs.
 */
public class DeskWebActivity extends AppCompatActivity {
    public static final String DESK_URL = "https://bbscalton.github.io/globalnetwork/ops/";

    private WebView webView;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        setContentView(webView);

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, true);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setSupportMultipleWindows(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setUserAgentString(settings.getUserAgentString() + " GlobalNetworkDesk/1.0.1");

        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(
            new WebViewClient() {
                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    return handleExternal(request.getUrl());
                }

                @Override
                @SuppressWarnings("deprecation")
                public boolean shouldOverrideUrlLoading(WebView view, String url) {
                    return handleExternal(Uri.parse(url));
                }

                @Override
                public void onPageStarted(WebView view, String url, Bitmap favicon) {
                    super.onPageStarted(view, url, favicon);
                }
            });

        Uri data = getIntent() != null ? getIntent().getData() : null;
        String start = DESK_URL;
        if (data != null) {
            String candidate = data.toString();
            if (candidate.startsWith("https://bbscalton.github.io/globalnetwork")) {
                start = candidate;
            }
        }
        webView.loadUrl(start);
    }

    private boolean handleExternal(Uri url) {
        if (url == null) return false;
        String host = url.getHost() == null ? "" : url.getHost();
        String path = url.getPath() == null ? "" : url.getPath();
        if ("bbscalton.github.io".equals(host) && path.startsWith("/globalnetwork")) {
            return false;
        }
        openOutside(url);
        return true;
    }

    private void openOutside(Uri url) {
        try {
            new CustomTabsIntent.Builder().build().launchUrl(this, url);
        } catch (ActivityNotFoundException ignored) {
            startActivity(new Intent(Intent.ACTION_VIEW, url));
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
