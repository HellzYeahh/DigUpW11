// Text recognition without Vision. Windows has its own (Windows.Media.Ocr, through Sources/CWinOCR); Linux has none
// yet, so its screenshots and scans keep their picture vector and their name.
#if !canImport(ImageIO)
import Foundation
#if os(Windows)
import CWinOCR
#endif

extension OCR {
    #if os(Windows)
    /// One Windows recognizer, made once and kept. Recognitions on it run one at a time (the shim locks).
    final class Engine: @unchecked Sendable {
        let pointer: OpaquePointer

        init?(language: String?) {
            let made: OpaquePointer?
            if let language {
                made = winocr_engine_create(Array(language.utf16) + [0])
            } else {
                made = winocr_engine_create(nil)
            }
            guard let made else { return nil }
            pointer = made
        }

        func text(in image: RGBImage) -> String {
            var length: Int32 = 0
            guard let text = winocr_recognize(pointer, image.pixels, Int32(image.width), Int32(image.height), &length)
            else { return "" }
            defer { winocr_free(text) }
            return String(decoding: UnsafeBufferPointer(start: text, count: Int(length)), as: UTF16.self)
        }
    }

    /// For the first of the user's languages Windows reads (Vision picks the language by itself; Windows reads one
    /// at a time, and English, French, German, Chinese and the rest each come with their language's pack).
    private static let userEngine = Engine(language: nil)

    /// For Arabic, when Windows has it, for PDF pages whose text layer lost its Arabic letters.
    private static let arabicEngine = Engine(language: "ar")

    /// The largest side the recognizer takes (larger pictures are scaled down to it first).
    private static let maxSide: Int = {
        let side = Int(winocr_max_dimension())
        return side > 0 ? side : 4096
    }()

    /// Text recognition runs here when Windows reads at least one of the user's languages.
    static let isAvailable = userEngine != nil

    /// Windows reads Arabic on this computer (its language pack is installed).
    static let readsArabic = arabicEngine != nil

    /// Windows read no screenshot's words before this (0.7.0-beta.2 and earlier), so the screenshots of an older index
    /// are read once more (`IndexStore.readAgainOnce`).
    static let readsScreenshotsAgain = true

    /// The text in the picture, a line of text to a line (Windows.Media.Ocr). Read at full resolution, as Vision does
    /// on a Mac: small UI text is what screenshots are full of.
    static func text(in image: RGBImage) -> String {
        guard let userEngine else { return "" }
        return read(image, with: userEngine)
    }

    /// The text in the picture read as Arabic ("" where Windows has no Arabic).
    static func arabicText(in image: RGBImage) -> String {
        guard let arabicEngine else { return "" }
        return read(image, with: arabicEngine)
    }

    private static func read(_ image: RGBImage, with engine: Engine) -> String {
        var image = image
        let longest = max(image.width, image.height)
        if longest > maxSide {
            let scale = Double(maxSide) / Double(longest)
            guard let smaller = try? image.resized(width: max(1, Int((Double(image.width) * scale).rounded(.down))),
                                                   height: max(1, Int((Double(image.height) * scale).rounded(.down))))
            else { return "" }
            image = smaller
        }
        return engine.text(in: image).split(separator: "\n", omittingEmptySubsequences: true)
            .map { closingCJKGaps(String($0)) }.joined(separator: "\n")
    }

    /// The text in the image at `url`, for keyword search (read at full resolution, turned the way the camera held it).
    static func text(ofImageAt url: URL) -> String {
        guard isAvailable, let image = ImageExtractor.fullImage(url) else { return "" }
        return text(in: image)
    }
    #else
    static let isAvailable = false
    static let readsArabic = false
    static let readsScreenshotsAgain = false

    static func text(in image: RGBImage) -> String { "" }
    static func arabicText(in image: RGBImage) -> String { "" }

    /// No text recognition here yet: screenshots have their picture vector and their name.
    static func text(ofImageAt url: URL) -> String { "" }
    #endif
}

extension ImageExtractor {
    /// The whole picture at full resolution, turned the way the camera held it: stb, or ffmpeg for what stb can't read
    /// (HEIC, WebP, TIFF). Nil when neither reads it.
    static func fullImage(_ url: URL) -> RGBImage? {
        if let image = RGBImage.load(url.path) { return image.oriented(EXIF.read(url)?.orientation ?? 1) }
        if notReadYet(url.pathExtension.lowercased()) != nil || EXIF.read(url)?.tiled == true { return nil }
        return try? decodeWithFFmpeg(url)
    }
}
#endif
