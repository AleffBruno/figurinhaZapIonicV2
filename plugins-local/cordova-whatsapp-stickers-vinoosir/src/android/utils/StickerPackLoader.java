/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree.
 */

package miladesign.cordova.wastickers.utils;

import android.content.ContentResolver;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.text.TextUtils;

import androidx.annotation.NonNull;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;

import static miladesign.cordova.wastickers.utils.StickerContentProvider.ANDROID_APP_DOWNLOAD_LINK_IN_QUERY;
import static miladesign.cordova.wastickers.utils.StickerContentProvider.ANIMATED_STICKER_PACK;
import static miladesign.cordova.wastickers.utils.StickerContentProvider.AVOID_CACHE;
import static miladesign.cordova.wastickers.utils.StickerContentProvider.IMAGE_DATA_VERSION;
import static miladesign.cordova.wastickers.utils.StickerContentProvider.IOS_APP_DOWNLOAD_LINK_IN_QUERY;
import static miladesign.cordova.wastickers.utils.StickerContentProvider.LICENSE_AGREEMENT_WEBSITE;
import static miladesign.cordova.wastickers.utils.StickerContentProvider.PRIVACY_POLICY_WEBSITE;
import static miladesign.cordova.wastickers.utils.StickerContentProvider.PUBLISHER_EMAIL;
import static miladesign.cordova.wastickers.utils.StickerContentProvider.PUBLISHER_WEBSITE;
import static miladesign.cordova.wastickers.utils.StickerContentProvider.STICKER_FILE_ACCESSIBILITY_TEXT_IN_QUERY;
import static miladesign.cordova.wastickers.utils.StickerContentProvider.STICKER_FILE_EMOJI_IN_QUERY;
import static miladesign.cordova.wastickers.utils.StickerContentProvider.STICKER_FILE_NAME_IN_QUERY;
import static miladesign.cordova.wastickers.utils.StickerContentProvider.STICKER_PACK_ICON_IN_QUERY;
import static miladesign.cordova.wastickers.utils.StickerContentProvider.STICKER_PACK_IDENTIFIER_IN_QUERY;
import static miladesign.cordova.wastickers.utils.StickerContentProvider.STICKER_PACK_NAME_IN_QUERY;
import static miladesign.cordova.wastickers.utils.StickerContentProvider.STICKER_PACK_PUBLISHER_IN_QUERY;

class StickerPackLoader {

    /**
     * Get the list of sticker packs for the sticker content provider
     */
    @NonNull
    static ArrayList<StickerPack> fetchStickerPacks(Context context) throws IllegalStateException {
        final Cursor cursor = context.getContentResolver().query(StickerContentProvider.getAuthorityUri(context), null, null, null, null);
        if (cursor == null) {
            throw new IllegalStateException("could not fetch from content provider, " + StickerContentProvider.getAuthority(context));
        }
        HashSet<String> identifierSet = new HashSet<>();
        final ArrayList<StickerPack> stickerPackList = fetchFromContentProvider(cursor);
        for (StickerPack stickerPack : stickerPackList) {
            if (identifierSet.contains(stickerPack.identifier)) {
                throw new IllegalStateException("sticker pack identifiers should be unique, there are more than one pack with identifier:" + stickerPack.identifier);
            } else {
                identifierSet.add(stickerPack.identifier);
            }
        }
        if (stickerPackList.isEmpty()) {
            throw new IllegalStateException("There should be at least one sticker pack in the app");
        }
        for (StickerPack stickerPack : stickerPackList) {
            final List<Sticker> stickers = getStickersForPack(context, stickerPack);
            stickerPack.setStickers(stickers);
            StickerPackValidator.verifyStickerPackValidity(context, stickerPack);
        }
        return stickerPackList;
    }

    @NonNull
    private static List<Sticker> getStickersForPack(Context context, StickerPack stickerPack) {
        final List<Sticker> stickers = fetchFromContentProviderForStickers(context, stickerPack.identifier);
        for (Sticker sticker : stickers) {
            final byte[] bytes;
            try {
                bytes = fetchStickerAsset(stickerPack.identifier, sticker.imageFileName, context);
                if (bytes.length <= 0) {
                    throw new IllegalStateException("Asset file is empty, pack: " + stickerPack.name + ", sticker: " + sticker.imageFileName);
                }
                sticker.setSize(bytes.length);
            } catch (IOException | IllegalArgumentException e) {
                throw new IllegalStateException("Asset file doesn't exist. pack: " + stickerPack.name + ", sticker: " + sticker.imageFileName, e);
            }
        }
        return stickers;
    }


    @NonNull
    private static ArrayList<StickerPack> fetchFromContentProvider(Cursor cursor) {
        ArrayList<StickerPack> stickerPackList = new ArrayList<>();
        cursor.moveToFirst();
        do {
            final String identifier = cursor.getString(cursor.getColumnIndexOrThrow(STICKER_PACK_IDENTIFIER_IN_QUERY));
            final String name = cursor.getString(cursor.getColumnIndexOrThrow(STICKER_PACK_NAME_IN_QUERY));
            final String publisher = cursor.getString(cursor.getColumnIndexOrThrow(STICKER_PACK_PUBLISHER_IN_QUERY));
            final String trayImage = cursor.getString(cursor.getColumnIndexOrThrow(STICKER_PACK_ICON_IN_QUERY));
            final String androidPlayStoreLink = cursor.getString(cursor.getColumnIndexOrThrow(ANDROID_APP_DOWNLOAD_LINK_IN_QUERY));
            final String iosAppLink = cursor.getString(cursor.getColumnIndexOrThrow(IOS_APP_DOWNLOAD_LINK_IN_QUERY));
            final String publisherEmail = cursor.getString(cursor.getColumnIndexOrThrow(PUBLISHER_EMAIL));
            final String publisherWebsite = cursor.getString(cursor.getColumnIndexOrThrow(PUBLISHER_WEBSITE));
            final String privacyPolicyWebsite = cursor.getString(cursor.getColumnIndexOrThrow(PRIVACY_POLICY_WEBSITE));
            final String licenseAgreementWebsite = cursor.getString(cursor.getColumnIndexOrThrow(LICENSE_AGREEMENT_WEBSITE));
            final String imageDataVersion = cursor.getString(cursor.getColumnIndexOrThrow(IMAGE_DATA_VERSION));
            final boolean avoidCache = cursor.getShort(cursor.getColumnIndexOrThrow(AVOID_CACHE)) > 0;
            final boolean animatedStickerPack = cursor.getShort(cursor.getColumnIndexOrThrow(ANIMATED_STICKER_PACK)) > 0;
            final StickerPack stickerPack = new StickerPack(identifier, name, publisher, trayImage, publisherEmail, publisherWebsite, privacyPolicyWebsite, licenseAgreementWebsite, imageDataVersion, avoidCache, animatedStickerPack);
            stickerPack.setAndroidPlayStoreLink(androidPlayStoreLink);
            stickerPack.setIosAppStoreLink(iosAppLink);
            stickerPackList.add(stickerPack);
        } while (cursor.moveToNext());
        return stickerPackList;
    }

    @NonNull
    private static List<Sticker> fetchFromContentProviderForStickers(@NonNull Context context, String identifier) {
        final ContentResolver contentResolver = context.getContentResolver();
        final Uri uri = getStickerListUri(context, identifier);

        final String[] projection = {STICKER_FILE_NAME_IN_QUERY, STICKER_FILE_EMOJI_IN_QUERY, STICKER_FILE_ACCESSIBILITY_TEXT_IN_QUERY};
        final Cursor cursor = contentResolver.query(uri, projection, null, null, null);
        List<Sticker> stickers = new ArrayList<>();
        if (cursor != null && cursor.getCount() > 0) {
            cursor.moveToFirst();
            do {
                final String name = cursor.getString(cursor.getColumnIndexOrThrow(STICKER_FILE_NAME_IN_QUERY));
                final String emojisConcatenated = cursor.getString(cursor.getColumnIndexOrThrow(STICKER_FILE_EMOJI_IN_QUERY));
                final String accessibilityText = cursor.getString(cursor.getColumnIndexOrThrow(STICKER_FILE_ACCESSIBILITY_TEXT_IN_QUERY));
                List<String> emojis = new ArrayList<>(StickerPackValidator.EMOJI_MAX_LIMIT);
                if (!TextUtils.isEmpty(emojisConcatenated)) {
                    emojis = Arrays.asList(emojisConcatenated.split(","));
                }
                stickers.add(new Sticker(name, emojis, accessibilityText));
            } while (cursor.moveToNext());
        }
        if (cursor != null) {
            cursor.close();
        }
        return stickers;
    }

    static byte[] fetchStickerAsset(@NonNull final String identifier, @NonNull final String name, @NonNull Context context) throws IOException {
        final Uri uri = getStickerAssetUri(context, identifier, name);
        try (final InputStream inputStream = context.getContentResolver().openInputStream(uri);
             final ByteArrayOutputStream buffer = new ByteArrayOutputStream()) {
            if (inputStream == null) {
                throw new IOException("cannot read sticker asset:" + identifier + "/" + name);
            }
            int read;
            byte[] data = new byte[16384];

            while ((read = inputStream.read(data, 0, data.length)) != -1) {
                buffer.write(data, 0, read);
            }
            return buffer.toByteArray();
        }
    }

    @NonNull
    private static Uri getStickerListUri(@NonNull Context context, String identifier) {
        return new Uri.Builder().scheme(ContentResolver.SCHEME_CONTENT).authority(StickerContentProvider.getAuthority(context)).appendPath(StickerContentProvider.STICKERS).appendPath(identifier).build();
    }

    @NonNull
    static Uri getStickerAssetUri(@NonNull Context context, String identifier, String stickerName) {
        return new Uri.Builder().scheme(ContentResolver.SCHEME_CONTENT).authority(StickerContentProvider.getAuthority(context)).appendPath(StickerContentProvider.STICKERS_ASSET).appendPath(identifier).appendPath(stickerName).build();
    }
}
