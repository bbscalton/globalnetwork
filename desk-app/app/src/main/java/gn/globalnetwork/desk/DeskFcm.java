package gn.globalnetwork.desk;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;
import androidx.annotation.Nullable;
import com.google.android.gms.tasks.Tasks;
import com.google.firebase.messaging.FirebaseMessaging;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/** Persists the desk FCM token for the WebView bridge and registerOwnerDevice. */
public final class DeskFcm {
    private static final String TAG = "DeskFcm";
    private static final String PREFS = "gn_desk_fcm";
    private static final String KEY_TOKEN = "token";
    private static final ExecutorService IO = Executors.newSingleThreadExecutor();

    public interface TokenListener {
        void onToken(@Nullable String token);
    }

    private DeskFcm() {}

    public static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    @Nullable
    public static String getCachedToken(Context context) {
        String token = prefs(context).getString(KEY_TOKEN, null);
        return token == null || token.isEmpty() ? null : token;
    }

    public static void saveToken(Context context, @Nullable String token) {
        SharedPreferences.Editor editor = prefs(context).edit();
        if (token == null || token.isEmpty()) {
            editor.remove(KEY_TOKEN);
        } else {
            editor.putString(KEY_TOKEN, token);
        }
        editor.apply();
    }

    /** Fetch (or refresh) the FCM token off the main thread. */
    public static void refreshAsync(Context context, @Nullable TokenListener listener) {
        Context app = context.getApplicationContext();
        IO.execute(
            () -> {
                String token = null;
                try {
                    token = Tasks.await(FirebaseMessaging.getInstance().getToken(), 30, TimeUnit.SECONDS);
                    if (token != null && !token.isEmpty()) {
                        saveToken(app, token);
                    }
                } catch (Exception e) {
                    Log.w(TAG, "FCM getToken failed", e);
                    token = getCachedToken(app);
                }
                if (listener != null) {
                    final String result = token;
                    listener.onToken(result);
                }
            });
    }
}
