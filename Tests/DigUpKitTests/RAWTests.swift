// Camera RAW pictures off a Mac, read from the JPEG previews inside them: RAW files made here around ImageTests'
// pattern-o6.jpg (a 400×240 pattern stored turned, orientation 6), laid out as the formats lay them out.
#if !canImport(ImageIO)
import Foundation
import Testing
@testable import DigUpKit

@Suite struct RAWTests {
    let folder: URL = {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("DigUpRAW-\(UUID().uuidString)")
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }()
    let pattern = [UInt8](try! Data(contentsOf: ImageTests.pictures.appendingPathComponent("pattern-o6.jpg")))

    /// A green 200×120 JPEG, for a thumbnail.
    func thumbnail() throws -> [UInt8] {
        let url = folder.appendingPathComponent("thumb-\(UUID().uuidString).jpg")
        try RGBImage(width: 200, height: 120, pixels: [UInt8](repeating: 0, count: 200 * 120 * 3).enumerated()
            .map { $0.offset % 3 == 1 ? 255 : 0 }).write(to: url, png: false)
        return [UInt8](try Data(contentsOf: url))
    }

    static func le16(_ value: Int) -> [UInt8] { [UInt8(value & 0xFF), UInt8(value >> 8 & 0xFF)] }
    static func le32(_ value: Int) -> [UInt8] { le16(value & 0xFFFF) + le16(value >> 16) }
    static func entry(_ tag: Int, _ type: Int, _ count: Int, _ value: Int) -> [UInt8] {
        le16(tag) + le16(type) + le32(count) + le32(value)
    }

    /// As NEF and ARW are: IFD0 holds the orientation, a SubIFD with the big preview and the Exif IFD with the date;
    /// IFD1 a thumbnail.
    func tiffRAW(orientation: Int) throws -> [UInt8] {
        let thumb = try thumbnail()
        let (ifd0, sub, ifd1, exif, date) = (8, 50, 80, 110, 128)
        let previewAt = 148, thumbAt = previewAt + pattern.count
        var file: [UInt8] = Array("II".utf8) + Self.le16(42) + Self.le32(ifd0)
        file += Self.le16(3) + Self.entry(0x0112, 3, 1, orientation) + Self.entry(0x014A, 4, 1, sub)
            + Self.entry(0x8769, 4, 1, exif) + Self.le32(ifd1)
        file += Self.le16(2) + Self.entry(0x0201, 4, 1, previewAt) + Self.entry(0x0202, 4, 1, pattern.count)
            + Self.le32(0)
        file += Self.le16(2) + Self.entry(0x0201, 4, 1, thumbAt) + Self.entry(0x0202, 4, 1, thumb.count) + Self.le32(0)
        file += Self.le16(1) + Self.entry(0x9003, 2, 20, date) + Self.le32(0)
        file += Array("2025:01:02 03:04:05\0".utf8)
        #expect(file.count == previewAt)
        return file + pattern + thumb
    }

    func write(_ bytes: [UInt8], _ name: String) throws -> URL {
        let url = folder.appendingPathComponent(name)
        try Data(bytes).write(to: url)
        return url
    }

    @Test func tiffBasedRAWIsReadFromItsPreview() throws {
        let raw = try write(try tiffRAW(orientation: 6), "photo.nef")
        let prepared = try ImageExtractor.prepare(raw, maxPixel: 1024, minSide: 256, to: folder, png: true)
        #expect(prepared.width == 400 && prepared.height == 240)   // the largest preview's size
        #expect(prepared.taken == "2025:01:02 03:04:05")             // the RAW's own date, not the preview's
        let shown = try ImageTests.decode(prepared.path)
        // Turned once, by the RAW's orientation (the preview says the same, and isn't turned twice).
        #expect(shown.width == 240 && shown.height == 400)
        #expect(shown.quadrants == ["B", "R", "Y", "G"])
    }

    @Test func theSmallestPreviewBigEnoughIsDecoded() throws {
        let raw = try write(try tiffRAW(orientation: 1), "photo.arw")
        let prepared = try ImageExtractor.prepare(raw, maxPixel: 150, minSide: 0, to: folder, png: true)
        let shown = try ImageTests.decode(prepared.path)
        #expect(shown.width == 150 && shown.height == 90)
        #expect(shown.quadrants == ["G", "G", "G", "G"])   // the thumbnail, not the 400×240 preview
        #expect(prepared.width == 400 && prepared.height == 240)
        #expect(throws: ExtractError.self) {
            try ImageExtractor.prepare(raw, maxPixel: 1024, minSide: 401, to: folder, png: true)
        }
    }

    @Test func rafKeepsItsPreviewWhereItsHeaderSays() throws {
        var file = Array("FUJIFILMCCD-RAW 0201FF383501".utf8)
        file += [UInt8](repeating: 0, count: 84 - file.count)
        file += [0, 0, 0, 100] + [UInt8(pattern.count >> 24), UInt8(pattern.count >> 16 & 0xFF),
                                  UInt8(pattern.count >> 8 & 0xFF), UInt8(pattern.count & 0xFF)]
        file += [UInt8](repeating: 0, count: 100 - file.count) + pattern
        let prepared = try ImageExtractor.prepare(try write(file, "photo.raf"), maxPixel: 1024, minSide: 256,
                                                  to: folder, png: true)
        #expect(prepared.taken == "2024:05:17 10:30:00")   // the preview's own EXIF: the RAF header has none
        let shown = try ImageTests.decode(prepared.path)
        #expect(shown.width == 240 && shown.height == 400)
        #expect(shown.quadrants == ["B", "R", "Y", "G"])
    }

    /// ORF and CR3 keep their previews where no TIFF tag points (a maker note, a box of their own): they're found by
    /// looking for a JPEG's start.
    @Test func previewsElsewhereAreFound() throws {
        var random = SystemRandomNumberGenerator()
        let noise = (0..<5000).map { _ in UInt8.random(in: 0...0xFE, using: &random) }
        let file = Array("IIRO".utf8) + Self.le32(8) + Self.le16(0) + Self.le32(0) + noise + pattern + noise
        let prepared = try ImageExtractor.prepare(try write(file, "photo.orf"), maxPixel: 1024, minSide: 256,
                                                  to: folder, png: true)
        let shown = try ImageTests.decode(prepared.path)
        #expect(shown.width == 240 && shown.height == 400)
        #expect(shown.quadrants == ["B", "R", "Y", "G"])
    }

    @Test func noPreviewSaysSo() throws {
        let file = Array("II".utf8) + Self.le16(42) + Self.le32(8) + Self.le16(0) + Self.le32(0)
        do {
            _ = try ImageExtractor.prepare(try write(file, "photo.dng"), maxPixel: 1024, minSide: 256, to: folder,
                                           png: true)
            Issue.record("a RAW file without a preview was read")
        } catch {
            #expect("\(error)".hasPrefix("unreadable: this RAW picture (DNG) has no preview DigUp reads"))
        }
    }

    /// A damaged or crafted RAW file is a note, never a trap.
    @Test func damagedFilesDontTrap() throws {
        let good = try tiffRAW(orientation: 6)
        var random = SystemRandomNumberGenerator()
        let starts = [Array("II*\0".utf8), Array("MM\0*".utf8), Array("FUJIFILMCCD-RAW ".utf8),
                      [0, 0, 0, 24] + Array("ftypcrx ".utf8)]
        for n in 0..<400 {
            var bytes = n < 200 ? good : starts[n % starts.count] + (0..<2000).map { _ in UInt8.random(in: 0...255) }
            for _ in 0..<Int.random(in: 1...24, using: &random) {
                bytes[Int.random(in: 0..<bytes.count, using: &random)] = UInt8.random(in: 0...255, using: &random)
            }
            let url = try write(bytes, "damaged.cr2")
            _ = RAWPreviews.read(url)
            _ = try? ImageExtractor.prepare(url, maxPixel: 256, minSide: 0, to: folder, png: false)
        }
    }
}
#endif
