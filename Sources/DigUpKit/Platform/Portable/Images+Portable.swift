// Pictures without ImageIO (Linux, Windows): stb_image decodes, stb_image_resize2 scales, stb_image_write encodes
// (Vendor/stb, scripts/fetch-vendor.sh); what stb can't read goes through ffmpeg, and on Windows through WIC; nanosvg
// draws SVGs; camera RAW files give up the JPEG previews inside them (Platform/Portable/RAW+Portable.swift).
#if !canImport(ImageIO)
import CNanoSVG
import CStb
import Foundation

extension ImageExtractor {
    /// SVGs are drawn (nanosvg), as AppKit draws them on a Mac.
    static let drawsVectorPictures = true

    /// Writes a downscaled copy for the model: decoded in full, turned the way the camera held it, scaled so the long
    /// side is `maxPixel`. stb reads JPEG, PNG, BMP, GIF, PSD, TGA, HDR and PNM here; HEIC, WebP, TIFF, AVIF, JPEG
    /// 2000 and OpenEXR go through ffmpeg (`decodeWithFFmpeg`), and on Windows what neither reads goes through WIC
    /// (`decodeWithWIC`). RAW
    /// pictures are read from their previews (`raw`), SVGs drawn (`drawn`).
    static func prepare(_ url: URL, maxPixel: Int, minSide: Int, to folder: URL, png: Bool) throws -> Prepared {
        let ext = url.pathExtension.lowercased()
        if ext == "svg" { return try drawn(url, maxPixel: maxPixel, minSide: minSide, to: folder, png: png) }
        if Rules.rawExtensions.contains(ext) {
            return try write(try raw(url, maxPixel: maxPixel, minSide: minSide), maxPixel: maxPixel, to: folder, png: png)
        }
        let exif = EXIF.read(url)
        let image: RGBImage
        let width: Int, height: Int
        var storedWidth: Int32 = 0, storedHeight: Int32 = 0, channels: Int32 = 0
        if stbi_info(url.path, &storedWidth, &storedHeight, &channels) != 0 {
            (width, height) = (Int(storedWidth), Int(storedHeight))
            guard max(width, height) >= minSide else { throw ExtractError.tooSmall(width, height) }
            guard let decoded = RGBImage.load(url.path) else { throw ExtractError.unreadable("can't decode image") }
            image = decoded.oriented(exif?.orientation ?? 1)
        } else {
            #if os(Windows)
            // WIC first for what ffmpeg reads wrong or not at all (tiled TIFF, JPEG XR, DDS, icons), and after it for
            // the rest (a HEIC ffmpeg can't read, with the HEIF extension from the Store).
            let wicFirst = exif?.tiled == true || !Rules.ffmpegPictureExtensions.contains(ext)
            if wicFirst, let read = try decodeWithWIC(url, exif: exif, maxPixel: maxPixel, minSide: minSide) {
                return try write(read, maxPixel: maxPixel, to: folder, png: png)
            }
            do {
                image = try decodeWithFFmpeg(url)
            } catch {
                guard !wicFirst, let read = try decodeWithWIC(url, exif: exif, maxPixel: maxPixel, minSide: minSide)
                else { throw error }
                return try write(read, maxPixel: maxPixel, to: folder, png: png)
            }
            #else
            if exif?.tiled == true {
                throw ExtractError.unreadable("tiled TIFF pictures aren't read on this system yet")
            }
            image = try decodeWithFFmpeg(url)
            #endif
            // Its size as shown (ImageIO reports it as stored: the two differ for a picture turned 90°).
            (width, height) = (image.width, image.height)
            guard max(width, height) >= minSide else { throw ExtractError.tooSmall(width, height) }
        }
        return try write(Read(image: image, width: width, height: height, taken: exif?.dateTimeOriginal),
                         maxPixel: maxPixel, to: folder, png: png)
    }

    /// A picture decoded and turned the way it's shown, with what `Prepared` says of it.
    struct Read {
        var image: RGBImage
        let width: Int
        let height: Int
        let taken: String?
    }

    /// Scales the picture so its long side is at most `maxPixel` and writes it into `folder`.
    private static func write(_ read: Read, maxPixel: Int, to folder: URL, png: Bool) throws -> Prepared {
        var image = read.image
        let longest = max(image.width, image.height)
        if longest > maxPixel {
            let scale = Double(maxPixel) / Double(longest)
            image = try image.resized(width: max(1, Int((Double(image.width) * scale).rounded())),
                                      height: max(1, Int((Double(image.height) * scale).rounded())))
        }
        let out = folder.appendingPathComponent(UUID().uuidString + (png ? ".png" : ".jpg"))
        try image.write(to: out, png: png)
        return Prepared(path: out.path, width: read.width, height: read.height, taken: read.taken)
    }

    /// A camera RAW picture, from the smallest JPEG preview inside it that's at least `maxPixel` on its long side (on a
    /// Mac, ImageIO develops the RAW data; the camera's preview is that picture as the camera developed it). With no
    /// preview that big: on Windows, the RAW data through WIC (Microsoft's Raw Image Extension); otherwise, or when
    /// that can't, the largest preview there is. Its size is the largest preview's, which is the photo's own for most
    /// cameras.
    static func raw(_ url: URL, maxPixel: Int, minSide: Int) throws -> Read {
        let found = RAWPreviews.read(url)
        let ext = url.pathExtension.uppercased()
        func fromPreview(_ preview: RAWPreviews.Preview) throws -> Read? {
            guard let largest = found.largest else { return nil }
            guard largest.longSide >= minSide else { throw ExtractError.tooSmall(largest.width, largest.height) }
            guard let decoded = RAWPreviews.decode(preview, in: url) else { return nil }
            // The RAW's own orientation; the preview's only when the RAW doesn't say (never both: a camera that writes
            // one into each means the same turn).
            let exif = decoded.exif
            return Read(image: decoded.image.oriented(found.orientation ?? exif?.orientation ?? 1),
                        width: largest.width, height: largest.height, taken: found.taken ?? exif?.dateTimeOriginal)
        }
        if let preview = found.smallest(atLeast: maxPixel), let read = try fromPreview(preview) { return read }
        #if os(Windows)
        let exif = EXIF.read(url)
        if let read = try? decodeWithWIC(url, exif: exif, maxPixel: maxPixel, minSide: minSide,
                                         orientation: found.orientation) {
            return Read(image: read.image, width: read.width, height: read.height,
                        taken: found.taken ?? read.taken)
        }
        #endif
        if let preview = found.largest, let read = try fromPreview(preview) { return read }
        #if os(Windows)
        throw ExtractError.unreadable("this RAW picture (\(ext)) has no preview DigUp reads; Microsoft's Raw Image "
                                      + "Extension reads it")
        #else
        throw ExtractError.unreadable("this RAW picture (\(ext)) has no preview DigUp reads")
        #endif
    }

    #if os(Windows)
    /// The picture through WIC, turned the way the file says (its EXIF, else what WIC's metadata reader found), or nil
    /// when no codec here reads its kind. Its size is as stored, as ImageIO reports it.
    static func decodeWithWIC(_ url: URL, exif: EXIF?, maxPixel: Int, minSide: Int, orientation: Int? = nil) throws
        -> Read? {
        guard let picture = try WindowsReaders.picture(url, maxPixel: maxPixel) else { return nil }
        let (width, height) = (picture.storedWidth, picture.storedHeight)
        guard max(width, height) >= minSide else { throw ExtractError.tooSmall(width, height) }
        let turn = orientation ?? exif?.orientation ?? picture.orientation ?? 1
        return Read(image: picture.image.oriented(turn), width: width, height: height, taken: exif?.dateTimeOriginal)
    }
    #endif

    /// An SVG: nanosvg draws it, straight at the size the model needs (a vector picture has no pixels of its own: its
    /// size in pixels stands for them), as AppKit does on a Mac. Transparent parts come out white, as they look on a
    /// page. nanosvg draws shapes, paths and gradients; text in an SVG isn't drawn.
    private static func drawn(_ url: URL, maxPixel: Int, minSide: Int, to folder: URL, png: Bool) throws -> Prepared {
        let data = try Data(contentsOf: url)
        guard data.count <= maxSVGBytes else { throw ExtractError.unreadable("can't read this picture") }
        var text = [CChar](repeating: 0, count: data.count + 1)   // nanosvg parses in place, up to a NUL
        data.withUnsafeBytes { bytes in
            text.withUnsafeMutableBytes { $0.copyMemory(from: bytes) }
        }
        guard let svg = nsvgParse(&text, "px", 96) else { throw ExtractError.unreadable("can't read this picture") }
        defer { nsvgDelete(svg) }
        let (pointsWide, pointsHigh) = (Double(svg.pointee.width), Double(svg.pointee.height))
        guard pointsWide > 0, pointsHigh > 0, svg.pointee.shapes != nil
        else { throw ExtractError.unreadable("can't read this picture") }
        let (width, height) = (Int(pointsWide.rounded()), Int(pointsHigh.rounded()))
        guard max(width, height) >= minSide else { throw ExtractError.tooSmall(width, height) }
        let scale = Double(maxPixel) / max(pointsWide, pointsHigh)
        let side = (max(1, Int((pointsWide * scale).rounded())), max(1, Int((pointsHigh * scale).rounded())))
        guard let rasterizer = nsvgCreateRasterizer() else { throw ExtractError.unreadable("can't draw this picture") }
        defer { nsvgDeleteRasterizer(rasterizer) }
        var rgba = [UInt8](repeating: 0, count: side.0 * side.1 * 4)
        rgba.withUnsafeMutableBufferPointer {
            nsvgRasterize(rasterizer, svg, 0, 0, Float(scale), $0.baseAddress, Int32(side.0), Int32(side.1),
                          Int32(side.0 * 4))
        }
        var pixels = [UInt8](repeating: 255, count: side.0 * side.1 * 3)
        for i in 0..<(side.0 * side.1) {   // onto white
            let alpha = Int(rgba[i * 4 + 3])
            for c in 0..<3 {
                pixels[i * 3 + c] = UInt8((Int(rgba[i * 4 + c]) * alpha + 255 * (255 - alpha) + 127) / 255)
            }
        }
        let out = folder.appendingPathComponent(UUID().uuidString + (png ? ".png" : ".jpg"))
        try RGBImage(width: side.0, height: side.1, pixels: pixels).write(to: out, png: png)
        return Prepared(path: out.path, width: width, height: height, taken: nil)
    }

    /// The biggest SVG that's drawn: past this it's map or plot data, slow to parse and not a picture to look at.
    static let maxSVGBytes = 64 << 20

    /// The whole picture, through ffmpeg as 8-bit RGB (PPM down a pipe), turned the way the file says (irot/imir in
    /// HEIF, the EXIF orientation elsewhere) and, for a tiled HEIC, stitched whole. ffmpeg 8.1 and later do both
    /// (2026-10-11; 6.1 reads no HEIC and leaves WebP and TIFF unturned), so builds bring their own. A
    /// TIFF stored in tiles (ImageIO writes uncompressed ones that way) comes out black, so `prepare` doesn't ask.
    static func decodeWithFFmpeg(_ url: URL) throws -> RGBImage {
        guard FFmpeg.ffmpeg != nil else {
            throw ExtractError.unreadable("ffmpeg isn't installed (HEIC, WebP and TIFF pictures need it)")
        }
        let ext = url.pathExtension.lowercased()
        // OpenEXR keeps linear light: read at 16 bits and put on sRGB's curve here, as ImageIO shows it, not left
        // dark (ffmpeg's own ways of doing it differ between versions).
        let linear = ext == "exr"
        var data = Data()
        do {
            try FFmpeg.run(FFmpeg.ffmpeg, ["-v", "error", "-nostdin", "-i", url.path, "-frames:v", "1", "-pix_fmt",
                                           linear ? "rgb48be" : "rgb24", "-f", "image2pipe", "-c:v", "ppm", "-"]) {
                data.append($0)
            }
        } catch {
            if ext == "heic" || ext == "heif" { throw ExtractError.unreadable("this ffmpeg can't read HEIC (8.1 can)") }
            throw ExtractError.unreadable("can't decode image")
        }
        guard let image = linear ? RGBImage.loadLinear(data) : RGBImage.load(data) else {
            throw ExtractError.unreadable("can't decode image")
        }
        return image
    }
}

extension OCR {
    static let isAvailable = false

    /// No text recognition here yet: screenshots have their picture vector and their name.
    static func text(ofImageAt url: URL) -> String { "" }
}

/// Packed 8-bit RGB in memory: what stb decodes to and encodes from.
struct RGBImage {
    var width: Int
    var height: Int
    var pixels: [UInt8]

    /// Decoded from a file (nil when stb can't read it).
    static func load(_ path: String) -> RGBImage? {
        var width: Int32 = 0, height: Int32 = 0, channels: Int32 = 0
        guard let pixels = stbi_load(path, &width, &height, &channels, 3) else { return nil }
        defer { stbi_image_free(pixels) }
        return RGBImage(width: Int(width), height: Int(height),
                        pixels: Array(UnsafeBufferPointer(start: pixels, count: Int(width) * Int(height) * 3)))
    }

    /// Decoded from a file's bytes in memory (nil when stb can't read them).
    /// A 16-bit picture of linear light (a PPM, as ffmpeg writes one), put on sRGB's curve. stb hands a 16-bit PPM's
    /// values over as the file keeps them, big-endian.
    static func loadLinear(_ data: Data) -> RGBImage? {
        guard !data.isEmpty, data.count <= Int(Int32.max) else { return nil }
        var width: Int32 = 0, height: Int32 = 0, channels: Int32 = 0
        let values = data.withUnsafeBytes { bytes in
            stbi_load_16_from_memory(bytes.bindMemory(to: UInt8.self).baseAddress, Int32(bytes.count), &width, &height,
                                     &channels, 3)
        }
        guard let values else { return nil }
        defer { stbi_image_free(values) }
        let count = Int(width) * Int(height) * 3
        return RGBImage(width: Int(width), height: Int(height),
                        pixels: UnsafeBufferPointer(start: values, count: count).map {
                            sRGBCurve[Int(UInt16(bigEndian: $0)) >> 4]
                        })
    }

    /// sRGB's transfer curve, from 12 bits of linear light to 8 bits.
    private static let sRGBCurve: [UInt8] = (0..<4096).map { step in
        let linear = Double(step) / 4095
        let encoded = linear <= 0.0031308 ? linear * 12.92 : 1.055 * pow(linear, 1 / 2.4) - 0.055
        return UInt8((encoded * 255).rounded())
    }

    static func load(_ data: Data) -> RGBImage? {
        guard !data.isEmpty, data.count <= Int(Int32.max) else { return nil }
        var width: Int32 = 0, height: Int32 = 0, channels: Int32 = 0
        let pixels = data.withUnsafeBytes { bytes in
            stbi_load_from_memory(bytes.bindMemory(to: UInt8.self).baseAddress, Int32(bytes.count), &width, &height,
                                  &channels, 3)
        }
        guard let pixels else { return nil }
        defer { stbi_image_free(pixels) }
        return RGBImage(width: Int(width), height: Int(height),
                        pixels: Array(UnsafeBufferPointer(start: pixels, count: Int(width) * Int(height) * 3)))
    }

    /// Turned the way the camera held it (EXIF orientation 1–8), as ImageIO's thumbnails are.
    func oriented(_ orientation: Int) -> RGBImage {
        guard (2...8).contains(orientation) else { return self }
        let swaps = orientation >= 5
        let (w, h) = swaps ? (height, width) : (width, height)
        var out = [UInt8](repeating: 0, count: pixels.count)
        for y in 0..<h {
            for x in 0..<w {
                let sx: Int, sy: Int   // the source pixel that lands at (x, y)
                switch orientation {
                case 2: (sx, sy) = (width - 1 - x, y)                  // mirrored
                case 3: (sx, sy) = (width - 1 - x, height - 1 - y)     // upside down
                case 4: (sx, sy) = (x, height - 1 - y)                 // flipped
                case 5: (sx, sy) = (y, x)                              // transposed
                case 6: (sx, sy) = (y, height - 1 - x)                 // 90° clockwise
                case 7: (sx, sy) = (width - 1 - y, height - 1 - x)     // transverse
                default: (sx, sy) = (width - 1 - y, x)                 // 8: 90° counterclockwise
                }
                let s = (sy * width + sx) * 3, d = (y * w + x) * 3
                out[d] = pixels[s]
                out[d + 1] = pixels[s + 1]
                out[d + 2] = pixels[s + 2]
            }
        }
        return RGBImage(width: w, height: h, pixels: out)
    }

    func resized(width newWidth: Int, height newHeight: Int) throws -> RGBImage {
        var out = [UInt8](repeating: 0, count: newWidth * newHeight * 3)
        let done = out.withUnsafeMutableBufferPointer { out in
            stbir_resize_uint8_srgb(pixels, Int32(width), Int32(height), 0, out.baseAddress, Int32(newWidth),
                                    Int32(newHeight), 0, STBIR_RGB) != nil
        }
        guard done else { throw ExtractError.unreadable("can't resize image") }
        return RGBImage(width: newWidth, height: newHeight, pixels: out)
    }

    func write(to url: URL, png: Bool) throws {
        let written = png ? stbi_write_png(url.path, Int32(width), Int32(height), 3, pixels, Int32(width * 3))
                          : stbi_write_jpg(url.path, Int32(width), Int32(height), 3, pixels, 90)
        guard written != 0 else { throw ExtractError.unreadable("can't write \(url.lastPathComponent)") }
    }

    /// 8×8 average hash, as `VideoExtractor.averageHash` on macOS: gray cells brighter than the mean are 1.
    func averageHash() -> UInt64 {
        let side = 8
        var cells = [Int](repeating: 0, count: side * side)
        for cy in 0..<side {
            let y0 = cy * height / side, y1 = min(height, max(y0 + 1, (cy + 1) * height / side))
            for cx in 0..<side {
                let x0 = cx * width / side, x1 = min(width, max(x0 + 1, (cx + 1) * width / side))
                var sum = 0, n = 0
                for y in y0..<y1 {
                    for x in x0..<x1 {
                        let p = (y * width + x) * 3
                        sum += (Int(pixels[p]) * 299 + Int(pixels[p + 1]) * 587 + Int(pixels[p + 2]) * 114) / 1000
                        n += 1
                    }
                }
                cells[cy * side + cx] = n > 0 ? sum / n : 0
            }
        }
        let mean = cells.reduce(0, +) / cells.count
        var hash: UInt64 = 0
        for (index, cell) in cells.enumerated() where cell > mean { hash |= 1 << UInt64(index) }
        return hash
    }
}
#endif
