// Windows' own readers (Sources/CWinFormats): the Office filter for .doc, when the computer has it, and WIC.
#if os(Windows)
import Foundation
import Testing
@testable import DigUpKit

@Suite struct WindowsReadersTests {
    @Test func officeFilterReadsLegacyWord() throws {
        let report = LegacyWordTests.documents.appendingPathComponent("report.doc")
        guard let text = try WindowsReaders.text(of: report) else {
            print("No IFilter reads .doc on this computer: DigUp's own reader reads them")
            return
        }
        #expect(text.contains("Revenue grew by twelve percent"))
        #expect(text.contains("আমার সোনার বাংলা"))
        #expect(text.contains("cell two"))
    }

    @Test func wicDecodesToTheSizeAsked() throws {
        // pattern-o6.tiff: 400×240 as stored, red and green above blue and yellow, orientation 6.
        let tiff = ImageTests.pictures.appendingPathComponent("pattern-o6.tiff")
        let picture = try #require(try WindowsReaders.picture(tiff, maxPixel: 200))
        #expect(picture.storedWidth == 400 && picture.storedHeight == 240)
        #expect(picture.image.width == 200 && picture.image.height == 120)
        let (w, h, p) = (picture.image.width, picture.image.height, picture.image.pixels)
        let topLeft = ((h / 4) * w + w / 4) * 3
        #expect(p[topLeft] > 128 && p[topLeft + 1] < 128 && p[topLeft + 2] < 128)   // red
        #expect(picture.orientation == nil || picture.orientation == 6)
    }

    @Test func wicSaysWhenNoCodecReadsAFile() throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("DigUpWIC-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let text = folder.appendingPathComponent("notes.ico")
        try Data("not a picture".utf8).write(to: text)
        #expect(throws: ExtractError.self) {
            try ImageExtractor.prepare(text, maxPixel: 256, minSide: 0, to: folder, png: false)
        }
    }
}
#endif
