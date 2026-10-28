package io.github.runaasahi.autocheckin;

import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.OutputStream;

/**
 * 两件事：用官方 App 打开扫码确认链接；把二维码保存到相册（供官方 App“从相册扫码”）。
 * 只允许唤起白名单内的官方 App scheme；本插件不读取任何其它应用的数据（没有 root 也不可能读取）。
 */
@CapacitorPlugin(name = "AppBridge")
public class AppBridgePlugin extends Plugin {
    private static final String[] ALLOWED_SCHEMES = { "bilibili", "orpheus" };

    @PluginMethod
    public void openApp(PluginCall call) {
        String url = call.getString("url", "");
        Uri uri = Uri.parse(url);
        boolean allowed = false;
        for (String s : ALLOWED_SCHEMES) if (s.equals(uri.getScheme())) allowed = true;
        JSObject ret = new JSObject();
        if (!allowed) { call.reject("不允许打开该链接"); return; }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, uri);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(intent);
            ret.put("opened", true);
        } catch (ActivityNotFoundException e) {
            ret.put("opened", false); // 没装官方 App
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void saveImage(PluginCall call) {
        String data = call.getString("base64", "");
        String name = call.getString("fileName", "autocheckin-qr.png").replaceAll("[^A-Za-z0-9._-]", "_");
        JSObject ret = new JSObject();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) { ret.put("saved", false); ret.put("reason", "需要 Android 10 及以上"); call.resolve(ret); return; }
        try {
            byte[] bytes = Base64.decode(data, Base64.DEFAULT);
            ContentValues values = new ContentValues();
            values.put(MediaStore.Images.Media.DISPLAY_NAME, name);
            values.put(MediaStore.Images.Media.MIME_TYPE, "image/png");
            values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/AutoCheckin");
            values.put(MediaStore.Images.Media.IS_PENDING, 1);
            ContentResolver resolver = getContext().getContentResolver();
            Uri item = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
            if (item == null) throw new IllegalStateException("insert failed");
            try (OutputStream out = resolver.openOutputStream(item)) { if (out == null) throw new IllegalStateException("open failed"); out.write(bytes); }
            values.clear();
            values.put(MediaStore.Images.Media.IS_PENDING, 0);
            resolver.update(item, values, null, null);
            ret.put("saved", true);
        } catch (Exception e) {
            ret.put("saved", false); ret.put("reason", "保存失败");
        }
        call.resolve(ret);
    }
}
