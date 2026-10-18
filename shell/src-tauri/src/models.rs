//! The model's two files, as the helper's `download-model` names and checks them (Sources/DigUpKit/ModelFiles.swift):
//! where they download from, and files the person downloaded themselves (a network that blocks Hugging Face), taken in
//! as the Mac app's `ModelDownload.use` takes them: by their size, into `<name>.partial`, where the helper checks them
//! (size and SHA-256) as it would a download before they get their name.

use std::path::{Path, PathBuf};

pub const REPOSITORY: &str = "ggml-org/embeddinggemma-2-GGUF";
pub const REVISION: &str = "bfcd298762cc34d0357ece5ebdd31791a3a374d8";

#[derive(Debug)]
pub struct File {
    pub name: &'static str,
    pub bytes: u64,
}

/// The text model, then the image and audio encoders (download order).
pub const FILES: [File; 2] = [
    File { name: "embeddinggemma-2-Q8_0.gguf", bytes: 309_855_456 },
    File { name: "mmproj-embeddinggemma-2-Q8_0.gguf", bytes: 554_821_024 },
];

impl File {
    /// Hugging Face's address for it at the pinned revision.
    pub fn url(&self) -> String {
        format!("https://huggingface.co/{REPOSITORY}/resolve/{REVISION}/{}", self.name)
    }
}

/// The addresses, for Copy Links.
pub fn links() -> Vec<String> {
    FILES.iter().map(File::url).collect()
}

/// Where the helper keeps them by default (its `AppPaths.applicationSupport/Models`).
pub fn default_folder() -> Option<PathBuf> {
    if cfg!(windows) {
        let local = std::env::var_os("LOCALAPPDATA").filter(|value| !value.is_empty()).map(PathBuf::from)
            .or_else(|| std::env::var_os("USERPROFILE").map(|home| PathBuf::from(home).join("AppData").join("Local")));
        return local.map(|local| local.join("DigUp").join("Models"));
    }
    let data = std::env::var_os("XDG_DATA_HOME").filter(|value| !value.is_empty()).map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share")));
    data.map(|data| data.join("digup").join("Models"))
}

/// Which of the chosen files (path, size) are model files still missing from `folder`, by size (a file under a model
/// file's name at another size isn't one); or why none is.
pub fn pick<'a>(chosen: &'a [(PathBuf, u64)], folder: &Path) -> Result<Vec<(&'static File, &'a Path)>, String> {
    let mut picked: Vec<(&'static File, &Path)> = Vec::new();
    let mut problem = "Those aren't the model's files".to_string();
    for (path, size) in chosen {
        let Some(file) = FILES.iter().find(|file| file.bytes == *size) else {
            let name = path.file_name().map(|name| name.to_string_lossy().to_string()).unwrap_or_default();
            if let Some(named) = FILES.iter().find(|file| file.name == name) {
                problem = format!("The chosen {} is {}, not {}", named.name, megabytes(*size), megabytes(named.bytes));
            }
            continue;
        };
        if !folder.join(file.name).exists() && !picked.iter().any(|(taken, _)| taken.name == file.name) {
            picked.push((file, path.as_path()));
        }
    }
    if picked.is_empty() {
        // Both there already: nothing to do, which is fine.
        if FILES.iter().all(|file| folder.join(file.name).exists()) {
            return Ok(picked);
        }
        return Err(problem);
    }
    Ok(picked)
}

/// "310 MB"
fn megabytes(bytes: u64) -> String {
    if bytes >= 1_000_000_000 {
        format!("{:.1} GB", bytes as f64 / 1e9)
    } else {
        format!("{} MB", (bytes as f64 / 1e6).round())
    }
}

/// "about 3 min": the Mac's `roughDuration`.
pub fn rough_duration(seconds: f64) -> String {
    if seconds < 90.0 {
        format!("{} s", seconds.round())
    } else if seconds < 5400.0 {
        format!("{} min", (seconds / 60.0).round())
    } else {
        format!("{:.1} h", seconds / 3600.0)
    }
}

/// The download's pace over the last six seconds (the Mac's `ModelDownload` samples): seconds left, once there's a
/// second of it.
#[derive(Default)]
pub struct Pace {
    samples: Vec<(std::time::Instant, f64)>,
}

impl Pace {
    pub fn seconds_left(&mut self, now: std::time::Instant, bytes: f64, total: f64) -> Option<f64> {
        self.samples.push((now, bytes));
        self.samples.retain(|(time, _)| now.duration_since(*time).as_secs_f64() <= 6.0);
        let (first, start) = *self.samples.first()?;
        let elapsed = now.duration_since(first).as_secs_f64();
        let rate = (bytes - start) / elapsed;
        (elapsed >= 1.0 && rate > 0.0).then(|| (total - bytes).max(0.0) / rate)
    }

    pub fn reset(&mut self) {
        self.samples.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    #[test]
    fn links_are_the_pinned_files() {
        assert_eq!(links(), vec![
            "https://huggingface.co/ggml-org/embeddinggemma-2-GGUF/resolve/bfcd298762cc34d0357ece5ebdd31791a3a374d8/embeddinggemma-2-Q8_0.gguf",
            "https://huggingface.co/ggml-org/embeddinggemma-2-GGUF/resolve/bfcd298762cc34d0357ece5ebdd31791a3a374d8/mmproj-embeddinggemma-2-Q8_0.gguf",
        ]);
    }

    #[test]
    fn picks_by_size() {
        let folder = std::env::temp_dir().join(format!("digup-models-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&folder);
        std::fs::create_dir_all(&folder).unwrap();
        let chosen = vec![
            (PathBuf::from("/d/whatever.bin"), 554_821_024),
            (PathBuf::from("/d/notes.txt"), 12),
            (PathBuf::from("/d/copy.gguf"), 554_821_024),
        ];
        let picked = pick(&chosen, &folder).unwrap();
        assert_eq!(picked.len(), 1);
        assert_eq!(picked[0].0.name, "mmproj-embeddinggemma-2-Q8_0.gguf");
        assert_eq!(picked[0].1, Path::new("/d/whatever.bin"));
        // The right name at the wrong size says so.
        let wrong = vec![(PathBuf::from("/d/embeddinggemma-2-Q8_0.gguf"), 100_000_000)];
        assert_eq!(pick(&wrong, &folder).unwrap_err(), "The chosen embeddinggemma-2-Q8_0.gguf is 100 MB, not 310 MB");
        assert_eq!(pick(&[(PathBuf::from("/d/a"), 1)], &folder).unwrap_err(), "Those aren't the model's files");
        // A file already there isn't taken again.
        std::fs::write(folder.join("mmproj-embeddinggemma-2-Q8_0.gguf"), b"").unwrap();
        assert!(pick(&chosen, &folder).is_err());
        std::fs::write(folder.join("embeddinggemma-2-Q8_0.gguf"), b"").unwrap();
        assert!(pick(&chosen, &folder).unwrap().is_empty());
        let _ = std::fs::remove_dir_all(&folder);
    }

    #[test]
    fn pace() {
        let mut pace = Pace::default();
        let start = Instant::now();
        assert_eq!(pace.seconds_left(start, 0.0, 1000.0), None);
        assert_eq!(pace.seconds_left(start + Duration::from_millis(500), 50.0, 1000.0), None);
        assert_eq!(pace.seconds_left(start + Duration::from_secs(2), 200.0, 1000.0), Some(8.0));
        // Only the last six seconds count.
        assert_eq!(pace.seconds_left(start + Duration::from_secs(10), 300.0, 1000.0), None);
        assert_eq!(pace.seconds_left(start + Duration::from_secs(12), 500.0, 1000.0), Some(5.0));
        assert_eq!(rough_duration(42.0), "42 s");
        assert_eq!(rough_duration(600.0), "10 min");
        assert_eq!(rough_duration(7200.0), "2.0 h");
    }
}
