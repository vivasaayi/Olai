// Deterministic page column / two-page-spread detection.
//
// A rendered facsimile page is often a physical two-page spread and/or multiple
// text columns. Feeding the whole image to OCR jumbles the reading order, so we
// need to find the vertical gutters and cut the page into ordered regions.
//
// Pipeline: downscale -> Otsu binarize -> projection-profile deskew -> vertical
// whitespace ("X-cut") gutter detection. Pure Rust (image + imageproc) so it
// compiles for desktop and mobile alike, with no native OpenCV/Tesseract deps.
//
// Output is a set of interior cut fractions (0..1 across the page width) plus a
// confidence score the caller uses to decide whether to escalate to an LLM.

use base64::{engine::general_purpose, Engine as _};
use image::{imageops::FilterType, GrayImage, Luma};
use imageproc::geometric_transformations::{rotate_about_center, Interpolation};
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageRegionDetection {
    /// Interior vertical cut fractions (0..1), sorted left to right.
    pub cuts: Vec<f32>,
    /// 0..1 — how clean the decision is. Low means "escalate / ask the user".
    pub confidence: f32,
    /// Estimated skew corrected before detection, in degrees.
    pub deskew_angle: f32,
    /// Number of columns implied by the cuts (cuts.len() + 1).
    pub columns: u32,
}

#[tauri::command]
pub fn detect_page_regions(image_data_url: String) -> Result<PageRegionDetection, String> {
    // Accept either a full `data:image/...;base64,XXXX` URL or bare base64.
    let base64_data = image_data_url
        .split_once(',')
        .map(|(_, data)| data)
        .unwrap_or(&image_data_url);
    let bytes = general_purpose::STANDARD
        .decode(base64_data.trim())
        .map_err(|e| format!("decode page image: {}", e))?;
    let gray = image::load_from_memory(&bytes)
        .map_err(|e| format!("load page image: {}", e))?
        .to_luma8();
    Ok(analyze(&gray))
}

fn analyze(original: &GrayImage) -> PageRegionDetection {
    let work = downscale(original, 1100);
    let level = otsu_level(&work);
    let angle = estimate_skew(&work, level);
    let deskewed = if angle.abs() >= 0.15 {
        rotate_about_center(&work, angle.to_radians(), Interpolation::Nearest, Luma([255]))
    } else {
        work.clone()
    };
    let (cuts, confidence) = detect_columns(&deskewed, level);
    PageRegionDetection {
        columns: cuts.len() as u32 + 1,
        cuts,
        confidence,
        deskew_angle: angle,
    }
}

fn downscale(img: &GrayImage, max_width: u32) -> GrayImage {
    if img.width() <= max_width {
        return img.clone();
    }
    let scale = max_width as f32 / img.width() as f32;
    let height = ((img.height() as f32) * scale).round().max(1.0) as u32;
    image::imageops::resize(img, max_width, height, FilterType::Triangle)
}

/// Standard Otsu threshold: the luminance that best separates ink from paper.
fn otsu_level(img: &GrayImage) -> u8 {
    let mut histogram = [0u32; 256];
    for pixel in img.pixels() {
        histogram[pixel[0] as usize] += 1;
    }
    let total = (img.width() * img.height()) as f64;
    if total == 0.0 {
        return 128;
    }
    let sum: f64 = (0..256).map(|i| i as f64 * histogram[i] as f64).sum();
    let mut sum_background = 0.0;
    let mut weight_background = 0.0;
    let mut max_between = 0.0;
    let mut threshold = 128u8;
    for i in 0..256 {
        weight_background += histogram[i] as f64;
        if weight_background == 0.0 {
            continue;
        }
        let weight_foreground = total - weight_background;
        if weight_foreground == 0.0 {
            break;
        }
        sum_background += i as f64 * histogram[i] as f64;
        let mean_background = sum_background / weight_background;
        let mean_foreground = (sum - sum_background) / weight_foreground;
        let between = weight_background
            * weight_foreground
            * (mean_background - mean_foreground)
            * (mean_background - mean_foreground);
        if between > max_between {
            max_between = between;
            threshold = i as u8;
        }
    }
    threshold
}

/// Estimate page skew in [-4, 4] degrees by rotating a small copy and picking the
/// angle whose horizontal projection is "peakiest" (text lines best aligned).
fn estimate_skew(img: &GrayImage, level: u8) -> f32 {
    let small = downscale(img, 700);
    let mut best_angle = 0.0f32;
    let mut best_score = -1.0f64;
    let mut angle = -4.0f32;
    while angle <= 4.0001 {
        let rotated = if angle.abs() < 0.001 {
            small.clone()
        } else {
            rotate_about_center(&small, angle.to_radians(), Interpolation::Nearest, Luma([255]))
        };
        let score = horizontal_projection_score(&rotated, level);
        if score > best_score {
            best_score = score;
            best_angle = angle;
        }
        angle += 0.5;
    }
    best_angle
}

/// Sum of squared per-row ink counts. Maximized when text rows line up, which is
/// the classic projection-profile signal for deskew.
fn horizontal_projection_score(img: &GrayImage, level: u8) -> f64 {
    let width = img.width();
    let mut score = 0.0;
    for y in 0..img.height() {
        let mut ink = 0u32;
        for x in 0..width {
            if img.get_pixel(x, y)[0] <= level {
                ink += 1;
            }
        }
        score += (ink as f64) * (ink as f64);
    }
    score
}

struct Gutter {
    center: f32,
    span: usize,
    mean_ink: f32,
}

/// Vertical projection profile -> ink coverage per column -> wide low-ink valleys
/// (away from the page margins) are column/spread gutters. Returns cut fractions
/// and a confidence score.
fn detect_columns(img: &GrayImage, level: u8) -> (Vec<f32>, f32) {
    let width = img.width() as usize;
    let height = img.height() as f32;
    if width == 0 || height == 0.0 {
        return (vec![], 0.0);
    }

    let mut coverage = vec![0f32; width];
    for x in 0..img.width() {
        let mut ink = 0u32;
        for y in 0..img.height() {
            if img.get_pixel(x, y)[0] <= level {
                ink += 1;
            }
        }
        coverage[x as usize] = ink as f32 / height;
    }

    let radius = ((width as f32) * 0.006).round().max(1.0) as usize;
    let smoothed = box_blur_1d(&coverage, radius);

    // Reference "text darkness" from the 90th-percentile column so a few very dark
    // figure columns don't set the bar.
    let mut sorted = smoothed.clone();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let p90 = sorted[((sorted.len() as f32 * 0.9) as usize).min(sorted.len() - 1)];
    let aspect = img.width() as f32 / img.height() as f32;
    if p90 <= 0.001 {
        // Effectively blank — confidently a single (empty) page.
        return (vec![], 0.85);
    }

    let text_threshold = p90 * 0.16;
    let margin = ((width as f32) * 0.04).round() as usize;
    let min_gutter = (((width as f32) * 0.018).round() as usize).max(2);
    let right_edge = width.saturating_sub(margin);

    let mut gutters: Vec<Gutter> = Vec::new();
    let mut run_start: Option<usize> = None;
    let mut run_sum = 0.0f32;
    for x in margin..=right_edge {
        let below = x < right_edge && smoothed[x] <= text_threshold;
        if below {
            if run_start.is_none() {
                run_start = Some(x);
                run_sum = 0.0;
            }
            run_sum += smoothed[x];
        } else if let Some(start) = run_start.take() {
            let span = x - start;
            if span >= min_gutter {
                gutters.push(Gutter {
                    center: (start + x) as f32 / 2.0 / width as f32,
                    span,
                    mean_ink: run_sum / span as f32,
                });
            }
            run_start = None;
        }
    }

    // Prefer the widest (most confident) gutters, cap the column count.
    gutters.sort_by(|a, b| b.span.cmp(&a.span));
    gutters.truncate(5);

    if gutters.is_empty() {
        // No gutter found. A wide aspect ratio hints at an undetected spread, so
        // flag it as low-confidence; otherwise it's a confident single column.
        let confidence = if aspect > 1.3 { 0.3 } else { 0.85 };
        return (vec![], confidence);
    }

    // Confidence = depth of the shallowest kept gutter relative to text darkness.
    let min_clarity = gutters
        .iter()
        .map(|gutter| ((p90 - gutter.mean_ink) / p90).clamp(0.0, 1.0))
        .fold(1.0f32, f32::min);

    let mut cuts: Vec<f32> = gutters.iter().map(|gutter| gutter.center).collect();
    cuts.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    (cuts, min_clarity)
}

fn box_blur_1d(values: &[f32], radius: usize) -> Vec<f32> {
    if radius == 0 || values.is_empty() {
        return values.to_vec();
    }
    let len = values.len();
    let mut out = vec![0f32; len];
    let mut sum = 0.0f32;
    for value in values.iter().take(radius.min(len)) {
        sum += value;
    }
    for i in 0..len {
        let add = i + radius;
        if add < len {
            sum += values[add];
        }
        if i > radius {
            sum -= values[i - radius - 1];
        }
        let lo = i.saturating_sub(radius);
        let hi = (i + radius).min(len - 1);
        out[i] = sum / (hi - lo + 1) as f32;
    }
    out
}
