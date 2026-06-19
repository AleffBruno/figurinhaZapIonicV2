package com.figurinhazap.stickers;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.util.Base64;

import org.apache.cordova.CallbackContext;
import org.apache.cordova.CordovaPlugin;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;

public class WhatsAppStickersPlugin extends CordovaPlugin {
  private static final String ACTION_ADD_STICKER_PACK = "addStickerPack";
  private static final String ADD_STICKER_PACK_ACTION = "com.whatsapp.intent.action.ENABLE_STICKER_PACK";
  private static final String EXTRA_STICKER_PACK_ID = "sticker_pack_id";
  private static final String EXTRA_STICKER_PACK_AUTHORITY = "sticker_pack_authority";
  private static final String EXTRA_STICKER_PACK_NAME = "sticker_pack_name";
  private static final String PREFS_NAME = "WhatsAppStickers";
  private static final String PREF_ALBUMS = "albums";
  private static final String STICKERS_DIR = "whatsapp_stickers";
  private static final int ADD_PACK_REQUEST_CODE = 200;

  private static final String CONSUMER_WHATSAPP_PACKAGE_NAME = "com.whatsapp";
  private static final String SMB_WHATSAPP_PACKAGE_NAME = "com.whatsapp.w4b";

  private CallbackContext callbackContext;

  @Override
  public boolean execute(String action, JSONArray args, final CallbackContext callbackContext) throws JSONException {
    if (!ACTION_ADD_STICKER_PACK.equals(action)) {
      return false;
    }

    this.callbackContext = callbackContext;
    final JSONObject album = getAlbum(args);

    cordova.getActivity().runOnUiThread(new Runnable() {
      @Override
      public void run() {
        try {
          JSONObject storedAlbum = prepareAlbum(album);
          String identifier = storedAlbum.getString("identifier");
          String name = storedAlbum.getString("name");

          addStickerPackToWhatsApp(identifier, name);
        } catch (ActivityNotFoundException exception) {
          callbackContext.error("WhatsApp nao encontrado neste dispositivo.");
        } catch (Exception exception) {
          callbackContext.error(exception.getMessage());
        }
      }
    });

    return true;
  }

  private void addStickerPackToWhatsApp(String identifier, String name) {
    Activity activity = cordova.getActivity();
    PackageManager packageManager = activity.getPackageManager();

    boolean consumerInstalled = isPackageInstalled(CONSUMER_WHATSAPP_PACKAGE_NAME, packageManager);
    boolean smbInstalled = isPackageInstalled(SMB_WHATSAPP_PACKAGE_NAME, packageManager);

    if (!consumerInstalled && !smbInstalled) {
      callbackContext.error("WhatsApp nao encontrado neste dispositivo.");
      return;
    }

    Intent intent = createIntentToAddStickerPack(identifier, name);

    if (consumerInstalled && smbInstalled) {
      intent = Intent.createChooser(intent, "Adicionar ao WhatsApp");
    } else if (smbInstalled) {
      intent.setPackage(SMB_WHATSAPP_PACKAGE_NAME);
    } else {
      intent.setPackage(CONSUMER_WHATSAPP_PACKAGE_NAME);
    }

    cordova.setActivityResultCallback(this);
    try {
      activity.startActivityForResult(intent, ADD_PACK_REQUEST_CODE);
    } catch (ActivityNotFoundException e) {
      callbackContext.error(e.getMessage());
    }
  }

  private Intent createIntentToAddStickerPack(String identifier, String name) {
    Intent intent = new Intent(ADD_STICKER_PACK_ACTION);
    intent.putExtra(EXTRA_STICKER_PACK_ID, identifier);
    intent.putExtra(EXTRA_STICKER_PACK_AUTHORITY, getContentProviderAuthority());
    intent.putExtra(EXTRA_STICKER_PACK_NAME, name);
    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
    return intent;
  }

  @Override
  public void onActivityResult(int requestCode, int resultCode, Intent data) {
    super.onActivityResult(requestCode, resultCode, data);
    if (requestCode != ADD_PACK_REQUEST_CODE) {
      return;
    }
    if (callbackContext == null) {
      return;
    }
    if (resultCode == Activity.RESULT_CANCELED) {
      if (data != null) {
        String validationError = data.getStringExtra("validation_error");
        if (validationError != null) {
          callbackContext.error(validationError);
          return;
        }
      }
      callbackContext.error("sticker_pack_not_added");
    } else {
      callbackContext.success();
    }
  }

  private boolean isPackageInstalled(String packageName, PackageManager packageManager) {
    try {
      android.content.pm.ApplicationInfo info = packageManager.getApplicationInfo(packageName, 0);
      return info != null && info.enabled;
    } catch (PackageManager.NameNotFoundException e) {
      return false;
    }
  }

  private JSONObject getAlbum(JSONArray args) throws JSONException {
    Object firstArg = args.get(0);
    if (firstArg instanceof JSONObject) {
      return (JSONObject) firstArg;
    }

    JSONObject album = new JSONObject();
    String identifier = args.getString(0);
    album.put("identifier", identifier);
    album.put("name", args.getString(1));
    album.put("publisher", "FigurinhaZap");
    album.put("trayImage", "stickers/" + identifier + "/tray.png");

    JSONArray stickers = new JSONArray();
    for (int index = 1; index <= 3; index++) {
      JSONObject sticker = new JSONObject();
      sticker.put("fileName", index + ".webp");
      sticker.put("source", "stickers/" + identifier + "/" + index + ".webp");
      sticker.put("emojis", new JSONArray().put("😀"));
      stickers.put(sticker);
    }
    album.put("stickers", stickers);
    return album;
  }

  private JSONObject prepareAlbum(JSONObject album) throws JSONException, IOException {
    String identifier = requireString(album, "identifier");
    String name = requireString(album, "name");
    String publisher = album.optString("publisher", "FigurinhaZap");
    JSONArray stickers = album.optJSONArray("stickers");

    if (stickers == null || stickers.length() < 3 || stickers.length() > 30) {
      throw new JSONException("O album precisa ter entre 3 e 30 figurinhas.");
    }

    File packDir = getPackDir(identifier);
    deleteRecursive(packDir);
    if (!packDir.mkdirs() && !packDir.isDirectory()) {
      throw new IOException("Nao foi possivel criar a pasta do album.");
    }

    String trayImage = album.optString("trayImage", album.optString("trayImageSource", ""));
    if (trayImage.length() == 0) {
      trayImage = "stickers/" + identifier + "/tray.png";
    }
    String trayFileName = cleanFileName(album.optString("trayImageFile", "tray.png"));
    copySourceToFile(trayImage, new File(packDir, trayFileName));

    JSONArray storedStickers = new JSONArray();
    for (int index = 0; index < stickers.length(); index++) {
      JSONObject sticker = stickers.getJSONObject(index);
      String fileName = cleanFileName(requireString(sticker, "fileName"));
      String source = sticker.optString("source", "stickers/" + identifier + "/" + fileName);
      copySourceToFile(source, new File(packDir, fileName));

      JSONObject storedSticker = new JSONObject();
      storedSticker.put("fileName", fileName);
      storedSticker.put("emojis", sticker.optJSONArray("emojis") != null ? sticker.optJSONArray("emojis") : new JSONArray().put("😀"));
      if (sticker.has("accessibilityText") && !sticker.isNull("accessibilityText")) {
        storedSticker.put("accessibilityText", sticker.getString("accessibilityText"));
      }
      storedStickers.put(storedSticker);
    }

    JSONObject storedAlbum = new JSONObject();
    storedAlbum.put("identifier", identifier);
    storedAlbum.put("name", name);
    storedAlbum.put("publisher", publisher);
    storedAlbum.put("trayImageFile", trayFileName);
    storedAlbum.put("androidPlayStoreLink", album.optString("androidPlayStoreLink", ""));
    storedAlbum.put("iosAppStoreLink", album.optString("iosAppStoreLink", ""));
    storedAlbum.put("publisherEmail", album.optString("publisherEmail", ""));
    storedAlbum.put("publisherWebsite", album.optString("publisherWebsite", ""));
    storedAlbum.put("privacyPolicyWebsite", album.optString("privacyPolicyWebsite", ""));
    storedAlbum.put("licenseAgreementWebsite", album.optString("licenseAgreementWebsite", ""));
    storedAlbum.put("imageDataVersion", album.optString("imageDataVersion", "1"));
    storedAlbum.put("avoidCache", album.optString("avoidCache", "0"));
    storedAlbum.put("animatedStickerPack", album.optString("animatedStickerPack", "0"));
    storedAlbum.put("stickers", storedStickers);

    saveAlbum(storedAlbum);
    return storedAlbum;
  }

  private void saveAlbum(JSONObject album) throws JSONException {
    Context context = cordova.getActivity().getApplicationContext();
    String rawAlbums = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).getString(PREF_ALBUMS, "{}");
    JSONObject albums = new JSONObject(rawAlbums);
    albums.put(album.getString("identifier"), album);
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .edit()
      .putString(PREF_ALBUMS, albums.toString())
      .apply();
  }

  private void copySourceToFile(String source, File target) throws IOException {
    InputStream inputStream = null;
    try {
      inputStream = openSource(source);
      FileOutputStream outputStream = new FileOutputStream(target);
      try {
        byte[] buffer = new byte[8192];
        int bytesRead;
        while ((bytesRead = inputStream.read(buffer)) != -1) {
          outputStream.write(buffer, 0, bytesRead);
        }
      } finally {
        outputStream.close();
      }
    } finally {
      if (inputStream != null) {
        inputStream.close();
      }
    }
  }

  private InputStream openSource(String source) throws IOException {
    if (source.startsWith("data:")) {
      int commaIndex = source.indexOf(',');
      if (commaIndex == -1) {
        throw new IOException("Imagem base64 invalida.");
      }
      byte[] imageBytes = Base64.decode(source.substring(commaIndex + 1), Base64.DEFAULT);
      return new java.io.ByteArrayInputStream(imageBytes);
    }

    if (source.startsWith("file://") || source.startsWith("content://")) {
      InputStream inputStream = cordova.getActivity().getContentResolver().openInputStream(Uri.parse(source));
      if (inputStream == null) {
        throw new IOException("Nao foi possivel abrir a imagem: " + source);
      }
      return inputStream;
    }

    String assetPath = source.startsWith("/") ? source.substring(1) : source;
    try {
      return cordova.getActivity().getAssets().open(assetPath);
    } catch (IOException ignored) {
      return cordova.getActivity().getAssets().open("www/" + assetPath);
    }
  }

  private String requireString(JSONObject object, String field) throws JSONException {
    String value = object.optString(field, "").trim();
    if (value.length() == 0) {
      throw new JSONException("Campo obrigatorio ausente: " + field);
    }
    return value;
  }

  private String cleanFileName(String fileName) throws JSONException {
    if (fileName.contains("/") || fileName.contains("\\")) {
      throw new JSONException("Nome de arquivo invalido: " + fileName);
    }
    return fileName;
  }

  private File getPackDir(String identifier) {
    return new File(new File(cordova.getActivity().getFilesDir(), STICKERS_DIR), identifier);
  }

  private void deleteRecursive(File file) {
    if (!file.exists()) {
      return;
    }
    if (file.isDirectory()) {
      File[] children = file.listFiles();
      if (children != null) {
        for (File child : children) {
          deleteRecursive(child);
        }
      }
    }
    file.delete();
  }

  private String getContentProviderAuthority() {
    return cordova.getActivity().getPackageName() + ".stickercontentprovider";
  }
}
