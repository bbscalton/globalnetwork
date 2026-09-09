package gn.globalnetwork.desk;

import android.annotation.SuppressLint;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Message;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import androidx.appcompat.app.AppCompatActivity;
import androidx.browser.customtabs.CustomTabsIntent;
import androidx.core.splashscreen.SplashScreen;

/**
 * Desk shell that loads the live ops site. Google sign-in uses Firebase
 * {@code signInWithPopup}, which needs a real WebView popup window — ejecting
 * OAuth into Chrome Custom Tabs closes the popup early and shows
 * "Google sign-in was closed before it finished."
 */
public class DeskWebActivity extends AppCompatActivity {
    public static final String DESK_URL = "https://gbnglobenetwork-sketch.github.io/globalnetwork/ops/";

    private FrameLayout root;
    private WebView webView;
    private WebView popupView;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        SplashScreen.installSplashScreen(this);
        super.onCreate(savedInstanceState);

        root = new FrameLayout(this);
        root.setLayoutParams(
            new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        webView = new WebView(this);
        root.addView(
            webView,
            new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        configureWebView(webView, false);

        webView.setWebChromeClient(
            new WebChromeClient() {
                @Override
                public boolean onCreateWindow(
                    WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
                    return openPopup(resultMsg);
                }

                @Override
                public void onCloseWindow(WebView window) {
                    closePopup();
                }
            });

        Uri data = getIntent() != null ? getIntent().getData() : null;
        String start = DESK_URL;
        if (data != null) {
            String candidate = data.toString();
            if (candidate.startsWith("https://gbnglobenetwork-sketch.github.io/globalnetwork")) {
                start = candidate;
            }
        }
        webView.loadUrl(start);
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView(WebView view, boolean isPopup) {
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(view, true);

        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setSupportMultipleWindows(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        if (!isPopup) {
            settings.setUserAgentString(settings.getUserAgentString() + " GlobalNetworkDesk/1.0.3");
        }

        view.setWebViewClient(
            new WebViewClient() {
                @Override
                public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest request) {
                    return handleNavigation(v, request.getUrl(), isPopup);
                }

                @Override
                @SuppressWarnings("deprecation")
                public boolean shouldOverrideUrlLoading(WebView v, String url) {
                    return handleNavigation(v, Uri.parse(url), isPopup);
                }
            });
    }

    private boolean openPopup(Message resultMsg) {
        closePopup();
        popupView = new WebView(this);
        popupView.setBackgroundColor(Color.WHITE);
        configureWebView(popupView, true);
        popupView.setWebChromeClient(
            new WebChromeClient() {
                @Override
                public void onCloseWindow(WebView window) {
                    closePopup();
                }
            });
        root.addView(
            popupView,
            new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
        transport.setWebView(popupView);
        resultMsg.sendToTarget();
        return true;
    }

    private void closePopup() {
        if (popupView == null) return;
        root.removeView(popupView);
        popupView.destroy();
        popupView = null;
    }

    /**
     * Stay inside WebView for the desk site and Google / Firebase OAuth hosts.
     * Only send unrelated https links to Custom Tabs.
     */
    private boolean handleNavigation(WebView view, Uri url, boolean isPopup) {
        if (url == null) return false;
        String scheme = url.getScheme() == null ? "" : url.getScheme().toLowerCase();
        if ("mailto".equals(scheme) || "tel".equals(scheme)) {
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, url));
            } catch (ActivityNotFoundException ignored) {
            }
            return true;
        }
        if (!"http".equals(scheme) && !"https".equals(scheme)) {
            return true;
        }
        if (isAuthOrDeskHost(url)) {
            // After Google finishes, Firebase often navigates the popup back to the desk
            // origin and then closes. If it lands on our site, fold into the main WebView.
            if (isPopup && isDeskHost(url)) {
                if (webView != null) webView.loadUrl(url.toString());
                closePopup();
                return true;
            }
            return false;
        }
        openOutside(url);
        if (isPopup) closePopup();
        return true;
    }

    private static boolean isDeskHost(Uri url) {
        String host = url.getHost() == null ? "" : url.getHost().toLowerCase();
        String path = url.getPath() == null ? "" : url.getPath();
        return "gbnglobenetwork-sketch.github.io".equals(host) && path.startsWith("/globalnetwork");
    }

    private static boolean isAuthOrDeskHost(Uri url) {
        if (isDeskHost(url)) return true;
        String host = url.getHost() == null ? "" : url.getHost().toLowerCase();
        if (host.isEmpty()) return false;
        if (host.equals("accounts.google.com")
            || host.equals("accounts.youtube.com")
            || host.equals("apis.google.com")
            || host.equals("www.googleapis.com")
            || host.equals("oauthaccountmanager.googleapis.com")
            || host.equals("ssl.gstatic.com")
            || host.equals("www.gstatic.com")
            || host.equals("gstatic.com")) {
            return true;
        }
        return host.endsWith(".google.com")
            || host.endsWith(".googleusercontent.com")
            || host.endsWith(".firebaseapp.com")
            || host.endsWith(".googleapis.com")
            || host.endsWith(".gstatic.com");
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
        if (popupView != null) {
            if (popupView.canGoBack()) {
                popupView.goBack();
            } else {
                closePopup();
            }
            return;
        }
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        closePopup();
        if (webView != null) {
            root.removeView(webView);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
