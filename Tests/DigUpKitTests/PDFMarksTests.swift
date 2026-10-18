// A PDF page's preview off a Mac (PDFium): the words marked, as the Mac app's preview marks them, and the band of the
// page around them.
#if !canImport(AppKit)
import Foundation
import Testing
@testable import DigUpKit

@Suite struct PDFMarksTests {
    let folder: URL = {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("DigUp-PDFMarks-\(UUID().uuidString)")
        try! FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }()

    private func page() throws -> URL {
        let url = folder.appendingPathComponent("lease.pdf")
        try TextPDF.write(["The tenant may keep one small pet, with the landlord's written consent, for the whole term "
                           + "of the lease. The deposit covers any damage the pet does."], to: url)
        return url
    }

    /// How many pixels are yellow: red and green kept, blue taken out (marks are multiplied onto the page).
    private func yellow(_ image: RGBImage) -> Int {
        stride(from: 0, to: image.pixels.count, by: 3).filter { at in
            let (r, g, b) = (Int(image.pixels[at]), Int(image.pixels[at + 1]), Int(image.pixels[at + 2]))
            return r > 180 && g > 150 && b < 120
        }.count
    }

    @Test func aPageWithoutWordsIsTheWholePageUnmarked() throws {
        let out = folder.appendingPathComponent("plain.jpg")
        try PDFExtractor.renderPage(1, of: try page(), pixels: 600, to: out)
        let image = try #require(RGBImage.load(out.path))
        #expect(image.height == 600)
        #expect(abs(image.width - 464) <= 1)   // US Letter, 612 × 792, fitted into 600
        #expect(yellow(image) == 0)
    }

    @Test func foundWordsAreMarkedInABandAsWideAsThePage() throws {
        let out = folder.appendingPathComponent("marked.jpg")
        try PDFExtractor.renderPage(1, of: try page(), pixels: 600, to: out, marking: ["pet", "deposit"])
        let image = try #require(RGBImage.load(out.path))
        #expect(image.width == 600)
        #expect(abs(image.height - 400) <= 1)   // 2:3 of the width
        #expect(yellow(image) > 100)
    }

    @Test func wordsThatArentOnThePageLeaveItWhole() throws {
        let out = folder.appendingPathComponent("missing.jpg")
        try PDFExtractor.renderPage(1, of: try page(), pixels: 600, to: out, marking: ["zebra"])
        let image = try #require(RGBImage.load(out.path))
        #expect(image.height == 600)
        #expect(yellow(image) == 0)
    }
}
#endif
