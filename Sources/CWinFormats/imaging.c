// Pictures through WIC, the Windows Imaging Component: the codecs Windows has (BMP, GIF, ICO, JPEG, PNG, TIFF, JPEG XR,
// DDS) and the ones the Microsoft Store adds (RAW, HEIF, WebP, AVIF, JPEG XL), decoded straight to the size asked.
#define COBJMACROS
#include <windows.h>
#include <wincodec.h>
#include <propidl.h>
#include <stdlib.h>
#include "CWinFormats.h"

// Defined here rather than linked from windowscodecs.lib's or uuid.lib's GUIDs.
static const CLSID CLSID_WICImagingFactory_ = {0xcacaf262, 0x9370, 0x4615, {0xa1, 0x3b, 0x9f, 0x55, 0x39, 0xda, 0x4c, 0x0a}};
static const IID IID_IWICImagingFactory_ = {0xec5ec8a9, 0xc395, 0x4314, {0x9c, 0x77, 0x54, 0xd7, 0xa9, 0x35, 0xff, 0x70}};
static const GUID GUID_WICPixelFormat24bppRGB_ = {0x6fddc324, 0x4e03, 0x4bfe, {0xb1, 0x85, 0x3d, 0x77, 0x76, 0x8d, 0xc9, 0x0d}};

/// The EXIF orientation WIC's metadata reader finds for the frame (through the photo policy name, which maps to the
/// right place in JPEG, TIFF, RAW and HEIF), or 0.
static int orientationOf(IWICBitmapFrameDecode *frame) {
    IWICMetadataQueryReader *reader = NULL;
    if (FAILED(IWICBitmapFrameDecode_GetMetadataQueryReader(frame, &reader)) || !reader) return 0;
    int orientation = 0;
    const WCHAR *names[] = {L"System.Photo.Orientation", L"/app1/ifd/{ushort=274}", L"/ifd/{ushort=274}"};
    for (int i = 0; i < 3 && orientation == 0; i++) {
        PROPVARIANT value;
        PropVariantInit(&value);
        if (SUCCEEDED(IWICMetadataQueryReader_GetMetadataByName(reader, names[i], &value))) {
            if (value.vt == VT_UI2) orientation = value.uiVal;
            else if (value.vt == VT_UI4) orientation = (int)value.ulVal;
            else if (value.vt == VT_I4) orientation = value.lVal;
        }
        PropVariantClear(&value);
    }
    IWICMetadataQueryReader_Release(reader);
    return orientation >= 1 && orientation <= 8 ? orientation : 0;
}

int digup_wic_decode(const uint16_t *path, int max_pixel, int *stored_width, int *stored_height, int *orientation,
                     int *width, int *height, uint8_t **rgb) {
    HRESULT started = CoInitializeEx(NULL, COINIT_MULTITHREADED);
    IWICImagingFactory *factory = NULL;
    IWICBitmapDecoder *decoder = NULL;
    IWICBitmapFrameDecode *frame = NULL;
    IWICFormatConverter *converter = NULL;
    IWICBitmapScaler *scaler = NULL;
    uint8_t *pixels = NULL;
    int result = DIGUP_NO_READER;
    if (FAILED(CoCreateInstance(&CLSID_WICImagingFactory_, NULL, CLSCTX_INPROC_SERVER, &IID_IWICImagingFactory_,
                                (void **)&factory))) goto done;
    // No decoder for the file's kind: WINCODEC_ERR_COMPONENTNOTFOUND. Anything else is this file.
    HRESULT opened = IWICImagingFactory_CreateDecoderFromFilename(factory, (const WCHAR *)path, NULL, GENERIC_READ,
                                                                  WICDecodeMetadataCacheOnDemand, &decoder);
    if (opened == WINCODEC_ERR_COMPONENTNOTFOUND) goto done;
    result = DIGUP_UNREADABLE;
    if (FAILED(opened) || FAILED(IWICBitmapDecoder_GetFrame(decoder, 0, &frame))) goto done;
    UINT w = 0, h = 0;
    if (FAILED(IWICBitmapFrameDecode_GetSize(frame, &w, &h)) || w == 0 || h == 0) goto done;
    *stored_width = (int)w;
    *stored_height = (int)h;
    *orientation = orientationOf(frame);
    if (FAILED(IWICImagingFactory_CreateFormatConverter(factory, &converter))
        || FAILED(IWICFormatConverter_Initialize(converter, (IWICBitmapSource *)frame, &GUID_WICPixelFormat24bppRGB_,
                                                 WICBitmapDitherTypeNone, NULL, 0.0, WICBitmapPaletteTypeCustom)))
        goto done;
    IWICBitmapSource *source = (IWICBitmapSource *)converter;
    UINT outW = w, outH = h;
    UINT longest = w > h ? w : h;
    if (max_pixel > 0 && longest > (UINT)max_pixel) {
        double scale = (double)max_pixel / longest;
        outW = (UINT)(w * scale + 0.5);
        outH = (UINT)(h * scale + 0.5);
        if (outW < 1) outW = 1;
        if (outH < 1) outH = 1;
        if (FAILED(IWICImagingFactory_CreateBitmapScaler(factory, &scaler))
            || FAILED(IWICBitmapScaler_Initialize(scaler, source, outW, outH, WICBitmapInterpolationModeFant)))
            goto done;
        source = (IWICBitmapSource *)scaler;
    }
    if ((unsigned long long)outW * outH > 400000000ULL / 3) goto done;   // 400 MB: more than any picture needs
    UINT stride = outW * 3;
    pixels = malloc((size_t)stride * outH);
    if (!pixels || FAILED(IWICBitmapSource_CopyPixels(source, NULL, stride, stride * outH, pixels))) goto done;
    *width = (int)outW;
    *height = (int)outH;
    *rgb = pixels;
    pixels = NULL;
    result = DIGUP_READ;
done:
    free(pixels);
    if (scaler) IWICBitmapScaler_Release(scaler);
    if (converter) IWICFormatConverter_Release(converter);
    if (frame) IWICBitmapFrameDecode_Release(frame);
    if (decoder) IWICBitmapDecoder_Release(decoder);
    if (factory) IWICImagingFactory_Release(factory);
    if (SUCCEEDED(started)) CoUninitialize();
    return result;
}
