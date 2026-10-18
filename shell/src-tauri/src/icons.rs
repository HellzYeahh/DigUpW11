//! The system's picture of a file or folder for the pages (the Mac app's Thumbnails and NSWorkspace icons): Windows'
//! shell thumbnail when there is one (pictures, PDFs, videos; Explorer's own, from its cache), else the icon of its type
//! (IShellItemImageFactory, SHGetFileInfo when that fails), as a PNG data URL. Icons are kept by extension and size
//! (a program's, a shortcut's and a folder's are each its own); thumbnails by the file's path, size and change time.
//! Elsewhere there's none: the pages draw their own.

/// Files whose icon is their own, not their type's.
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
const OWN_ICONS: [&str; 6] = ["exe", "lnk", "ico", "url", "msi", "appref-ms"];

/// What a picture is kept under: the file's own, or its type's icon.
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
#[derive(Clone, Debug, Hash, PartialEq, Eq)]
enum Key {
    Thumbnail(String, u64, u32),
    Icon(String, u32),
}

/// The key a file's icon is kept under: its extension's, or its own path's (a folder, a program, a shortcut).
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
fn icon_key(path: &str, folder: bool, size: u32) -> Key {
    let extension = std::path::Path::new(path).extension().map(|extension| extension.to_string_lossy().to_lowercase());
    match extension {
        Some(extension) if !folder && !OWN_ICONS.contains(&extension.as_str()) => Key::Icon(format!(".{extension}"), size),
        _ => Key::Icon(path.to_lowercase(), size),
    }
}

/// `size`: the picture's width and height in pixels (16 to 256).
#[cfg(windows)]
pub fn picture(path: &str, size: u32) -> Option<String> {
    windows::picture(&path.replace('/', "\\"), size.clamp(16, 256))
}

#[cfg(not(windows))]
pub fn picture(_: &str, _: u32) -> Option<String> {
    None
}

/// RGBA from the 32-bit BGRA, premultiplied, a bitmap gives; a picture that came without alpha is opaque.
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
fn straight_rgba(mut bgra: Vec<u8>) -> Vec<u8> {
    let opaque = bgra.chunks(4).all(|pixel| pixel[3] == 0);
    for pixel in bgra.chunks_mut(4) {
        pixel.swap(0, 2);
        if opaque {
            pixel[3] = 255;
        } else if pixel[3] > 0 && pixel[3] < 255 {
            let alpha = u16::from(pixel[3]);
            for channel in &mut pixel[..3] {
                *channel = ((u16::from(*channel) * 255 + alpha / 2) / alpha).min(255) as u8;
            }
        }
    }
    bgra
}

#[cfg_attr(not(any(windows, test)), allow(dead_code))]
fn data_url(rgba: &[u8], width: u32, height: u32) -> Option<String> {
    use base64::Engine;
    let mut png = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut png, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder.write_header().ok()?.write_image_data(rgba).ok()?;
    }
    Some(format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(png)))
}

#[cfg(windows)]
mod windows {
    use super::{data_url, icon_key, straight_rgba, Key};
    use std::collections::HashMap;
    use std::ffi::c_void;
    use std::sync::Mutex;
    use windows_sys::core::{GUID, HRESULT};
    use windows_sys::Win32::Foundation::SIZE;
    use windows_sys::Win32::Graphics::Gdi::{
        DeleteObject, GetDC, GetDIBits, GetObjectW, ReleaseDC, BITMAP, BITMAPINFO, BITMAPINFOHEADER, BI_RGB,
        DIB_RGB_COLORS, HBITMAP,
    };
    use windows_sys::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE};
    use windows_sys::Win32::UI::Shell::{
        SHCreateItemFromParsingName, SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON, SIIGBF,
        SIIGBF_ICONONLY, SIIGBF_THUMBNAILONLY,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{DestroyIcon, GetIconInfo, ICONINFO};

    /// IShellItemImageFactory: IUnknown's three, then GetImage.
    const IID_ISHELLITEMIMAGEFACTORY: GUID = GUID::from_u128(0xbcc18b79_ba16_442f_80c4_8a59c30c463b);

    #[repr(C)]
    struct FactoryVtbl {
        query_interface: usize,
        add_ref: usize,
        release: unsafe extern "system" fn(*mut c_void) -> u32,
        get_image: unsafe extern "system" fn(*mut c_void, SIZE, SIIGBF, *mut HBITMAP) -> HRESULT,
    }

    /// Pictures made, or none (a file without a thumbnail), so neither is asked of the shell twice. Thumbnails are
    /// dropped wholesale past a few hundred.
    static KEPT: Mutex<Option<HashMap<Key, Option<String>>>> = Mutex::new(None);

    fn kept(key: &Key) -> Option<Option<String>> {
        KEPT.lock().unwrap().as_ref()?.get(key).cloned()
    }

    fn keep(key: Key, picture: Option<String>) {
        let mut kept = KEPT.lock().unwrap();
        let map = kept.get_or_insert_with(HashMap::new);
        if map.len() > 600 {
            map.retain(|key, _| matches!(key, Key::Icon(..)));
        }
        map.insert(key, picture);
    }

    pub fn picture(path: &str, size: u32) -> Option<String> {
        // SAFETY: COM on this thread, for the shell's objects (already on: nothing changes).
        unsafe { CoInitializeEx(std::ptr::null(), (COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) as u32) };
        let metadata = std::fs::metadata(path).ok();
        let folder = metadata.as_ref().is_some_and(|metadata| metadata.is_dir());
        let icon = icon_key(path, folder, size);
        let own_icon = matches!(&icon, Key::Icon(name, _) if name == &path.to_lowercase());
        if !folder && !own_icon {
            let changed = metadata.as_ref().and_then(|metadata| metadata.modified().ok())
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok()).map_or(0, |time| time.as_secs());
            let key = Key::Thumbnail(path.to_lowercase(), changed, size);
            let thumbnail = kept(&key).unwrap_or_else(|| {
                let made = image(path, size, SIIGBF_THUMBNAILONLY);
                keep(key, made.clone());
                made
            });
            if thumbnail.is_some() {
                return thumbnail;
            }
        }
        if let Some(picture) = kept(&icon) {
            return picture;
        }
        let made = image(path, size, SIIGBF_ICONONLY).or_else(|| file_info_icon(path));
        keep(icon, made.clone());
        made
    }

    /// The shell item's picture at `size`: its thumbnail or its icon (`flags`).
    fn image(path: &str, size: u32, flags: SIIGBF) -> Option<String> {
        let wide: Vec<u16> = path.encode_utf16().chain(Some(0)).collect();
        let mut factory: *mut c_void = std::ptr::null_mut();
        // SAFETY: the path is NUL-terminated; the factory is released once it has given its bitmap, which is deleted
        // once read.
        unsafe {
            if SHCreateItemFromParsingName(wide.as_ptr(), std::ptr::null_mut(), &IID_ISHELLITEMIMAGEFACTORY, &mut factory) < 0
                || factory.is_null()
            {
                return None;
            }
            let table = &**(factory as *mut *const FactoryVtbl);
            let mut bitmap: HBITMAP = std::ptr::null_mut();
            let side = size as i32;
            let made = (table.get_image)(factory, SIZE { cx: side, cy: side }, flags, &mut bitmap);
            (table.release)(factory);
            if made < 0 || bitmap.is_null() {
                return None;
            }
            let picture = encode(bitmap);
            DeleteObject(bitmap);
            picture
        }
    }

    /// The type's icon as SHGetFileInfo gives it (32 px), for an item the image factory can't make.
    fn file_info_icon(path: &str) -> Option<String> {
        let wide: Vec<u16> = path.encode_utf16().chain(Some(0)).collect();
        // SAFETY: the struct is the size the call is told; the icon and its bitmaps are freed once read.
        unsafe {
            let mut info: SHFILEINFOW = std::mem::zeroed();
            let found = SHGetFileInfoW(wide.as_ptr(), 0, &mut info, std::mem::size_of::<SHFILEINFOW>() as u32,
                                       SHGFI_ICON | SHGFI_LARGEICON);
            if found == 0 || info.hIcon.is_null() {
                return None;
            }
            let mut parts: ICONINFO = std::mem::zeroed();
            let picture = if GetIconInfo(info.hIcon, &mut parts) != 0 {
                let picture = (!parts.hbmColor.is_null()).then(|| encode(parts.hbmColor)).flatten();
                DeleteObject(parts.hbmColor);
                DeleteObject(parts.hbmMask);
                picture
            } else {
                None
            };
            DestroyIcon(info.hIcon);
            picture
        }
    }

    /// A bitmap's pixels as a PNG data URL, top row first.
    unsafe fn encode(bitmap: HBITMAP) -> Option<String> {
        let mut header: BITMAP = std::mem::zeroed();
        if GetObjectW(bitmap, std::mem::size_of::<BITMAP>() as i32, (&mut header as *mut BITMAP).cast()) == 0 {
            return None;
        }
        let (width, height) = (header.bmWidth, header.bmHeight.abs());
        if width <= 0 || height <= 0 {
            return None;
        }
        let mut info: BITMAPINFO = std::mem::zeroed();
        info.bmiHeader = BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width,
            biHeight: -height,   // top-down
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB,
            ..std::mem::zeroed()
        };
        let mut pixels = vec![0u8; width as usize * height as usize * 4];
        let screen = GetDC(std::ptr::null_mut());
        let lines = GetDIBits(screen, bitmap, 0, height as u32, pixels.as_mut_ptr().cast(), &mut info, DIB_RGB_COLORS);
        ReleaseDC(std::ptr::null_mut(), screen);
        if lines == 0 {
            return None;
        }
        data_url(&straight_rgba(pixels), width as u32, height as u32)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn icons_are_kept_by_type() {
        assert_eq!(icon_key(r"C:\Docs\Report.PDF", false, 32), Key::Icon(".pdf".into(), 32));
        assert_eq!(icon_key(r"C:\Other\notes.pdf", false, 32), icon_key(r"C:\Docs\Report.PDF", false, 32));
        assert_eq!(icon_key(r"C:\Apps\Tool.exe", false, 32), Key::Icon(r"c:\apps\tool.exe".into(), 32));
        assert_eq!(icon_key(r"C:\Users\me\Documents", true, 64), Key::Icon(r"c:\users\me\documents".into(), 64));
        assert_eq!(icon_key(r"C:\Users\me\project.v2", true, 64), Key::Icon(r"c:\users\me\project.v2".into(), 64));
        assert_eq!(icon_key(r"C:\x\Makefile", false, 16), Key::Icon(r"c:\x\makefile".into(), 16));
    }

    #[test]
    fn pixels_and_png() {
        // A blue pixel at half alpha, premultiplied, and an opaque red one.
        let rgba = straight_rgba(vec![128, 0, 0, 128, 0, 0, 255, 255]);
        assert_eq!(rgba, vec![0, 0, 255, 128, 255, 0, 0, 255]);
        // Without alpha at all: opaque.
        assert_eq!(straight_rgba(vec![10, 20, 30, 0]), vec![30, 20, 10, 255]);
        let url = data_url(&rgba, 2, 1).unwrap();
        assert!(url.starts_with("data:image/png;base64,iVBORw0KGgo"), "{url}");
    }
}
