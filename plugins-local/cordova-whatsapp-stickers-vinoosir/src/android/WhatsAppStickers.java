package miladesign.cordova.wastickers;

import org.apache.cordova.CallbackContext;
import org.apache.cordova.CordovaInterface;
import org.apache.cordova.CordovaPlugin;
import org.apache.cordova.CordovaWebView;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.util.Log;

import miladesign.cordova.wastickers.utils.StickerContentProvider;
import miladesign.cordova.wastickers.utils.WhitelistCheck;

public class WhatsAppStickers extends CordovaPlugin {
    private static final String TAG = "WAStickersPlugin";
    private static Activity mActivity = null;
    public CordovaInterface cordova = null;
    private static CallbackContext callbackContext;
    private static final int ADD_PACK = 200;

    @Override
    public void initialize(CordovaInterface initCordova, CordovaWebView webView) {
        Log.e(TAG, "initialize");
        cordova = initCordova;
        mActivity = cordova.getActivity();
        super.initialize(cordova, webView);
    }

    @Override
    public boolean execute(String action, JSONArray args, final CallbackContext CallbackContext) throws JSONException {
        if (action.equals("addToWhatsApp")) {
            callbackContext = CallbackContext;
            try {
                JSONObject jsonObject = new JSONObject(args.getString(0));
                addToWhatsApp(jsonObject.getString("identifier"), jsonObject.getString("name"));
            } catch (JSONException e) {
                callbackContext.error(e.getMessage());
            }
            return true;
        }
        return false;
    }

    public void addToWhatsApp(String identifier, String name) {
        Log.e(TAG, "addToWhatsApp. identifier: " + identifier + " name: " + name);
        try {
            //if neither WhatsApp Consumer or WhatsApp Business is installed, tell the user to install the app.
            if (!WhitelistCheck.isWhatsAppConsumerAppInstalled(mActivity.getPackageManager())
                    && !WhitelistCheck.isWhatsAppSmbAppInstalled(mActivity.getPackageManager())) {
                callbackContext.error("whatsapp_not_installed");
                return;
            }
            final String authority = StickerContentProvider.getAuthority(mActivity);
            final boolean stickerPackWhitelistedInWhatsAppConsumer = WhitelistCheck.isStickerPackWhitelistedInWhatsAppConsumer(mActivity, identifier);
            final boolean stickerPackWhitelistedInWhatsAppSmb = WhitelistCheck.isStickerPackWhitelistedInWhatsAppSmb(mActivity, identifier);
            if (!stickerPackWhitelistedInWhatsAppConsumer && !stickerPackWhitelistedInWhatsAppSmb) {
                //ask users which app to add the pack to.
                launchIntentToAddPackToChooser(identifier, name, authority);
            } else if (!stickerPackWhitelistedInWhatsAppConsumer) {
                launchIntentToAddPackToSpecificPackage(identifier, name, authority, WhitelistCheck.CONSUMER_WHATSAPP_PACKAGE_NAME);
            } else if (!stickerPackWhitelistedInWhatsAppSmb) {
                launchIntentToAddPackToSpecificPackage(identifier, name, authority, WhitelistCheck.SMB_WHATSAPP_PACKAGE_NAME);
            } else {
                callbackContext.error("sticker_pack_already_added");
            }
        } catch (Exception e) {
            Log.e(TAG, "error adding sticker pack to WhatsApp", e);
            callbackContext.error(e.getMessage());
        }
    }

    private Intent createIntentToAddStickerPack(String identifier, String name, String authority) {
        Intent intent = new Intent();
        intent.setAction("com.whatsapp.intent.action.ENABLE_STICKER_PACK");
        intent.putExtra("sticker_pack_id", identifier);
        intent.putExtra("sticker_pack_authority", authority);
        intent.putExtra("sticker_pack_name", name);
        return intent;
    }

    private void launchIntentToAddPackToSpecificPackage(String identifier, String name, String authority, String whatsappPackageName) {
        Intent intent = createIntentToAddStickerPack(identifier, name, authority);
        intent.setPackage(whatsappPackageName);
        cordova.setActivityResultCallback(this);
        try {
            mActivity.startActivityForResult(intent, ADD_PACK);
        } catch (ActivityNotFoundException e) {
            callbackContext.error(e.getMessage());
        }
    }

    //Handle cases where either of WhatsApp is set as default app to handle this intent. We still want users to see both options.
    private void launchIntentToAddPackToChooser(String identifier, String name, String authority) {
        Intent intent = createIntentToAddStickerPack(identifier, name, authority);
        cordova.setActivityResultCallback(this);
        try {
            mActivity.startActivityForResult(Intent.createChooser(intent, "Add to WhatsApp"), ADD_PACK);
        } catch (ActivityNotFoundException e) {
            callbackContext.error(e.getMessage());
        }
    }

    @Override
    public void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == ADD_PACK) {
            if (resultCode == Activity.RESULT_CANCELED) {
                if (data != null) {
                    final String validationError = data.getStringExtra("validation_error");
                    if (validationError != null) {
                        callbackContext.error(validationError);
                        Log.e(TAG, "Validation failed: " + validationError);
                    } else {
                        callbackContext.error("sticker_pack_not_added");
                    }
                } else {
                    callbackContext.error("sticker_pack_not_added");
                }
            } else {
                callbackContext.success();
            }
        }
    }
}
