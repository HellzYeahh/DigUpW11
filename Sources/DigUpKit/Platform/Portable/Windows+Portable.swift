// Windows' own readers (Sources/CWinFormats), for what the portable readers can't read: a document's text through the
// IFilter Windows Search uses for its type, and pictures through WIC, with the codecs Windows and the Microsoft Store
// add (camera RAW, JPEG XR, DDS, icons, tiled TIFF).
#if os(Windows)
import CWinFormats
import Foundation

enum WindowsReaders {
    /// The document's text through its IFilter (Windows' Office filter, for .doc). Nil when this computer has no filter
    /// for the file's type, or its filter couldn't read this file or found no text in it: DigUp's own reader tries then.
    static func text(of url: URL) throws -> String? {
        var units: UnsafeMutablePointer<UInt16>?
        var length = 0
        let result = nativePath(url).withCString(encodedAs: UTF16.self) {
            digup_filter_text($0, WordDoc.maxCharacters, &units, &length)
        }
        defer { digup_free(units) }
        switch Int(result) {
        case Int(DIGUP_READ):
            guard let units else { return nil }
            let text = String(decoding: UnsafeBufferPointer(start: units, count: length), as: UTF16.self)
            return text.allSatisfy(\.isWhitespace) ? nil : text
        case Int(DIGUP_LOCKED):
            throw ExtractError.locked
        default:
            return nil
        }
    }

    struct Picture {
        let image: RGBImage        // as stored (not turned), its long side at most the size asked
        let storedWidth: Int
        let storedHeight: Int
        let orientation: Int?      // EXIF orientation, as WIC's metadata reader found it
    }

    /// The picture through WIC, scaled so its long side is at most `maxPixel`. Nil when no codec on this computer reads
    /// this kind of picture; throws when one does and can't read this one.
    static func picture(_ url: URL, maxPixel: Int) throws -> Picture? {
        var storedWidth: Int32 = 0, storedHeight: Int32 = 0, orientation: Int32 = 0, width: Int32 = 0, height: Int32 = 0
        var rgb: UnsafeMutablePointer<UInt8>?
        let result = nativePath(url).withCString(encodedAs: UTF16.self) {
            digup_wic_decode($0, Int32(clamping: maxPixel), &storedWidth, &storedHeight, &orientation, &width, &height,
                             &rgb)
        }
        defer { digup_free(rgb) }
        switch Int(result) {
        case Int(DIGUP_READ):
            guard let rgb, width > 0, height > 0 else { throw ExtractError.unreadable("can't decode image") }
            let pixels = Array(UnsafeBufferPointer(start: rgb, count: Int(width) * Int(height) * 3))
            return Picture(image: RGBImage(width: Int(width), height: Int(height), pixels: pixels),
                           storedWidth: Int(storedWidth), storedHeight: Int(storedHeight),
                           orientation: orientation > 0 ? Int(orientation) : nil)
        case Int(DIGUP_NO_READER):
            return nil
        default:
            throw ExtractError.unreadable("can't decode image")
        }
    }

    /// The path as Windows' own calls take it, with backslashes.
    private static func nativePath(_ url: URL) -> String {
        url.path.replacingOccurrences(of: "/", with: "\\")
    }
}
#endif
