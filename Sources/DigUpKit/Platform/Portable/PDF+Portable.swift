// PDFs without PDFKit (Linux, Windows): PDFium, Chromium's PDF library, prebuilt (Vendor/pdfium, scripts/fetch-vendor.sh).
// Scans' words and Arabic text layers that lost letters are read by OCR where there is one (Windows), as on a Mac.
#if !canImport(PDFKit)
import CPDFium
import Foundation

/// PDFium is one process-wide library and not thread-safe: every use goes through `withDocument`, under `lock`.
enum PDFium {
    static let lock = NSLock()
    private static let ready: Void = { FPDF_InitLibrary() }()

    /// Runs `body` with the document open. `locked` when it needs a password, `unreadable` when it won't open. PDFium
    /// reads through `FileReader` (any file name opens; a big file is never read whole).
    static func withDocument<T>(_ url: URL, _ body: (FPDF_DOCUMENT) throws -> T) throws -> T {
        _ = ready
        let reader = try FileReader(url)
        // PDFium counts in C's unsigned long: 4 GB at most on Windows.
        guard reader.size <= UInt64(CUnsignedLong.max) else { throw ExtractError.unreadable("too big") }
        var access = FPDF_FILEACCESS()
        access.m_FileLen = CUnsignedLong(reader.size)
        access.m_Param = reader.opaque
        access.m_GetBlock = { param, position, buffer, size in
            guard let buffer else { return 0 }
            return FileReader.from(param).read(at: UInt64(position), into: buffer, count: Int(size)) == Int(size) ? 1 : 0
        }
        return try withExtendedLifetime(reader) {   // PDFium reads through it until the document is closed
            try lock.withLock {
                guard let document = FPDF_LoadCustomDocument(&access, nil) else {
                    throw FPDF_GetLastError() == UInt(FPDF_ERR_PASSWORD) ? ExtractError.locked
                        : ExtractError.unreadable("can't open PDF")
                }
                defer { FPDF_CloseDocument(document) }
                return try body(document)
            }
        }
    }

    /// The page's text in reading order, lines ending in "\n".
    static func text(of page: FPDF_PAGE) -> String {
        guard let textPage = FPDFText_LoadPage(page) else { return "" }
        defer { FPDFText_ClosePage(textPage) }
        let count = FPDFText_CountChars(textPage)
        guard count > 0 else { return "" }
        var buffer = [UInt16](repeating: 0, count: Int(count) + 1)
        let written = FPDFText_GetText(textPage, 0, count, &buffer)
        guard written > 1 else { return "" }
        return String(decoding: buffer[0..<Int(written - 1)], as: UTF16.self)
            .replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
    }

    /// The page as a picture, fitted into a square of `pixels` (as PDFKit's thumbnail is on macOS), annotations drawn.
    static func render(_ page: FPDF_PAGE, pixels: Int) -> RGBImage? {
        let width = Double(FPDF_GetPageWidthF(page)), height = Double(FPDF_GetPageHeightF(page))
        guard width > 0, height > 0 else { return nil }
        let scale = Double(pixels) / max(width, height)
        return bitmap(page, width: max(1, Int((width * scale).rounded())), height: max(1, Int((height * scale).rounded())))
    }

    /// The page drawn `width` × `height` pixels, on white, annotations drawn.
    static func bitmap(_ page: FPDF_PAGE, width w: Int, height h: Int) -> RGBImage? {
        guard let bitmap = FPDFBitmap_Create(Int32(w), Int32(h), 0) else { return nil }
        defer { FPDFBitmap_Destroy(bitmap) }
        _ = FPDFBitmap_FillRect(bitmap, 0, 0, Int32(w), Int32(h), 0xFFFF_FFFF)
        FPDF_RenderPageBitmap(bitmap, page, 0, 0, Int32(w), Int32(h), 0, FPDF_ANNOT)
        guard let buffer = FPDFBitmap_GetBuffer(bitmap) else { return nil }
        let stride = Int(FPDFBitmap_GetStride(bitmap))
        let bytes = buffer.assumingMemoryBound(to: UInt8.self)   // BGRx
        var rgb = [UInt8](repeating: 0, count: w * h * 3)
        for y in 0..<h {
            for x in 0..<w {
                let s = y * stride + x * 4, d = (y * w + x) * 3
                rgb[d] = bytes[s + 2]
                rgb[d + 1] = bytes[s + 1]
                rgb[d + 2] = bytes[s]
            }
        }
        return RGBImage(width: w, height: h, pixels: rgb)
    }

    /// Where `words` are on the page (as keyword search finds them: `SearchText.matches`), in page space: left, top,
    /// right, bottom, one rectangle per line a match spans. The Mac app's Previews.places, over PDFium's text.
    static func places(of words: [String], on page: FPDF_PAGE) -> [(Double, Double, Double, Double)] {
        guard let textPage = FPDFText_LoadPage(page) else { return [] }
        defer { FPDFText_ClosePage(textPage) }
        let count = FPDFText_CountChars(textPage)
        guard count > 0 else { return [] }
        var buffer = [UInt16](repeating: 0, count: Int(count) + 1)
        let written = FPDFText_GetText(textPage, 0, count, &buffer)
        guard written > 1 else { return [] }
        // Unchanged (no line endings rewritten), so a match's place in it is its characters' index on the page.
        let text = String(decoding: buffer[0..<Int(written - 1)], as: UTF16.self)
        var rects: [(Double, Double, Double, Double)] = []
        for word in Set(words.filter { $0.count >= 2 }) {
            for found in SearchText.matches(of: word, in: text).prefix(200) {
                let start = text.utf16.distance(from: text.startIndex, to: found.lowerBound)
                let length = text.utf16.distance(from: found.lowerBound, to: found.upperBound)
                let lines = FPDFText_CountRects(textPage, Int32(start), Int32(length))
                for index in 0..<max(0, lines) {
                    var left = 0.0, top = 0.0, right = 0.0, bottom = 0.0
                    if FPDFText_GetRect(textPage, index, &left, &top, &right, &bottom) != 0 {
                        rects.append((left, top, right, bottom))
                    }
                }
            }
        }
        return rects
    }

    /// The page with `marks` (page space) marked yellow the way Preview marks what you searched for, showing the band
    /// of the page around the first of them: as wide as the page, 2:3 as high, so the words can be read in a small
    /// preview. The Mac app's Previews.page.
    static func render(_ page: FPDF_PAGE, pixels: Int, marking marks: [(Double, Double, Double, Double)]) -> RGBImage? {
        let width = Double(FPDF_GetPageWidthF(page)), height = Double(FPDF_GetPageHeightF(page))
        guard width > 0, height > 0, !marks.isEmpty else { return render(page, pixels: pixels) }
        // The band is never wider than the page, so the page's width fills the pixels.
        let scale = Double(pixels) / width
        let w = max(1, Int((width * scale).rounded())), h = max(1, Int((height * scale).rounded()))
        guard var image = bitmap(page, width: w, height: h) else { return nil }
        func device(_ x: Double, _ y: Double) -> (Int, Int) {
            var dx: Int32 = 0, dy: Int32 = 0
            _ = FPDF_PageToDevice(page, 0, 0, Int32(w), Int32(h), 0, x, y, &dx, &dy)
            return (Int(dx), Int(dy))
        }
        // Multiplied, as Preview's marks are: yellow (1, 0.85, 0.1) at 0.85 over the page.
        let factors: [Double] = [1, 1 - 0.85 + 0.85 * 0.85, 1 - 0.85 + 0.85 * 0.1]
        let pad = max(1, Int(scale.rounded()))
        var firstMiddle = 0
        for (index, (left, top, right, bottom)) in marks.enumerated() {
            let (x0, y0) = device(left, top), (x1, y1) = device(right, bottom)
            let xs = max(0, min(x0, x1) - pad)..<min(w, max(x0, x1) + pad)
            let ys = max(0, min(y0, y1) - pad)..<min(h, max(y0, y1) + pad)
            if index == 0 { firstMiddle = (y0 + y1) / 2 }
            guard !xs.isEmpty, !ys.isEmpty else { continue }
            for y in ys {
                for x in xs {
                    let at = (y * w + x) * 3
                    for channel in 0..<3 {
                        image.pixels[at + channel] = UInt8(Double(image.pixels[at + channel]) * factors[channel])
                    }
                }
            }
        }
        let band = min(h, max(1, Int((min(height, width / 1.5) * scale).rounded())))
        let top = min(max(0, firstMiddle - Int(Double(band) * 0.55)), h - band)
        let rows = image.pixels[(top * w * 3)..<((top + band) * w * 3)]
        return RGBImage(width: w, height: band, pixels: Array(rows))
    }

    /// A metadata string ("Title", "Author"…), or nil when there's none.
    static func meta(_ document: FPDF_DOCUMENT, _ tag: String) -> String? {
        let size = FPDF_GetMetaText(document, tag, nil, 0)
        guard size > 2 else { return nil }
        var buffer = [UInt16](repeating: 0, count: Int(size) / 2)
        _ = FPDF_GetMetaText(document, tag, &buffer, size)
        let text = String(decoding: buffer.prefix { $0 != 0 }, as: UTF16.self)
        return text.isEmpty ? nil : text
    }
}

extension PDFExtractor {
    /// Reads the pages in `range(pageCount)` (0-based). Pages with real text become text; scans, slides and pages whose
    /// text layer came out in glyph order are rendered. As on a Mac (Platform/Apple), a text layer that lost Arabic
    /// letters is replaced by OCR's reading where OCR reads Arabic, and a rendered page's words come from OCR.
    static func pages(of url: URL, range: (Int) -> Range<Int>, minText: Int, renderPixels: Int, to folder: URL)
        throws -> (pages: [Page], total: Int, title: String?) {
        try PDFium.withDocument(url) { document in
            let total = Int(FPDF_GetPageCount(document))
            var pages: [Page] = []
            for index in range(total).clamped(to: 0..<total) {
                guard let page = FPDF_LoadPage(document, Int32(index)) else { continue }
                defer { FPDF_ClosePage(page) }
                var text = PDFium.text(of: page).trimmingCharacters(in: .whitespacesAndNewlines)
                var garbled: String?
                switch PageTextProblem.check(text) {
                case .lostLetters:
                    // OCR's reading replaces the text layer only when it's real Arabic; otherwise the layer stays.
                    if OCR.readsArabic, let image = PDFium.render(page, pixels: 2000) {
                        let read = OCR.arabicText(in: image).trimmingCharacters(in: .whitespacesAndNewlines)
                        if read.count >= minText, PageTextProblem.check(read) == nil,
                           read.unicodeScalars.contains(where: { Script.arabic.contains($0.value) }) {
                            pages.append(Page(number: index + 1, text: read, imagePath: nil, ocr: true))
                            continue
                        }
                    }
                    if text.count >= minText {
                        pages.append(Page(number: index + 1, text: text, imagePath: nil))
                        continue
                    }
                case nil:
                    if text.count >= minText {
                        pages.append(Page(number: index + 1, text: text, imagePath: nil))
                        continue
                    }
                case .glyphOrder:
                    (text, garbled) = ("", text)
                }
                guard let image = PDFium.render(page, pixels: renderPixels) else { continue }
                let out = folder.appendingPathComponent(UUID().uuidString + ".png")
                try image.write(to: out, png: true)
                // A scan, or a page that's mostly a picture: its words come from OCR, for keyword search only, and its
                // meaning stays the picture's vector. Not for a text layer in glyph order (Bengali), which OCR can't
                // read either.
                var ocr = false
                if garbled == nil, OCR.isAvailable {
                    let read = OCR.text(in: image).trimmingCharacters(in: .whitespacesAndNewlines)
                    if read.count > text.count { (text, ocr) = (read, true) }
                }
                pages.append(Page(number: index + 1, text: text, imagePath: out.path, ocr: ocr, garbled: garbled))
            }
            return (pages, total, PDFium.meta(document, "Title"))
        }
    }
}

extension PDFExtractor {
    /// Page `number` (from 1) as a JPEG for a preview, fitted into a square of `pixels`; with `words`, those marked
    /// and the band of the page around them (`PDFium.render(_:pixels:marking:)`).
    static func renderPage(_ number: Int, of url: URL, pixels: Int, to out: URL, marking words: [String] = []) throws {
        try PDFium.withDocument(url) { document in
            guard let page = FPDF_LoadPage(document, Int32(number - 1)) else {
                throw ExtractError.unreadable("no page \(number)")
            }
            defer { FPDF_ClosePage(page) }
            let marks = words.isEmpty ? [] : PDFium.places(of: words, on: page)
            let image = marks.isEmpty ? PDFium.render(page, pixels: pixels) : PDFium.render(page, pixels: pixels, marking: marks)
            guard let image else {
                throw ExtractError.unreadable("can't render page \(number)")
            }
            try image.write(to: out, png: false)
        }
    }
}

extension Estimator {
    static func pages(of path: String) -> Int {
        (try? PDFium.withDocument(URL(fileURLWithPath: path)) { Int(FPDF_GetPageCount($0)) }) ?? 1
    }
}
#endif
