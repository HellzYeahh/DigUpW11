// Camera RAW pictures where ImageIO isn't there (Linux, Windows): the JPEG pictures cameras keep inside their RAW files
// (the camera's own rendering, usually at full size or near it), found where each format says, or by looking for JPEG
// starts in the file for the formats that keep them elsewhere (CR3, ORF). Decoding one is many times faster than
// developing the RAW data itself, and the model sees at most 1,536 pixels of it either way.
#if !canImport(ImageIO)
import CStb
import Foundation

struct RAWPreviews {
    struct Preview {
        let offset: Int
        let length: Int
        let width: Int
        let height: Int
        var longSide: Int { max(width, height) }
    }

    var previews: [Preview] = []
    /// How the camera was held (the RAW's own IFD0, or a CR3's CMT1), when the file says.
    var orientation: Int?
    /// EXIF DateTimeOriginal, as written by the camera.
    var taken: String?

    /// The largest preview, for the picture's size.
    var largest: Preview? { previews.max { $0.width * $0.height < $1.width * $1.height } }

    /// The smallest preview with a long side of at least `pixels` (the cheapest to decode that's big enough), or nil.
    func smallest(atLeast pixels: Int) -> Preview? {
        previews.filter { $0.longSide >= pixels }.min { $0.width * $0.height < $1.width * $1.height }
    }

    /// The previews of the RAW file at `url`, and what it says of how and when it was taken.
    static func read(_ url: URL) -> RAWPreviews {
        var found = RAWPreviews()
        guard let file = RAWFile(url), let start = file.bytes(0, 16) else { return found }
        var candidates: [(offset: Int, length: Int)] = []
        if start.starts(with: Array("FUJIFILMCCD-RAW".utf8)) {
            // RAF: the JPEG's offset and length at 84 and 88, big-endian.
            if let offset = file.u32(84, little: false), let length = file.u32(88, little: false) {
                candidates.append((offset, length))
            }
        } else if start.starts(with: [0x49, 0x49]) || start.starts(with: [0x4D, 0x4D]) {
            // TIFF-based (CR2, NEF, ARW, DNG, PEF, SRW, RW2 and ORF with their own magic numbers, and the rest).
            candidates = found.walkTIFF(file, at: 0, previews: true)
        } else if start[4..<8].elementsEqual("ftyp".utf8), let head = file.bytes(0, min(file.size, 1 << 18)) {
            // CR3: how it was held in CMT1 (a TIFF IFD0) and when in CMT2 (an Exif IFD), both in the moov box.
            for name in ["CMT1", "CMT2"] {
                if let at = head.firstRange(of: Array(name.utf8))?.upperBound { _ = found.walkTIFF(file, at: at) }
            }
        }
        found.previews = candidates.compactMap { file.jpeg(at: $0.offset, length: $0.length) }
        if found.previews.isEmpty {
            found.previews = file.jpegStarts().compactMap { file.jpeg(at: $0, length: file.size - $0) }
        }
        return found
    }

    /// Decodes `preview` from the file (nil when stb can't).
    static func decode(_ preview: Preview, in url: URL) -> (image: RGBImage, exif: EXIF?)? {
        guard let file = RAWFile(url), let bytes = file.bytes(preview.offset, preview.length) else { return nil }
        let data = Data(bytes)
        guard let image = RGBImage.load(data) else { return nil }
        return (image, EXIF.read(data))
    }

    /// Walks the TIFF structure whose header is at `base` (offsets count from there): IFD0 and the IFDs after it, their
    /// SubIFDs and Exif IFD. Notes the orientation (IFD0's) and the date, and returns where JPEG pictures are: a
    /// JPEGInterchangeFormat, a JPEG-compressed single strip, or a Panasonic JpgFromRaw.
    private mutating func walkTIFF(_ file: RAWFile, at base: Int, previews: Bool = false)
        -> [(offset: Int, length: Int)] {
        guard let order = file.bytes(base, 2), order == [0x49, 0x49] || order == [0x4D, 0x4D],
              let first = file.u32(base + 4, little: order == [0x49, 0x49]) else { return [] }
        let little = order == [0x49, 0x49]
        var found: [(offset: Int, length: Int)] = []
        var pending = [(base + first, true)], seen = Set<Int>()
        while let next = pending.popLast(), seen.count < 64 {
            let (ifd, isFirst) = next
            guard seen.insert(ifd).inserted, let count = file.u16(ifd, little: little), count <= 1000,
                  let entries = file.bytes(ifd + 2, count * 12 + 4) else { continue }
            func u16(_ at: Int) -> Int { little ? Int(entries[at]) | Int(entries[at + 1]) << 8
                                                : Int(entries[at]) << 8 | Int(entries[at + 1]) }
            func u32(_ at: Int) -> Int { little ? u16(at) | u16(at + 2) << 16 : u16(at) << 16 | u16(at + 2) }
            var jpeg: (offset: Int?, length: Int?) = (nil, nil)
            var strip: (offset: Int?, length: Int?) = (nil, nil)
            var compression = 0
            for n in 0..<count {
                let e = n * 12, tag = u16(e), type = u16(e + 2), number = u32(e + 4)
                let value = type == 3 ? u16(e + 8) : u32(e + 8)   // the first value of a SHORT or LONG
                switch tag {
                case 0x0112 where isFirst && orientation == nil && type == 3: orientation = value
                case 0x0201: jpeg.offset = base + value
                case 0x0202: jpeg.length = value
                case 0x0103: compression = value
                case 0x0111 where number == 1: strip.offset = base + value
                case 0x0117 where number == 1: strip.length = value
                case 0x002E where type == 7 && previews: found.append((base + u32(e + 8), number))   // JpgFromRaw
                case 0x014A where type == 4 || type == 13:   // SubIFDs: one offset in place, or a list elsewhere
                    if number == 1 {
                        pending.append((base + value, false))
                    } else if let list = file.bytes(base + value, min(number, 16) * 4) {
                        for k in 0..<min(number, 16) {
                            let b = list[(k * 4)..<(k * 4 + 4)].map { Int($0) }
                            let offset = little ? b[0] | b[1] << 8 | b[2] << 16 | b[3] << 24
                                                : b[0] << 24 | b[1] << 16 | b[2] << 8 | b[3]
                            pending.append((base + offset, false))
                        }
                    }
                case 0x8769 where type == 4 || type == 13: pending.append((base + value, false))   // Exif IFD
                case 0x9003 where type == 2 && number >= 19 && taken == nil:
                    if let text = file.bytes(base + value, 19) { taken = String(decoding: text, as: UTF8.self) }
                default: break
                }
            }
            if previews, let offset = jpeg.offset, let length = jpeg.length { found.append((offset, length)) }
            if previews, compression == 6 || compression == 7, let offset = strip.offset, let length = strip.length {
                found.append((offset, length))
            }
            if u32(count * 12) != 0 { pending.append((base + u32(count * 12), false)) }
        }
        return found
    }
}

/// A RAW file, read where asked.
private final class RAWFile {
    /// What's read to learn a JPEG's size: its headers come first, but a maker note can make them long.
    static let headerBytes = 1 << 19
    /// The most of a found JPEG start that's read: a camera's largest preview is a few MB.
    static let maxPreviewBytes = 64 << 20
    let size: Int
    private let handle: FileHandle

    init?(_ url: URL) {
        guard let handle = try? FileHandle(forReadingFrom: url), let end = try? handle.seekToEnd(),
              end <= UInt64(Int.max) else { return nil }
        self.handle = handle
        size = Int(end)
    }

    deinit { try? handle.close() }

    /// `count` bytes from `at`, or nil when the file doesn't hold them.
    func bytes(_ at: Int, _ count: Int) -> [UInt8]? {
        guard at >= 0, count >= 0, at <= size, count <= size - at, (try? handle.seek(toOffset: UInt64(at))) != nil,
              let data = try? handle.read(upToCount: count), data.count == count else { return nil }
        return [UInt8](data)
    }

    func u16(_ at: Int, little: Bool) -> Int? {
        guard let b = bytes(at, 2) else { return nil }
        return little ? Int(b[0]) | Int(b[1]) << 8 : Int(b[0]) << 8 | Int(b[1])
    }

    func u32(_ at: Int, little: Bool) -> Int? {
        guard let b = bytes(at, 4) else { return nil }
        return little ? Int(b[0]) | Int(b[1]) << 8 | Int(b[2]) << 16 | Int(b[3]) << 24
                      : Int(b[0]) << 24 | Int(b[1]) << 16 | Int(b[2]) << 8 | Int(b[3])
    }

    /// The JPEG picture at `at` (at most `length` bytes of it), if stb reads its headers: a baseline or progressive
    /// JPEG, not the lossless JPEG some RAW formats keep their sensor data in.
    func jpeg(at: Int, length: Int) -> RAWPreviews.Preview? {
        let length = min(length, size - max(0, at), Self.maxPreviewBytes)
        guard length > 4, let head = bytes(at, min(length, Self.headerBytes)), head[0] == 0xFF, head[1] == 0xD8
        else { return nil }
        var width: Int32 = 0, height: Int32 = 0, channels: Int32 = 0
        let read = head.withUnsafeBufferPointer {
            stbi_info_from_memory($0.baseAddress, Int32($0.count), &width, &height, &channels)
        }
        guard read != 0, width > 0, height > 0 else { return nil }
        return RAWPreviews.Preview(offset: at, length: length, width: Int(width), height: Int(height))
    }

    /// Where JPEG pictures may start (FF D8 FF), anywhere in the file, read 8 MB at a time; at most 64 of them.
    func jpegStarts() -> [Int] {
        var starts: [Int] = []
        let block = 8 << 20
        var at = 0
        while at < size, starts.count < 64 {
            guard let chunk = bytes(at, min(block + 2, size - at)) else { break }
            chunk.withUnsafeBufferPointer { b in
                var i = 0
                while i + 2 < b.count, starts.count < 64 {
                    if b[i] == 0xFF, b[i + 1] == 0xD8, b[i + 2] == 0xFF, i < block { starts.append(at + i) }
                    i += 1
                }
            }
            at += block
        }
        return starts
    }
}
#endif
