// A document's text through IFilter: the interface Windows Search reads documents with. LoadIFilter finds the filter
// registered for the file's type (offfilt.dll for .doc, part of Windows) and loads it in this process.
#define COBJMACROS
#include <windows.h>
#include <filter.h>
#include <filterr.h>
#include <ntquery.h>
#include <stdlib.h>
#include <string.h>
#include "CWinFormats.h"

// Defined here rather than linked from uuid.lib, which not every SDK's import libraries carry.
static const IID IID_IFilter_ = {0x89BCB740, 0x6119, 0x101A, {0xBC, 0xB7, 0x00, 0xDD, 0x01, 0x06, 0x55, 0xAF}};
// The property set and id of a document's contents (FMTID_Storage, PID_STG_CONTENTS).
static const GUID FMTID_Storage_ = {0xB725F130, 0x47EF, 0x101A, {0xA5, 0xF1, 0x02, 0x60, 0x8C, 0x9E, 0xEB, 0xAC}};
#define CONTENTS 19

typedef struct {
    uint16_t *units;
    size_t length, capacity, limit;
} Text;

/// Appends what fits under the limit; false once the text is full (or memory ran out).
static int append(Text *text, const WCHAR *units, size_t count) {
    if (text->length + count > text->limit) count = text->limit - text->length;
    if (text->length + count + 1 > text->capacity) {
        size_t capacity = text->capacity ? text->capacity : 4096;
        while (capacity < text->length + count + 1) capacity *= 2;
        uint16_t *grown = realloc(text->units, capacity * sizeof(uint16_t));
        if (!grown) return 0;
        text->units = grown;
        text->capacity = capacity;
    }
    memcpy(text->units + text->length, units, count * sizeof(uint16_t));
    text->length += count;
    text->units[text->length] = 0;
    return text->length < text->limit;
}

static int isContents(const FULLPROPSPEC *attribute) {
    return IsEqualGUID(&attribute->guidPropSet, &FMTID_Storage_) && attribute->psProperty.ulKind == PRSPEC_PROPID
        && attribute->psProperty.propid == CONTENTS;
}

int digup_filter_text(const uint16_t *path, size_t max_units, uint16_t **out, size_t *length) {
    HRESULT started = CoInitializeEx(NULL, COINIT_MULTITHREADED);   // S_FALSE: already, RPC_E_CHANGED_MODE: an STA
    IUnknown *unknown = NULL;
    IFilter *filter = NULL;
    int result = DIGUP_NO_READER;
    Text text = {NULL, 0, 0, max_units};
    if (FAILED(LoadIFilter((const WCHAR *)path, NULL, (void **)&unknown)) || !unknown) goto done;
    if (FAILED(IUnknown_QueryInterface(unknown, &IID_IFilter_, (void **)&filter)) || !filter) goto done;
    result = DIGUP_UNREADABLE;
    ULONG flags = 0;
    SCODE initialized = IFilter_Init(filter, IFILTER_INIT_CANON_PARAGRAPHS | IFILTER_INIT_HARD_LINE_BREAKS
                                     | IFILTER_INIT_CANON_HYPHENS | IFILTER_INIT_CANON_SPACES, 0, NULL, &flags);
    if (initialized == FILTER_E_PASSWORD) { result = DIGUP_LOCKED; goto done; }
    if (FAILED(initialized)) goto done;
    WCHAR buffer[4096];
    int full = 0;
    for (int chunks = 0; !full && chunks < 1000000; chunks++) {
        STAT_CHUNK chunk;
        SCODE got = IFilter_GetChunk(filter, &chunk);
        if (got == FILTER_E_END_OF_CHUNKS) break;
        if (got == FILTER_E_PASSWORD) { result = DIGUP_LOCKED; goto done; }
        if (got == FILTER_E_EMBEDDING_UNAVAILABLE || got == FILTER_E_LINK_UNAVAILABLE) continue;
        if (FAILED(got)) break;   // what was read so far stands
        if (!(chunk.flags & CHUNK_TEXT) || !isContents(&chunk.attribute)) continue;
        if (chunk.breakType != CHUNK_NO_BREAK && text.length > 0 && text.units[text.length - 1] != '\n') {
            if (!append(&text, L"\n", 1)) break;
        }
        for (;;) {
            ULONG count = sizeof buffer / sizeof buffer[0];
            SCODE read = IFilter_GetText(filter, &count, buffer);
            if (read == FILTER_E_NO_MORE_TEXT || FAILED(read)) break;
            if (count > sizeof buffer / sizeof buffer[0]) count = sizeof buffer / sizeof buffer[0];
            for (ULONG i = 0; i < count; i++) if (buffer[i] == '\r') buffer[i] = '\n';
            if (!append(&text, buffer, count)) { full = 1; break; }
            if (read == FILTER_S_LAST_TEXT) break;
        }
    }
    if (text.units || text.length == 0) {
        result = DIGUP_READ;
        if (!text.units) text.units = calloc(1, sizeof(uint16_t));
        *out = text.units;
        *length = text.length;
        text.units = NULL;
    }
done:
    free(text.units);
    if (filter) IFilter_Release(filter);
    if (unknown) IUnknown_Release(unknown);
    if (SUCCEEDED(started)) CoUninitialize();
    return result;
}

void digup_free(void *pointer) { free(pointer); }
