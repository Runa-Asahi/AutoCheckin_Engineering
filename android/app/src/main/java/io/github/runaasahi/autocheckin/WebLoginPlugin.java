package io.github.runaasahi.autocheckin;

import android.app.Activity;
import android.content.Intent;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import org.json.JSONException;

/** 打开平台官方登录页，登录成功后把声明的 Cookie 交给 JS 层加密保存。Cookie 不写日志。 */
@CapacitorPlugin(name = "WebLogin")
public class WebLoginPlugin extends Plugin {
    @PluginMethod
    public void open(PluginCall call) {
        String url = call.getString("url");
        if (url == null || !url.startsWith("https://")) { call.reject("登录地址无效"); return; }
        try {
            Intent intent = new Intent(getContext(), WebLoginActivity.class);
            intent.putExtra(WebLoginActivity.EXTRA_URL, url);
            intent.putStringArrayListExtra(WebLoginActivity.EXTRA_DOMAINS, list(call.getArray("domains")));
            intent.putStringArrayListExtra(WebLoginActivity.EXTRA_REQUIRED, list(call.getArray("requiredCookies")));
            intent.putStringArrayListExtra(WebLoginActivity.EXTRA_COOKIE_URLS, list(call.getArray("cookieUrls")));
            startActivityForResult(call, intent, "onLoginResult");
        } catch (JSONException e) {
            call.reject("参数错误");
        }
    }

    @ActivityCallback
    private void onLoginResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject ret = new JSObject();
        Intent data = result.getData();
        if (result.getResultCode() == Activity.RESULT_OK && data != null) {
            try {
                ret.put("cancelled", false);
                ret.put("cookies", new JSObject(data.getStringExtra(WebLoginActivity.RESULT_COOKIES)));
            } catch (JSONException e) {
                ret.put("cancelled", true);
            }
        } else {
            ret.put("cancelled", true);
        }
        call.resolve(ret);
    }

    private static ArrayList<String> list(JSArray array) throws JSONException {
        ArrayList<String> out = new ArrayList<>();
        if (array != null) for (int i = 0; i < array.length(); i++) out.add(array.getString(i));
        return out;
    }
}
