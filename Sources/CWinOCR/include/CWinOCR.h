// Windows' own text recognition (Windows.Media.Ocr) as plain C, for the engine's OCR on Windows
// (Platform/Portable/OCR+Portable.swift). Strings are UTF-16, NUL-terminated going in.
#pragma once
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/// A recognizer for one language. Recognitions on one engine run one at a time.
typedef struct WinOCREngine WinOCREngine;

/// A recognizer for `language` (a BCP-47 tag such as "ar"), or with NULL for the first of the user's languages that
/// Windows has OCR for. NULL when Windows has none for it (its OCR comes with the language's pack).
WinOCREngine *winocr_engine_create(const uint16_t *language);

/// The largest width or height `winocr_recognize` takes, in pixels.
uint32_t winocr_max_dimension(void);

/// The text in a picture of packed 8-bit RGB, one line of text per line (UTF-16, `*length` units), to be
/// freed with `winocr_free`. NULL when recognition failed; a picture with no text gives an empty string.
uint16_t *winocr_recognize(WinOCREngine *engine, const uint8_t *rgb, int32_t width, int32_t height, int32_t *length);

void winocr_free(uint16_t *text);

#ifdef __cplusplus
}
#endif
