package gn.globalnetwork.desk;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.os.Build;
import android.util.Log;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

/**
 * Native FCM for the owner desk APK. Android WebView does not receive web push, so
 * notifications must land here and the token is bridged into ops-web for registerOwnerDevice.
 */
public class DeskFirebaseMessagingService extends FirebaseMessagingService {
    private static final String TAG = "DeskFcmService";
    public static final String CHANNEL_ID = "owner_desk";
    public static final String ACTION_TOKEN = "gn.globalnetwork.desk.FCM_TOKEN";

    @Override
    public void onNewToken(@NonNull String token) {
        DeskFcm.saveToken(this, token);
        Intent broadcast = new Intent(ACTION_TOKEN);
        broadcast.setPackage(getPackageName());
        broadcast.putExtra("token", token);
        sendBroadcast(broadcast);
        Log.i(TAG, "FCM token refreshed");
    }

    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        ensureChannel();
        String title = null;
        String body = null;
        if (message.getNotification() != null) {
            title = message.getNotification().getTitle();
            body = message.getNotification().getBody();
        }
        if (title == null || title.isEmpty()) {
            title = message.getData().get("title");
        }
        if (body == null || body.isEmpty()) {
            body = message.getData().get("body");
        }
        if ((title == null || title.isEmpty()) && (body == null || body.isEmpty())) {
            title = "GlobalNetwork";
            body = "New desk update";
        }
        showNotification(title == null ? "GlobalNetwork" : title, body == null ? "" : body);
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel =
            new NotificationChannel(CHANNEL_ID, "Owner desk", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("Alerts for applications, chat, calls, and desk requests");
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null) nm.createNotificationChannel(channel);
    }

    private void showNotification(String title, String body) {
        Intent open = new Intent(this, DeskWebActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent content = PendingIntent.getActivity(this, 0, open, flags);

        NotificationCompat.Builder builder =
            new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setContentIntent(content);

        try {
            NotificationManagerCompat.from(this).notify((int) (System.currentTimeMillis() & 0xfffffff), builder.build());
        } catch (SecurityException e) {
            Log.w(TAG, "Notification permission missing", e);
        }
    }
}
