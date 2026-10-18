// Windows.Media.Ocr through its COM interfaces (the Windows SDK's ABI headers and WRL), so the engine needs no WinRT
// projection: a SoftwareBitmap filled from the RGB pixels, OcrEngine.RecognizeAsync waited on, the lines' text joined.
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include "CWinOCR.h"

#include <windows.h>
#include <roapi.h>
#include <winstring.h>
#include <MemoryBuffer.h>
#include <windows.foundation.h>
#include <windows.globalization.h>
#include <windows.graphics.imaging.h>
#include <windows.media.ocr.h>
#include <wrl/client.h>
#include <wrl/event.h>
#include <wrl/ftm.h>
#include <wrl/implements.h>
#include <wrl/wrappers/corewrappers.h>

#include <cstdlib>
#include <cstring>
#include <new>
#include <string>

using Microsoft::WRL::ComPtr;
using Microsoft::WRL::Wrappers::HString;
using Microsoft::WRL::Wrappers::HStringReference;
namespace Foundation = ABI::Windows::Foundation;
namespace Globalization = ABI::Windows::Globalization;
namespace Imaging = ABI::Windows::Graphics::Imaging;
namespace Ocr = ABI::Windows::Media::Ocr;

struct WinOCREngine {
    ComPtr<Ocr::IOcrEngine> engine;
    SRWLOCK lock = SRWLOCK_INIT;
};

namespace {

/// WinRT needs the calling thread in an apartment: the multithreaded one, joined once per thread (the indexer's
/// threads have none of their own). A thread already in a single-threaded one can call too.
bool joinApartment() {
    thread_local HRESULT joined = RoInitialize(RO_INIT_MULTITHREADED);
    return SUCCEEDED(joined) || joined == RPC_E_CHANGED_MODE;
}

template <typename T>
HRESULT factory(const wchar_t *runtimeClass, ComPtr<T> &out) {
    return RoGetActivationFactory(HStringReference(runtimeClass).Get(), IID_PPV_ARGS(&out));
}

/// A SoftwareBitmap (BGRA, the format OCR takes) holding the RGB pixels.
HRESULT makeBitmap(const uint8_t *rgb, int32_t width, int32_t height, ComPtr<Imaging::ISoftwareBitmap> &out) {
    ComPtr<Imaging::ISoftwareBitmapFactory> bitmaps;
    HRESULT hr = factory(RuntimeClass_Windows_Graphics_Imaging_SoftwareBitmap, bitmaps);
    if (FAILED(hr)) return hr;
    ComPtr<Imaging::ISoftwareBitmap> bitmap;
    hr = bitmaps->CreateWithAlpha(Imaging::BitmapPixelFormat::BitmapPixelFormat_Bgra8, width, height,
                                  Imaging::BitmapAlphaMode::BitmapAlphaMode_Ignore, &bitmap);
    if (FAILED(hr)) return hr;
    {
        // The buffer stays locked while any reference to it is open, so both close before the bitmap is read.
        ComPtr<Imaging::IBitmapBuffer> buffer;
        hr = bitmap->LockBuffer(Imaging::BitmapBufferAccessMode::BitmapBufferAccessMode_Write, &buffer);
        if (FAILED(hr)) return hr;
        Imaging::BitmapPlaneDescription plane{};
        hr = buffer->GetPlaneDescription(0, &plane);
        if (FAILED(hr)) return hr;
        ComPtr<Foundation::IMemoryBuffer> memory;
        hr = buffer.As(&memory);
        if (FAILED(hr)) return hr;
        ComPtr<Foundation::IMemoryBufferReference> reference;
        hr = memory->CreateReference(&reference);
        if (FAILED(hr)) return hr;
        ComPtr<::Windows::Foundation::IMemoryBufferByteAccess> access;
        hr = reference.As(&access);
        if (FAILED(hr)) return hr;
        BYTE *bytes = nullptr;
        UINT32 capacity = 0;
        hr = access->GetBuffer(&bytes, &capacity);
        if (FAILED(hr)) return hr;
        if (plane.Width < width || plane.Height < height ||
            UINT64(plane.StartIndex) + UINT64(plane.Stride) * UINT64(height - 1) + UINT64(width) * 4 > capacity) {
            return E_UNEXPECTED;
        }
        for (int32_t y = 0; y < height; y++) {
            const uint8_t *from = rgb + size_t(y) * size_t(width) * 3;
            BYTE *to = bytes + plane.StartIndex + size_t(y) * size_t(plane.Stride);
            for (int32_t x = 0; x < width; x++, from += 3, to += 4) {
                to[0] = from[2];
                to[1] = from[1];
                to[2] = from[0];
                to[3] = 0xFF;
            }
        }
        ComPtr<Foundation::IClosable> closable;
        if (SUCCEEDED(reference.As(&closable))) closable->Close();
        if (SUCCEEDED(buffer.As(&closable))) closable->Close();
    }
    out = bitmap;
    return S_OK;
}

/// Waits for the recognition: an agile handler (it runs on whichever thread finishes the work) signals an event.
HRESULT await(const ComPtr<Foundation::IAsyncOperation<Ocr::OcrResult *>> &operation, ComPtr<Ocr::IOcrResult> &out) {
    Microsoft::WRL::Wrappers::Event done(CreateEventExW(nullptr, nullptr, CREATE_EVENT_MANUAL_RESET, EVENT_ALL_ACCESS));
    if (!done.IsValid()) return HRESULT_FROM_WIN32(GetLastError());
    HANDLE signal = done.Get();
    auto handler = Microsoft::WRL::Callback<Microsoft::WRL::Implements<
        Microsoft::WRL::RuntimeClassFlags<Microsoft::WRL::ClassicCom>,
        Foundation::IAsyncOperationCompletedHandler<Ocr::OcrResult *>, Microsoft::WRL::FtmBase>>(
        [signal](auto, auto) -> HRESULT {
            SetEvent(signal);
            return S_OK;
        });
    if (!handler) return E_OUTOFMEMORY;
    HRESULT hr = operation->put_Completed(handler.Get());
    if (FAILED(hr)) return hr;
    WaitForSingleObjectEx(signal, INFINITE, FALSE);
    return operation->GetResults(&out);
}

}  // namespace

extern "C" WinOCREngine *winocr_engine_create(const uint16_t *language) {
    if (!joinApartment()) return nullptr;
    ComPtr<Ocr::IOcrEngineStatics> engines;
    if (FAILED(factory(RuntimeClass_Windows_Media_Ocr_OcrEngine, engines))) return nullptr;
    ComPtr<Ocr::IOcrEngine> engine;
    if (language) {
        ComPtr<Globalization::ILanguageFactory> languages;
        if (FAILED(factory(RuntimeClass_Windows_Globalization_Language, languages))) return nullptr;
        HString tag;
        if (FAILED(tag.Set(reinterpret_cast<const wchar_t *>(language)))) return nullptr;
        ComPtr<Globalization::ILanguage> wanted;
        if (FAILED(languages->CreateLanguage(tag.Get(), &wanted))) return nullptr;
        if (FAILED(engines->TryCreateFromLanguage(wanted.Get(), &engine))) return nullptr;
    } else if (FAILED(engines->TryCreateFromUserProfileLanguages(&engine))) {
        return nullptr;
    }
    if (!engine) return nullptr;   // no OCR for that language on this computer
    auto made = new (std::nothrow) WinOCREngine;
    if (made) made->engine = engine;
    return made;
}

extern "C" uint32_t winocr_max_dimension(void) {
    UINT32 side = 0;
    ComPtr<Ocr::IOcrEngineStatics> engines;
    if (joinApartment() && SUCCEEDED(factory(RuntimeClass_Windows_Media_Ocr_OcrEngine, engines))) {
        engines->get_MaxImageDimension(&side);
    }
    return side;
}

extern "C" uint16_t *winocr_recognize(WinOCREngine *engine, const uint8_t *rgb, int32_t width, int32_t height,
                                      int32_t *length) {
    *length = 0;
    if (!engine || !rgb || width <= 0 || height <= 0 || !joinApartment()) return nullptr;
    ComPtr<Imaging::ISoftwareBitmap> bitmap;
    if (FAILED(makeBitmap(rgb, width, height, bitmap))) return nullptr;
    ComPtr<Ocr::IOcrResult> result;
    AcquireSRWLockExclusive(&engine->lock);
    ComPtr<Foundation::IAsyncOperation<Ocr::OcrResult *>> operation;
    HRESULT hr = engine->engine->RecognizeAsync(bitmap.Get(), &operation);
    if (SUCCEEDED(hr)) hr = await(operation, result);
    ReleaseSRWLockExclusive(&engine->lock);
    if (FAILED(hr) || !result) return nullptr;

    ComPtr<Foundation::Collections::IVectorView<Ocr::OcrLine *>> lines;
    if (FAILED(result->get_Lines(&lines))) return nullptr;
    unsigned count = 0;
    if (FAILED(lines->get_Size(&count))) return nullptr;
    std::wstring text;
    for (unsigned index = 0; index < count; index++) {
        ComPtr<Ocr::IOcrLine> line;
        if (FAILED(lines->GetAt(index, &line))) continue;
        HString words;
        if (FAILED(line->get_Text(words.GetAddressOf()))) continue;
        UINT32 size = 0;
        const wchar_t *raw = WindowsGetStringRawBuffer(words.Get(), &size);
        if (size == 0) continue;
        if (!text.empty()) text += L'\n';
        text.append(raw, size);
    }
    auto out = static_cast<uint16_t *>(std::malloc((text.size() + 1) * sizeof(uint16_t)));
    if (!out) return nullptr;
    std::memcpy(out, text.data(), text.size() * sizeof(uint16_t));
    out[text.size()] = 0;
    *length = int32_t(text.size());
    return out;
}

extern "C" void winocr_free(uint16_t *text) { std::free(text); }
