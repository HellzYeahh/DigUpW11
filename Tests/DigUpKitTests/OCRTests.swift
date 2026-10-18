import Foundation
import Testing
@testable import DigUpKit

/// Text recognition: Vision on a Mac, Windows.Media.Ocr on Windows (Linux has none, so only the line clean-up runs
/// there). The pictures are made by scripts/testbed/make_ocr_picture.py. Recognition runs one test at a time, on a
/// thread of its own (`offThePool`), as indexing runs it: Vision's synchronous call blocks its thread while its own work
/// may need Swift's shared threads, and a CI Mac has only three of those (a run hung with them all blocked).
@Suite(.serialized) struct OCRTests {
    static let pictures = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("Pictures")
    let folder: URL = {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("DigUpTests-\(UUID().uuidString)")
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }()

    @Test func spacesBetweenChineseAndJapaneseCharactersGo() {
        #expect(OCR.closingCJKGaps("請 求 書") == "請求書")
        #expect(OCR.closingCJKGaps("カ タ カ ナ 。") == "カタカナ。")
        #expect(OCR.closingCJKGaps("東 京 Tokyo 大 阪") == "東京 Tokyo 大阪")   // a space beside a Latin word stays
        #expect(OCR.closingCJKGaps("한국어 문장") == "한국어 문장")                // Korean spaces its words
        #expect(OCR.closingCJKGaps("payment declined") == "payment declined")
    }

    @Test(.enabled(if: OCR.isAvailable)) func aScreenshotsSmallTextIsRead() async throws {
        let picture = Self.pictures.appendingPathComponent("screenshot-text.png")
        let text = try await Self.offThePool { OCR.text(ofImageAt: picture) }
        #expect(text.contains("4417"))
        #expect(text.contains("Kyoto"))
        #expect(text.contains("externally-managed-environment"))   // the exact lookup screenshots are searched for
        let again = try await Self.offThePool { OCR.read(picture) }
        #expect(again == text)
    }

    @Test(.enabled(if: OCR.isAvailable)) func aScannedPagesWordsComeFromOCR() async throws {
        let (scan, folder) = (Self.pictures.appendingPathComponent("scan.pdf"), folder)
        let read = try await Self.offThePool {
            try PDFExtractor.pages(of: scan, range: { 0..<$0 }, minText: 40, renderPixels: 1400, to: folder)
        }
        #expect(read.total == 1)
        #expect(read.pages.first?.imagePath != nil)   // its meaning stays the picture's vector
        #expect(read.pages.first?.ocr == true)
        #expect(read.pages.first?.text.contains("QXTEST87231") == true)
    }

    @Test(.enabled(if: OCR.isAvailable && OCR.readsScreenshotsAgain))
    func screenshotsIndexedWithoutTheirWordsAreReadOnceMore() throws {
        // Windows read no screenshot's words before Windows.Media.Ocr: an older index's screenshots are read again.
        let store = try IndexStore(directory: folder)
        let unread = try store.insert(Candidate(path: "/a/Screenshot 1.png", kind: .screenshot, size: 1, mtime: 1,
                                                inode: 1, device: 1))
        try store.finish(unread, state: "done")
        let read = try store.insert(Candidate(path: "/a/Screenshot 2.png", kind: .screenshot, size: 1, mtime: 1,
                                              inode: 2, device: 1))
        try store.addSegment(file: read, kind: .ocr, modality: .text, text: "invoice 4417")
        try store.finish(read, state: "done")
        #expect(try store.readAgainOnce() == 1)
        #expect(try store.pending(limit: nil).map(\.path) == ["/a/Screenshot 1.png"])
        #expect(try store.readAgainOnce() == 0)
    }

    /// Runs `body` on a thread of Dispatch's, not on one of the few Swift concurrency shares between tests.
    static func offThePool<T: Sendable>(_ body: @escaping @Sendable () throws -> T) async throws -> T {
        try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async { continuation.resume(with: Result { try body() }) }
        }
    }
}
