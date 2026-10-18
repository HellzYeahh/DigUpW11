// Windows' own readers, for what the portable code can't read: a document's text through the IFilter that Windows Search
// uses for its type (legacy Word .doc through Windows' Office filter), and pictures through WIC, the Windows Imaging
// Component (camera RAW with Microsoft's Raw Image Extension, JPEG XR, DDS, icons, tiled TIFF). Windows only.
#pragma once
#include <stddef.h>
#include <stdint.h>

enum {
    DIGUP_READ = 0,          // done
    DIGUP_NO_READER = 1,     // nothing on this computer reads this kind of file
    DIGUP_LOCKED = 2,        // password-protected
    DIGUP_UNREADABLE = 3,    // a reader is there, and it couldn't read this file
};

/// The text of the document at `path` (UTF-16, NUL-terminated) through its IFilter, at most `max_units` UTF-16 code
/// units of it: its contents only (not its properties), paragraphs ending in line breaks. `*text` is set on
/// DIGUP_READ and freed with `digup_free`.
int digup_filter_text(const uint16_t *path, size_t max_units, uint16_t **text, size_t *length);

/// The picture at `path` through WIC, as packed 8-bit RGB scaled so its long side is at most `max_pixel` (as stored,
/// not turned: `*orientation` is its EXIF orientation, 1–8, or 0 when it has none). `*stored_width` and
/// `*stored_height` are its size in the file. `*rgb` is set on DIGUP_READ and freed with `digup_free`.
int digup_wic_decode(const uint16_t *path, int max_pixel, int *stored_width, int *stored_height, int *orientation,
                     int *width, int *height, uint8_t **rgb);

void digup_free(void *pointer);
