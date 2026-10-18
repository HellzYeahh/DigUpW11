// Legacy Word files (.doc, Word 97 to 2003) without the Cocoa text system (Linux, and Windows where its Office filter
// doesn't read one): the text of the WordDocument stream, inside the file's OLE compound file, put together from the
// pieces its piece table lists ([MS-DOC] 2.4.1). Word 6 and Word 95 files keep their text another way and aren't read.
#if !canImport(AppKit)
import Foundation

enum WordDoc {
    /// The most of a file that's read: a .doc's text is a small part of it, and 256 MB is far more than Word writes.
    static let maxBytes = 256 << 20
    /// The most text kept (the indexer keeps at most 5,000 chunks of a document, about 9 M characters).
    static let maxCharacters = 16 << 20

    static func text(of url: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        let size = try handle.seekToEnd()
        guard size <= UInt64(maxBytes) else { throw ExtractError.unreadable("\(size >> 20) MB, more than is read") }
        try handle.seek(toOffset: 0)
        return try text([UInt8](try handle.read(upToCount: Int(size)) ?? Data()))
    }

    static func text(_ file: [UInt8]) throws -> String {
        let streams = try CompoundFile.streams(["WordDocument", "0Table", "1Table"], in: file)
        guard let word = streams["WordDocument"], word.u16(0) == 0xA5EC, let version = word.u16(2),
              let flags = word.u16(0x0A)
        else { throw ExtractError.unreadable("not a Word document") }
        guard version >= 0xC0 else { throw ExtractError.unreadable("Word 6 and Word 95 files aren't read on this system") }
        if flags & 0x0100 != 0 { throw ExtractError.locked }   // fEncrypted
        guard let table = streams[flags & 0x0200 != 0 ? "1Table" : "0Table"] else {
            throw ExtractError.unreadable("damaged Word document")
        }
        // The FIB: a fixed part, then three arrays, each after its own count (fibRgW, fibRgLw, fibRgFcLcb).
        guard let shorts = word.u16(32) else { throw ExtractError.unreadable("damaged Word document") }
        let longsAt = 34 + shorts * 2
        guard let longs = word.u16(longsAt),
              let mainText = word.u32(longsAt + 2 + 3 * 4),   // ccpText: the main document's characters
              let pairs = word.u16(longsAt + 2 + longs * 4), pairs > 33,
              let clxAt = word.u32(longsAt + 4 + longs * 4 + 33 * 8),   // fcClx, lcbClx
              let clxLength = word.u32(longsAt + 4 + longs * 4 + 33 * 8 + 4)
        else { throw ExtractError.unreadable("damaged Word document") }
        let units = try pieces(table, clx: clxAt, length: clxLength, in: word, characters: min(mainText, maxCharacters))
        return String(decoding: cleaned(units), as: UTF16.self)
    }

    /// The main document's text as UTF-16, from the pieces the Clx (in the table stream) lists: a run of Prc records
    /// (formatting, skipped), then the Pcdt, whose PlcPcd holds n + 1 character positions and n piece descriptors.
    private static func pieces(_ table: [UInt8], clx: Int, length: Int, in word: [UInt8], characters: Int) throws
        -> [UInt16] {
        let damaged = ExtractError.unreadable("damaged Word document")
        guard clx <= table.count, length <= table.count - clx else { throw damaged }
        let end = clx + length
        var i = clx
        while i < end, table[i] == 0x01 {
            guard let size = table.u16(i + 1) else { throw damaged }
            i += 3 + size
        }
        guard i < end, table[i] == 0x02, let size = table.u32(i + 1), size >= 4, size <= end - (i + 5) else {
            throw damaged
        }
        let plc = i + 5, count = (size - 4) / 12
        var units: [UInt16] = []
        units.reserveCapacity(min(characters, 1 << 20))
        for n in 0..<count where units.count < characters {
            guard let start = table.u32(plc + n * 4), let stop = table.u32(plc + (n + 1) * 4),
                  let position = table.u32(plc + (count + 1) * 4 + n * 8 + 2), stop > start
            else { continue }
            let wanted = min(stop - start, characters - units.count)
            if position & 0x4000_0000 != 0 {   // fCompressed: 8-bit characters in Windows-1252, at half the offset
                let at = (position & 0x3FFF_FFFF) / 2
                guard at <= word.count else { continue }
                for byte in word[at..<min(word.count, at + wanted)] {
                    units.append(UInt16(truncatingIfNeeded: RTF.windows1252(byte).value))
                }
            } else {
                guard position <= word.count else { continue }
                let stop = min(word.count, position + wanted * 2)
                var at = position
                while at + 1 < stop {
                    units.append(UInt16(word[at]) | UInt16(word[at + 1]) << 8)
                    at += 2
                }
            }
        }
        return units
    }

    /// Word's own characters made text: paragraph, line and page ends become line breaks, table cells tabs; a field
    /// keeps its result and drops its code (a hyperlink keeps its words, not "HYPERLINK …"); pictures, footnote marks
    /// and other anchors go.
    static func cleaned(_ units: [UInt16]) -> [UInt16] {
        var out: [UInt16] = []
        out.reserveCapacity(units.count)
        var fields: [Bool] = []   // per open field: still in its code (before the separator)
        for unit in units {
            switch unit {
            case 0x13: fields.append(true)
            case 0x14: if !fields.isEmpty { fields[fields.count - 1] = false }
            case 0x15: if !fields.isEmpty { fields.removeLast() }
            default:
                if fields.contains(true) { continue }
                switch unit {
                case 0x0D, 0x0B, 0x0C: out.append(0x0A)
                case 0x07: out.append(0x09)
                case 0x1E: out.append(0x2D)   // a hyphen that doesn't break
                case 0x09: out.append(0x09)
                case 0xA0: out.append(0x20)
                case ..<0x20: break   // anchors of pictures, notes and drawings, and 0x1F: a hyphen that may break
                default: out.append(unit)
                }
            }
        }
        return out
    }
}

/// The streams of an OLE compound file ([MS-CFB]): 512- or 4096-byte sectors chained through the FAT, small streams in
/// the mini stream's 64-byte sectors, and a directory of entries.
enum CompoundFile {
    private static let signature: [UInt8] = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]
    /// A sector number past every real one: the end of a chain, or an unused entry.
    private static let lastSector = 0xFFFF_FFFA

    /// The streams named `names` among the root storage's own (not those of objects embedded in it), whole.
    static func streams(_ names: Set<String>, in file: [UInt8]) throws -> [String: [UInt8]] {
        guard file.count >= 512, file.starts(with: signature) else { throw ExtractError.unreadable("not a Word document") }
        let damaged = ExtractError.unreadable("damaged Word document")
        guard let shift = file.u16(0x1E), shift == 9 || shift == 12, file.u16(0x20) == 6 else { throw damaged }
        let sectorSize = 1 << shift, miniSize = 64
        func start(_ sector: Int) -> Int? {
            let at = (sector + 1) * sectorSize
            return sector >= 0 && sector < lastSector && at < file.count ? at : nil
        }
        func entries(of sector: Int) -> [Int] {
            guard let at = start(sector) else { return [] }
            return (0..<sectorSize / 4).map { file.u32(at + $0 * 4) ?? lastSector + 4 }
        }
        // The FAT's own sectors: 109 in the header, the rest in a chain of DIFAT sectors.
        var fatSectors = (0..<109).compactMap { file.u32(0x4C + $0 * 4) }
        var difat = file.u32(0x44) ?? lastSector, hops = 0
        while difat < lastSector, hops < 1 << 16 {
            let more = entries(of: difat)
            guard !more.isEmpty else { break }
            fatSectors += more.dropLast()
            difat = more.last!
            hops += 1
        }
        let fat = fatSectors.prefix(file.u32(0x2C) ?? 0).flatMap(entries(of:))
        /// The sectors of the chain from `first`, through `table` (a loop ends it).
        func chain(_ first: Int, _ table: [Int]) -> [Int] {
            var sectors: [Int] = [], sector = first
            while sector >= 0, sector < table.count, sectors.count <= table.count {
                sectors.append(sector)
                sector = table[sector]
            }
            return sectors
        }
        func read(_ first: Int, _ size: Int) -> [UInt8] {
            var out: [UInt8] = []
            for sector in chain(first, fat) {
                guard out.count < size, let at = start(sector) else { break }
                out += file[at..<min(file.count, at + sectorSize, at + size - out.count)]
            }
            return out
        }
        let directory = read(file.u32(0x30) ?? lastSector, fat.count * sectorSize)
        struct Entry { let name: String, type: UInt8, first: Int, size: Int, left: Int, right: Int, child: Int }
        let found: [Entry] = stride(from: 0, to: directory.count - 127, by: 128).map { at in
            let length = min(64, directory.u16(at + 64) ?? 0)
            let name = (0..<max(0, length / 2 - 1)).map { UInt16(directory.u16(at + $0 * 2) ?? 0) }
            return Entry(name: String(decoding: name, as: UTF16.self), type: directory[at + 66],
                         first: directory.u32(at + 116) ?? lastSector, size: directory.u32(at + 120) ?? 0,
                         left: directory.u32(at + 68) ?? lastSector, right: directory.u32(at + 72) ?? lastSector,
                         child: directory.u32(at + 76) ?? lastSector)
        }
        guard let root = found.first, root.type == 5 else { throw damaged }
        // Small streams live in the mini stream (the root's own data), in sectors the mini FAT chains.
        let cutoff = file.u32(0x38) ?? 4096
        let miniStream = read(root.first, root.size)
        let miniFATSector = file.u32(0x3C) ?? lastSector
        let miniFAT = chain(miniFATSector, fat).prefix(file.u32(0x40) ?? 0).flatMap(entries(of:))
        func readMini(_ first: Int, _ size: Int) -> [UInt8] {
            var out: [UInt8] = []
            for sector in chain(first, miniFAT) {
                let at = sector * miniSize
                guard out.count < size, at < miniStream.count else { break }
                out += miniStream[at..<min(miniStream.count, at + miniSize, at + size - out.count)]
            }
            return out
        }
        // The root's children: a red-black tree, through each entry's left and right siblings.
        var streams: [String: [UInt8]] = [:]
        var pending = [root.child], seen = Set<Int>()
        while let index = pending.popLast() {
            guard index < found.count, seen.insert(index).inserted else { continue }
            let entry = found[index]
            pending += [entry.left, entry.right]
            if entry.type == 2, names.contains(entry.name), streams[entry.name] == nil {
                streams[entry.name] = entry.size < cutoff ? readMini(entry.first, entry.size) : read(entry.first, entry.size)
            }
        }
        return streams
    }
}

private extension Array where Element == UInt8 {
    /// A little-endian number at `at`, or nil past the end.
    func u16(_ at: Int) -> Int? {
        at >= 0 && at <= count - 2 ? Int(self[at]) | Int(self[at + 1]) << 8 : nil
    }

    func u32(_ at: Int) -> Int? {
        guard at >= 0, at <= count - 4 else { return nil }
        return Int(self[at]) | Int(self[at + 1]) << 8 | Int(self[at + 2]) << 16 | Int(self[at + 3]) << 24
    }
}
#endif
