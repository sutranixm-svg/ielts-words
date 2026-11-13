package com.dsh.ielts;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;

/** 只暴露口语练习的 rec.m4a，和更新包的 provider 分开。 */
public class RecProvider extends ContentProvider {
    public static final String AUTHORITY = "com.dsh.ielts.rec";
    static final String FILE_NAME = "rec.m4a";

    public static Uri uriFor(Context ctx) {
        return new Uri.Builder().scheme("content").authority(AUTHORITY).appendPath(FILE_NAME).build();
    }

    private File audio() throws FileNotFoundException {
        File cache = getContext().getCacheDir();
        File f = new File(cache, FILE_NAME);
        try {
            String canon = f.getCanonicalPath();
            if (!canon.equals(new File(cache.getCanonicalPath(), FILE_NAME).getCanonicalPath())) {
                throw new FileNotFoundException("forbidden");
            }
        } catch (FileNotFoundException e) {
            throw e;
        } catch (Exception e) {
            throw new FileNotFoundException("forbidden");
        }
        return f;
    }

    private boolean allowed(Uri uri) {
        return uri != null && FILE_NAME.equals(uri.getLastPathSegment());
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!allowed(uri)) throw new FileNotFoundException("forbidden");
        File f = audio();
        if (!f.isFile()) throw new FileNotFoundException(String.valueOf(uri));
        return ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        if (!allowed(uri)) return null;
        File f;
        try {
            f = audio();
        } catch (FileNotFoundException e) {
            return null;
        }
        if (!f.isFile()) return null;
        String[] cols = projection != null ? projection : new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE};
        MatrixCursor c = new MatrixCursor(cols, 1);
        Object[] row = new Object[cols.length];
        for (int i = 0; i < cols.length; i++) {
            if (OpenableColumns.DISPLAY_NAME.equals(cols[i])) row[i] = FILE_NAME;
            else if (OpenableColumns.SIZE.equals(cols[i])) row[i] = f.length();
            else row[i] = null;
        }
        c.addRow(row);
        return c;
    }

    @Override
    public String getType(Uri uri) {
        return "audio/mp4";
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        return null;
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        return 0;
    }
}
