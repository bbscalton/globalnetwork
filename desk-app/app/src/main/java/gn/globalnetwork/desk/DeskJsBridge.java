package gn.globalnetwork.desk;

import android.webkit.JavascriptInterface;
import androidx.annotation.Nullable;

/** Exposed to ops-web as {@code window.GlobalNetworkDesk}. */
public class DeskJsBridge {
    private volatile String fcmToken = "";

    public void setFcmToken(@Nullable String token) {
        fcmToken = token == null ? "" : token;
    }

    @JavascriptInterface
    public boolean isNativeDesk() {
        return true;
    }

    @JavascriptInterface
    public String getFcmToken() {
        return fcmToken == null ? "" : fcmToken;
    }
}
