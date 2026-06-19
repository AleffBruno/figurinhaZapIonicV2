package com.figurinhazap.stickers;

import android.content.ContentProvider;
import android.content.ContentResolver;
import android.content.Context;
import android.content.ContentValues;
import android.content.UriMatcher;
import android.content.res.AssetFileDescriptor;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.text.TextUtils;

import java.io.FileNotFoundException;
import java.io.File;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

public class WhatsAppStickerContentProvider extends ContentProvider {
  private static final String PREFS_NAME = "WhatsAppStickers";
  private static final String PREF_ALBUMS = "albums";
  private static final String STICKERS_DIR = "whatsapp_stickers";
  private static final int METADATA = 1;
  private static final int METADATA_SINGLE_PACK = 2;
  private static final int STICKERS = 3;
  private static final int STICKERS_ASSET = 4;
  private static final int STICKER_PACK_TRAY_ICON = 5;

  // Column names used by WhatsApp — do NOT change these.
  private static final String STICKER_PACK_IDENTIFIER_IN_QUERY = "sticker_pack_identifier";
  private static final String STICKER_PACK_NAME_IN_QUERY = "sticker_pack_name";
  private static final String STICKER_PACK_PUBLISHER_IN_QUERY = "sticker_pack_publisher";
  private static final String STICKER_PACK_ICON_IN_QUERY = "sticker_pack_icon";
  private static final String ANDROID_APP_DOWNLOAD_LINK_IN_QUERY = "android_play_store_link";
  private static final String IOS_APP_DOWNLOAD_LINK_IN_QUERY = "ios_app_download_link";
  private static final String PUBLISHER_EMAIL = "sticker_pack_publisher_email";
  private static final String PUBLISHER_WEBSITE = "sticker_pack_publisher_website";
  private static final String PRIVACY_POLICY_WEBSITE = "sticker_pack_privacy_policy_website";
  private static final String LICENSE_AGREEMENT_WEBSITE = "sticker_pack_license_agreement_website";
  private static final String IMAGE_DATA_VERSION = "image_data_version";
  private static final String AVOID_CACHE = "whatsapp_will_not_cache_stickers";
  private static final String ANIMATED_STICKER_PACK = "animated_sticker_pack";

  private static final String STICKER_FILE_NAME_IN_QUERY = "sticker_file_name";
  private static final String STICKER_FILE_EMOJI_IN_QUERY = "sticker_emoji";
  private static final String STICKER_FILE_ACCESSIBILITY_TEXT_IN_QUERY = "sticker_accessibility_text";

  private static final String[] METADATA_COLUMNS = {
    STICKER_PACK_IDENTIFIER_IN_QUERY,
    STICKER_PACK_NAME_IN_QUERY,
    STICKER_PACK_PUBLISHER_IN_QUERY,
    STICKER_PACK_ICON_IN_QUERY,
    ANDROID_APP_DOWNLOAD_LINK_IN_QUERY,
    IOS_APP_DOWNLOAD_LINK_IN_QUERY,
    PUBLISHER_EMAIL,
    PUBLISHER_WEBSITE,
    PRIVACY_POLICY_WEBSITE,
    LICENSE_AGREEMENT_WEBSITE,
    IMAGE_DATA_VERSION,
    AVOID_CACHE,
    ANIMATED_STICKER_PACK
  };

  private static final String[] STICKER_COLUMNS = {
    STICKER_FILE_NAME_IN_QUERY,
    STICKER_FILE_EMOJI_IN_QUERY,
    STICKER_FILE_ACCESSIBILITY_TEXT_IN_QUERY
  };

  @Override
  public boolean onCreate() {
    return getContext() != null;
  }

  @Override
  public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
    switch (getUriMatcher().match(uri)) {
      case METADATA:
        return getPackMetadata();
      case METADATA_SINGLE_PACK:
        return getPackMetadata(uri.getLastPathSegment());
      case STICKERS:
        return getStickers(uri.getLastPathSegment());
      default:
        throw new IllegalArgumentException("Unknown URI: " + uri);
    }
  }

  @Override
  public AssetFileDescriptor openAssetFile(Uri uri, String mode) throws FileNotFoundException {
    int match = getUriMatcher().match(uri);
    if (match != STICKERS_ASSET && match != STICKER_PACK_TRAY_ICON) {
      return super.openAssetFile(uri, mode);
    }

    List<String> segments = uri.getPathSegments();
    if (segments.size() != 3) {
      throw new FileNotFoundException("Invalid sticker asset: " + uri);
    }

    String identifier = segments.get(1);
    String fileName = segments.get(2);
    try {
      JSONObject album = getAlbum(identifier);
      if (album == null || !isKnownFile(album, fileName)) {
        throw new FileNotFoundException("Unknown sticker asset: " + uri);
      }

      File file = new File(getPackDir(identifier), fileName);
      if (!file.isFile()) {
        throw new FileNotFoundException("Missing sticker asset: " + uri);
      }

      ParcelFileDescriptor descriptor = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY);
      return new AssetFileDescriptor(descriptor, 0, AssetFileDescriptor.UNKNOWN_LENGTH);
    } catch (JSONException exception) {
      throw new FileNotFoundException(exception.getMessage());
    }
  }

  @Override
  public String getType(Uri uri) {
    String authority = getContext().getPackageName() + ".stickercontentprovider";
    switch (getUriMatcher().match(uri)) {
      case METADATA:
        return "vnd.android.cursor.dir/vnd." + authority + ".metadata";
      case METADATA_SINGLE_PACK:
        return "vnd.android.cursor.item/vnd." + authority + ".metadata";
      case STICKERS:
        return "vnd.android.cursor.dir/vnd." + authority + ".stickers";
      case STICKERS_ASSET:
        return "image/webp";
      case STICKER_PACK_TRAY_ICON:
        return "image/png";
      default:
        return null;
    }
  }

  @Override
  public Uri insert(Uri uri, ContentValues values) {
    throw new UnsupportedOperationException("Insert is not supported.");
  }

  @Override
  public int delete(Uri uri, String selection, String[] selectionArgs) {
    throw new UnsupportedOperationException("Delete is not supported.");
  }

  @Override
  public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
    throw new UnsupportedOperationException("Update is not supported.");
  }

  private Cursor getPackMetadata() {
    MatrixCursor cursor = new MatrixCursor(METADATA_COLUMNS);
    try {
      JSONObject albums = getAlbums();
      Iterator<String> identifiers = albums.keys();
      while (identifiers.hasNext()) {
        JSONObject album = albums.getJSONObject(identifiers.next());
        addPackMetadataRow(cursor, album);
      }
    } catch (JSONException ignored) {
    }
    return cursor;
  }

  private Cursor getPackMetadata(String identifier) {
    MatrixCursor cursor = new MatrixCursor(METADATA_COLUMNS);
    try {
      JSONObject album = getAlbum(identifier);
      if (album != null) {
        addPackMetadataRow(cursor, album);
      }
    } catch (JSONException ignored) {
    }
    return cursor;
  }

  private void addPackMetadataRow(MatrixCursor cursor, JSONObject album) throws JSONException {
    cursor.addRow(new Object[] {
      album.getString("identifier"),
      album.getString("name"),
      album.optString("publisher", "FigurinhaZap"),
      album.optString("trayImageFile", "tray.png"),
      album.optString("androidPlayStoreLink", ""),
      album.optString("iosAppStoreLink", ""),
      album.optString("publisherEmail", ""),
      album.optString("publisherWebsite", ""),
      album.optString("privacyPolicyWebsite", ""),
      album.optString("licenseAgreementWebsite", ""),
      album.optString("imageDataVersion", "1"),
      album.optString("avoidCache", "0"),
      album.optString("animatedStickerPack", "0")
    });
  }

  private Cursor getStickers(String identifier) {
    MatrixCursor cursor = new MatrixCursor(STICKER_COLUMNS);
    try {
      JSONObject album = getAlbum(identifier);
      if (album == null) {
        return cursor;
      }

      JSONArray stickers = album.getJSONArray("stickers");
      for (int index = 0; index < stickers.length(); index++) {
        JSONObject sticker = stickers.getJSONObject(index);
        String fileName = sticker.getString("fileName");
        List<String> emojis = getEmojiList(sticker.optJSONArray("emojis"));
        String accessibilityText = sticker.optString("accessibilityText", (String) null);
        cursor.addRow(new Object[] { fileName, TextUtils.join(",", emojis), accessibilityText });
      }
    } catch (JSONException ignored) {
    }
    return cursor;
  }

  private List<String> getEmojiList(JSONArray emojis) throws JSONException {
    List<String> emojiList = new ArrayList<String>();
    if (emojis != null) {
      for (int index = 0; index < emojis.length(); index++) {
        emojiList.add(emojis.getString(index));
      }
    }
    if (emojiList.isEmpty()) {
      emojiList.add("😀");
    }
    return emojiList;
  }

  private boolean isKnownFile(JSONObject album, String fileName) throws JSONException {
    if (fileName.equals(album.optString("trayImageFile", "tray.png"))) {
      return true;
    }

    JSONArray stickers = album.getJSONArray("stickers");
    for (int index = 0; index < stickers.length(); index++) {
      if (fileName.equals(stickers.getJSONObject(index).getString("fileName"))) {
        return true;
      }
    }
    return false;
  }

  private JSONObject getAlbum(String identifier) throws JSONException {
    JSONObject albums = getAlbums();
    return albums.has(identifier) ? albums.getJSONObject(identifier) : null;
  }

  private JSONObject getAlbums() throws JSONException {
    String rawAlbums = getContext()
      .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .getString(PREF_ALBUMS, "{}");
    return new JSONObject(rawAlbums);
  }

  private File getPackDir(String identifier) {
    return new File(new File(getContext().getFilesDir(), STICKERS_DIR), identifier);
  }

  private UriMatcher getUriMatcher() {
    UriMatcher uriMatcher = new UriMatcher(UriMatcher.NO_MATCH);
    String authority = getContext().getPackageName() + ".stickercontentprovider";
    uriMatcher.addURI(authority, "metadata", METADATA);
    uriMatcher.addURI(authority, "metadata/*", METADATA_SINGLE_PACK);
    uriMatcher.addURI(authority, "stickers/*", STICKERS);

    // Register per-pack tray icon and sticker asset URIs so WhatsApp can fetch them.
    try {
      JSONObject albums = getAlbums();
      Iterator<String> identifiers = albums.keys();
      while (identifiers.hasNext()) {
        String identifier = identifiers.next();
        JSONObject album = albums.getJSONObject(identifier);
        String trayFile = album.optString("trayImageFile", "tray.png");
        uriMatcher.addURI(authority, "stickers_asset/" + identifier + "/" + trayFile, STICKER_PACK_TRAY_ICON);
        JSONArray stickers = album.optJSONArray("stickers");
        if (stickers != null) {
          for (int i = 0; i < stickers.length(); i++) {
            String stickerFile = stickers.getJSONObject(i).getString("fileName");
            uriMatcher.addURI(authority, "stickers_asset/" + identifier + "/" + stickerFile, STICKERS_ASSET);
          }
        }
      }
    } catch (JSONException ignored) {
    }
    uriMatcher.addURI(authority, "stickers_asset/*/*", STICKERS_ASSET);
    return uriMatcher;
  }
}
