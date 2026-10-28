package io.github.runaasahi.autocheckin;

import android.os.Bundle;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(WebLoginPlugin.class);
        registerPlugin(AppBridgePlugin.class);
        super.onCreate(savedInstanceState);
        // 最近任务预览里不显示账号信息
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);
    }
}
