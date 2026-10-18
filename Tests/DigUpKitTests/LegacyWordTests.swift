// Legacy Word files (.doc, Word 97–2003), in Documents/ (written by LibreOffice; notes.doc then given 8-bit text, as
// Word keeps text that fits Windows-1252): the Cocoa text system reads them on a Mac, Windows' Office filter or
// `WordDoc` elsewhere, and each must find the same words.
import Foundation
import Testing
@testable import DigUpKit

@Suite struct LegacyWordTests {
    static let documents = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("Documents")

    @Test func unicodeTextTablesAndFields() throws {
        let text = try DocExtractor.text(of: Self.documents.appendingPathComponent("report.doc"))
        #expect(text.contains("Quarterly report"))
        #expect(text.contains("Revenue grew by twelve percent — café naïve “quotes”."))
        #expect(text.contains("আমার সোনার বাংলা"))
        #expect(text.contains("مرحبا بالعالم"))
        #expect(text.contains("cell one") && text.contains("cell two"))
        #expect(text.contains("Final paragraph with a link field."))
        #expect(!text.contains("HYPERLINK"))   // a field's code isn't text
    }

    @Test func eightBitText() throws {
        let text = try DocExtractor.text(of: Self.documents.appendingPathComponent("notes.doc"))
        #expect(text.contains("Plain ASCII café document."))
        #expect(text.contains("invoice number INV–20931"))
    }

    #if !canImport(AppKit)
    @Test func paragraphsBecomeLines() throws {
        let text = try WordDoc.text(of: Self.documents.appendingPathComponent("notes.doc"))
        #expect(text == "Plain ASCII café document.\nSecond line here, invoice number INV–20931.\n")
    }

    /// A damaged or crafted file fails with a note, or reads what it can: it never ends the helper.
    @Test func damagedFilesDontTrap() throws {
        let file = [UInt8](try Data(contentsOf: Self.documents.appendingPathComponent("report.doc")))
        var random = SystemRandomNumberGenerator()
        for length in stride(from: 0, to: file.count, by: 97) { _ = try? WordDoc.text(Array(file.prefix(length))) }
        for _ in 0..<2000 {
            var bytes = file
            for _ in 0..<Int.random(in: 1...16, using: &random) {
                bytes[Int.random(in: 0..<bytes.count, using: &random)] = UInt8.random(in: 0...255, using: &random)
            }
            _ = try? WordDoc.text(bytes)
        }
        #expect(throws: ExtractError.self) { try WordDoc.text(Array("not a Word file at all".utf8)) }
    }

    @Test func encryptedFilesAreLocked() throws {
        var file = [UInt8](try Data(contentsOf: Self.documents.appendingPathComponent("notes.doc")))
        // The FIB's fEncrypted flag, in the WordDocument stream's first bytes (found by its signature, 0xA5EC, and
        // the version LibreOffice writes, 0x0101).
        let fib = try #require((0..<(file.count - 12)).first {
            file[$0..<($0 + 4)].elementsEqual([0xEC, 0xA5, 0x01, 0x01])
        })
        file[fib + 0x0B] |= 0x01
        #expect(throws: ExtractError.self) { try WordDoc.text(file) }
        do { _ = try WordDoc.text(file) } catch { #expect("\(error)" == "password-protected") }
    }
    #endif
}
