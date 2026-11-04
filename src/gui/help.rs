use eframe::egui;

/// Complete User & Reference Guide embedded at compile time from `docs/HELP.md`.
pub const HELP_MARKDOWN: &str = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/docs/HELP.md"));

/// Theme-adaptive color palette for rendering Markdown in both Dark Mode and Light Mode (e.g. Windows default).
#[derive(Debug, Clone, Copy)]
pub struct HelpThemePalette {
    pub h1: egui::Color32,
    pub h2: egui::Color32,
    pub h3: egui::Color32,
    pub h4: egui::Color32,
    pub text: egui::Color32,
    pub bold: egui::Color32,
    pub inline_code_fg: egui::Color32,
    pub inline_code_bg: egui::Color32,
    pub code_block_fg: egui::Color32,
    pub code_block_bg: egui::Color32,
    pub blockquote_bg: egui::Color32,
    pub alert_fg: egui::Color32,
    pub bullet_fg: egui::Color32,
    pub link_fg: egui::Color32,
}

impl HelpThemePalette {
    pub fn from_visuals(visuals: &egui::Visuals) -> Self {
        Self::for_theme(visuals.dark_mode)
    }

    pub fn for_theme(dark_mode: bool) -> Self {
        if dark_mode {
            Self {
                h1: egui::Color32::from_rgb(110, 195, 255),
                h2: egui::Color32::from_rgb(140, 210, 255),
                h3: egui::Color32::from_rgb(215, 232, 255),
                h4: egui::Color32::from_rgb(195, 215, 240),
                text: egui::Color32::from_rgb(200, 208, 218),
                bold: egui::Color32::from_rgb(255, 255, 255),
                inline_code_fg: egui::Color32::from_rgb(255, 210, 130),
                inline_code_bg: egui::Color32::from_rgb(38, 44, 58),
                code_block_fg: egui::Color32::from_rgb(210, 230, 255),
                code_block_bg: egui::Color32::from_rgb(24, 28, 36),
                blockquote_bg: egui::Color32::from_rgb(35, 45, 62),
                alert_fg: egui::Color32::from_rgb(255, 210, 90),
                bullet_fg: egui::Color32::from_rgb(120, 190, 255),
                link_fg: egui::Color32::from_rgb(100, 185, 255),
            }
        } else {
            Self {
                h1: egui::Color32::from_rgb(0, 85, 165),
                h2: egui::Color32::from_rgb(10, 100, 180),
                h3: egui::Color32::from_rgb(20, 50, 95),
                h4: egui::Color32::from_rgb(35, 65, 105),
                text: egui::Color32::from_rgb(45, 50, 58),
                bold: egui::Color32::from_rgb(0, 28, 75),
                inline_code_fg: egui::Color32::from_rgb(165, 25, 55),
                inline_code_bg: egui::Color32::from_rgb(232, 236, 242),
                code_block_fg: egui::Color32::from_rgb(25, 35, 50),
                code_block_bg: egui::Color32::from_rgb(240, 244, 249),
                blockquote_bg: egui::Color32::from_rgb(232, 242, 252),
                alert_fg: egui::Color32::from_rgb(175, 80, 0),
                bullet_fg: egui::Color32::from_rgb(0, 95, 180),
                link_fg: egui::Color32::from_rgb(0, 95, 195),
            }
        }
    }
}

/// Logical section of the Markdown help document (split at top-level headings outside code blocks).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HelpSection {
    pub heading: Option<(u8, String)>,
    pub body: String,
}

impl HelpSection {
    /// Checks whether this section matches the given lowercase search query.
    pub fn matches_query(&self, query_lower: &str) -> bool {
        if query_lower.is_empty() {
            return true;
        }
        if let Some((_, title)) = &self.heading {
            if title.to_lowercase().contains(query_lower) {
                return true;
            }
        }
        self.body.to_lowercase().contains(query_lower)
    }
}

/// Inline Markdown span supporting plain text, bold, inline code, and clickable links.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InlineSpan {
    Text(String),
    Bold(String),
    Code(String),
    Link { label: String, target: String },
}

/// Normalizes a heading title or Markdown `#anchor` target into a canonical GitHub-compatible slug.
pub fn normalize_anchor_slug(raw: &str) -> String {
    let without_links = strip_markdown_links(raw);
    let trimmed = without_links.trim().trim_start_matches('#');
    let mut out = String::with_capacity(trimmed.len());
    let mut prev_dash = false;

    for ch in trimmed.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            prev_dash = false;
        } else if (ch.is_whitespace() || ch == '-') && !out.is_empty() && !prev_dash {
            out.push('-');
            prev_dash = true;
        }
    }

    if out.ends_with('-') {
        out.pop();
    }
    out
}

/// Parses a Markdown document into sections split by headings (`#` .. `####`),
/// ignoring `#` lines inside fenced code blocks (` ``` `).
pub fn parse_markdown_sections(markdown: &str) -> Vec<HelpSection> {
    let mut sections = Vec::new();
    let mut current_heading: Option<(u8, String)> = None;
    let mut current_lines: Vec<&str> = Vec::new();
    let mut in_code_block = false;

    for line in markdown.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") {
            in_code_block = !in_code_block;
            current_lines.push(line);
            continue;
        }

        if !in_code_block {
            if let Some((level, title)) = parse_heading_line(trimmed) {
                if current_heading.is_some() || current_lines.iter().any(|l| !l.trim().is_empty()) {
                    sections.push(HelpSection {
                        heading: current_heading.take(),
                        body: current_lines.join("\n"),
                    });
                    current_lines.clear();
                }
                current_heading = Some((level, title.to_string()));
                continue;
            }
        }

        current_lines.push(line);
    }

    if current_heading.is_some() || current_lines.iter().any(|l| !l.trim().is_empty()) {
        sections.push(HelpSection {
            heading: current_heading,
            body: current_lines.join("\n"),
        });
    }

    sections
}

/// Filters the Markdown document into matching sections for a case-insensitive search query.
pub fn filter_markdown_sections(markdown: &str, query: &str) -> Vec<HelpSection> {
    let sections = parse_markdown_sections(markdown);
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return sections;
    }

    sections
        .into_iter()
        .filter(|sec| sec.matches_query(&q))
        .collect()
}

fn parse_heading_line(trimmed: &str) -> Option<(u8, &str)> {
    let hashes = trimmed.bytes().take_while(|&b| b == b'#').count();
    if (1..=4).contains(&hashes) {
        let rest = &trimmed[hashes..];
        if rest.starts_with(' ') {
            return Some((hashes as u8, rest.trim()));
        }
    }
    None
}

/// Renders the filtered Markdown help content inside an `egui::Ui`, supporting interactive
/// `#anchor` navigation and external links.
pub fn render_help_markdown(
    ui: &mut egui::Ui,
    markdown: &str,
    query: &mut String,
    scroll_anchor: &mut Option<String>,
) {
    let palette = HelpThemePalette::from_visuals(ui.visuals());
    let sections = filter_markdown_sections(markdown, query);
    let mut clicked_anchor: Option<String> = None;

    for (idx, section) in sections.iter().enumerate() {
        if let Some((level, title)) = &section.heading {
            if idx > 0 {
                ui.add_space(8.0);
            }
            let resp = render_heading(ui, *level, title, &palette);
            if let Some(target_slug) = scroll_anchor.as_deref() {
                if normalize_anchor_slug(title) == target_slug {
                    resp.scroll_to_me(Some(egui::Align::TOP));
                    *scroll_anchor = None;
                }
            }
            ui.add_space(4.0);
        }

        render_section_body(ui, &section.body, idx, &palette, &mut clicked_anchor);
    }

    if let Some(anchor) = clicked_anchor {
        if !query.is_empty() {
            query.clear();
        }
        *scroll_anchor = Some(anchor);
        ui.ctx().request_repaint();
    }
}

fn render_heading(
    ui: &mut egui::Ui,
    level: u8,
    title: &str,
    palette: &HelpThemePalette,
) -> egui::Response {
    let clean = strip_markdown_links(title).replace('`', "");
    let (size, color) = match level {
        1 => (20.0, palette.h1),
        2 => (17.0, palette.h2),
        3 => (14.5, palette.h3),
        _ => (13.5, palette.h4),
    };
    ui.label(egui::RichText::new(clean).size(size).strong().color(color))
}

fn render_section_body(
    ui: &mut egui::Ui,
    body: &str,
    section_idx: usize,
    palette: &HelpThemePalette,
    clicked_anchor: &mut Option<String>,
) {
    let lines: Vec<&str> = body.lines().collect();
    let mut i = 0;
    let mut table_counter = 0usize;

    while i < lines.len() {
        let line = lines[i];
        let trimmed = line.trim();

        // Skip empty lines
        if trimmed.is_empty() {
            i += 1;
            continue;
        }

        // Horizontal rule
        if trimmed == "---" || trimmed == "***" {
            ui.add_space(4.0);
            ui.separator();
            ui.add_space(4.0);
            i += 1;
            continue;
        }

        // Fenced code block
        if trimmed.starts_with("```") {
            i += 1;
            let mut code_lines = Vec::new();
            while i < lines.len() && !lines[i].trim_start().starts_with("```") {
                code_lines.push(lines[i]);
                i += 1;
            }
            if i < lines.len() {
                i += 1; // skip closing ```
            }
            let code_text = code_lines.join("\n");
            egui::Frame::group(ui.style())
                .fill(palette.code_block_bg)
                .inner_margin(egui::Margin::same(8.0))
                .show(ui, |ui| {
                    ui.set_min_width(ui.available_width());
                    ui.add(
                        egui::Label::new(
                            egui::RichText::new(code_text)
                                .monospace()
                                .color(palette.code_block_fg),
                        )
                        .wrap(),
                    );
                });
            ui.add_space(4.0);
            continue;
        }

        // Blockquote / GitHub Alert (`> ...`)
        if trimmed.starts_with('>') {
            let mut quote_lines = Vec::new();
            while i < lines.len() && lines[i].trim().starts_with('>') {
                let q_line = lines[i].trim().trim_start_matches('>').trim();
                quote_lines.push(q_line);
                i += 1;
            }
            render_blockquote(ui, &quote_lines, palette, clicked_anchor);
            ui.add_space(4.0);
            continue;
        }

        // Markdown Table (`| ... |`)
        if trimmed.starts_with('|') && trimmed.ends_with('|') {
            let mut table_lines = Vec::new();
            while i < lines.len() {
                let t_line = lines[i].trim();
                if t_line.starts_with('|') && t_line.ends_with('|') {
                    table_lines.push(t_line);
                    i += 1;
                } else {
                    break;
                }
            }
            table_counter += 1;
            render_table(
                ui,
                &table_lines,
                format!("help_table_{}_{}", section_idx, table_counter),
                palette,
                clicked_anchor,
            );
            ui.add_space(4.0);
            continue;
        }

        // Bullet or numbered list item
        if let Some((indent_spaces, bullet, item_text)) = parse_list_item(line) {
            let indent = (indent_spaces as f32) * 8.0;
            ui.horizontal_wrapped(|ui| {
                if indent > 0.0 {
                    ui.add_space(indent);
                }
                ui.label(
                    egui::RichText::new(bullet)
                        .strong()
                        .color(palette.bullet_fg),
                );
                render_inline_markdown(ui, item_text, palette, clicked_anchor);
            });
            i += 1;
            continue;
        }

        // Standard paragraph
        render_inline_markdown(ui, trimmed, palette, clicked_anchor);
        ui.add_space(2.0);
        i += 1;
    }
}

fn parse_list_item(line: &str) -> Option<(usize, String, &str)> {
    let indent = line.bytes().take_while(|&b| b == b' ').count();
    let trimmed = &line[indent..];

    if let Some(rest) = trimmed
        .strip_prefix("* ")
        .or_else(|| trimmed.strip_prefix("- "))
    {
        return Some((indent, "•".to_string(), rest.trim()));
    }

    let digit_count = trimmed.bytes().take_while(|b| b.is_ascii_digit()).count();
    if digit_count > 0 {
        let after_digits = &trimmed[digit_count..];
        if let Some(rest) = after_digits.strip_prefix(". ") {
            let num_prefix = format!("{}.", &trimmed[..digit_count]);
            return Some((indent, num_prefix, rest.trim()));
        }
    }

    None
}

fn render_blockquote(
    ui: &mut egui::Ui,
    quote_lines: &[&str],
    palette: &HelpThemePalette,
    clicked_anchor: &mut Option<String>,
) {
    egui::Frame::group(ui.style())
        .fill(palette.blockquote_bg)
        .inner_margin(egui::Margin::same(8.0))
        .show(ui, |ui| {
            ui.set_min_width(ui.available_width());
            for &q_line in quote_lines {
                if q_line.is_empty() {
                    ui.add_space(4.0);
                } else if let Some(alert_tag) =
                    q_line.strip_prefix("[!").and_then(|s| s.strip_suffix(']'))
                {
                    ui.label(
                        egui::RichText::new(format!("ℹ {}", alert_tag))
                            .strong()
                            .color(palette.alert_fg),
                    );
                } else {
                    render_inline_markdown(ui, q_line, palette, clicked_anchor);
                }
            }
        });
}

fn render_table(
    ui: &mut egui::Ui,
    table_lines: &[&str],
    id_salt: String,
    palette: &HelpThemePalette,
    clicked_anchor: &mut Option<String>,
) {
    let mut rows: Vec<Vec<String>> = Vec::new();
    for &line in table_lines {
        let cells = split_table_row(line);
        // Skip alignment separator rows such as `| :--- | :--- |`
        let is_separator = cells.iter().all(|c| {
            let t = c.trim();
            !t.is_empty() && t.chars().all(|ch| ch == '-' || ch == ':')
        });
        if !is_separator && !cells.is_empty() {
            rows.push(cells);
        }
    }

    if rows.is_empty() {
        return;
    }

    egui::Grid::new(id_salt)
        .striped(true)
        .spacing([12.0, 6.0])
        .show(ui, |ui| {
            for (row_idx, row) in rows.iter().enumerate() {
                for cell in row {
                    if row_idx == 0 {
                        ui.label(egui::RichText::new(cell).strong().color(palette.bold));
                    } else {
                        render_inline_markdown(ui, cell, palette, clicked_anchor);
                    }
                }
                ui.end_row();
            }
        });
}

fn split_table_row(line: &str) -> Vec<String> {
    let inner = line.trim().trim_start_matches('|').trim_end_matches('|');
    let mut cells = Vec::new();
    let mut current = String::new();
    let mut chars = inner.chars().peekable();

    while let Some(ch) = chars.next() {
        if ch == '\\' && chars.peek() == Some(&'|') {
            current.push('|');
            let _ = chars.next();
        } else if ch == '|' {
            cells.push(current.trim().to_string());
            current.clear();
        } else {
            current.push(ch);
        }
    }
    cells.push(current.trim().to_string());
    cells
}

fn strip_markdown_links(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut rest = input;

    while !rest.is_empty() {
        if let Some((before, label, _target, after)) = find_next_markdown_link(rest) {
            out.push_str(before);
            out.push_str(label);
            rest = after;
        } else {
            out.push_str(rest);
            break;
        }
    }

    out
}

/// Finds the first valid `[label](target)` Markdown link in `input`, returning
/// `(before, label, target, after)`.
fn find_next_markdown_link(input: &str) -> Option<(&str, &str, &str, &str)> {
    let mut search_from = 0;
    while let Some(rel_open) = input[search_from..].find('[') {
        let open_bracket = search_from + rel_open;
        let after_open = &input[open_bracket + 1..];
        if let Some(close_bracket) = after_open.find(']') {
            let label = &after_open[..close_bracket];
            let after_close_bracket = &after_open[close_bracket + 1..];
            if let Some(after_open_paren) = after_close_bracket.strip_prefix('(') {
                if let Some(close_paren) = after_open_paren.find(')') {
                    let target = &after_open_paren[..close_paren];
                    let after_link = &after_open_paren[close_paren + 1..];
                    return Some((&input[..open_bracket], label, target.trim(), after_link));
                }
            }
        }
        search_from = open_bracket + 1;
    }
    None
}

/// Parses inline Markdown text into structured spans (`Text`, `Bold`, `Code`, `Link`).
pub fn parse_inline_spans(text: &str) -> Vec<InlineSpan> {
    let mut spans = Vec::new();
    let mut rest = text;

    while !rest.is_empty() {
        let next_link = find_next_markdown_link(rest);
        let link_idx = next_link.map(|(before, _, _, _)| before.len());
        let code_idx = rest.find('`');
        let bold_idx = rest.find("**");

        let min_idx = [link_idx, code_idx, bold_idx].into_iter().flatten().min();

        let Some(earliest) = min_idx else {
            spans.push(InlineSpan::Text(rest.to_string()));
            break;
        };

        if Some(earliest) == link_idx {
            if let Some((before, label, target, after)) = next_link {
                if !before.is_empty() {
                    spans.push(InlineSpan::Text(before.to_string()));
                }
                let clean_label = label.replace('`', "").replace("**", "");
                spans.push(InlineSpan::Link {
                    label: clean_label,
                    target: target.to_string(),
                });
                rest = after;
                continue;
            }
        }

        if Some(earliest) == code_idx {
            if earliest > 0 {
                spans.push(InlineSpan::Text(rest[..earliest].to_string()));
            }
            let after = &rest[earliest + 1..];
            if let Some(end_c) = after.find('`') {
                spans.push(InlineSpan::Code(after[..end_c].to_string()));
                rest = &after[end_c + 1..];
            } else {
                spans.push(InlineSpan::Text(rest[earliest..].to_string()));
                break;
            }
            continue;
        }

        if Some(earliest) == bold_idx {
            if earliest > 0 {
                spans.push(InlineSpan::Text(rest[..earliest].to_string()));
            }
            let after = &rest[earliest + 2..];
            if let Some(end_b) = after.find("**") {
                spans.push(InlineSpan::Bold(after[..end_b].to_string()));
                rest = &after[end_b + 2..];
            } else {
                spans.push(InlineSpan::Text(rest[earliest..].to_string()));
                break;
            }
            continue;
        }
    }

    spans
}

fn render_inline_markdown(
    ui: &mut egui::Ui,
    text: &str,
    palette: &HelpThemePalette,
    clicked_anchor: &mut Option<String>,
) {
    let spans = parse_inline_spans(text);
    let has_links = spans.iter().any(|s| matches!(s, InlineSpan::Link { .. }));

    if !has_links {
        let job = build_layout_job(&spans, palette);
        ui.label(job);
        return;
    }

    ui.horizontal_wrapped(|ui| {
        for span in spans {
            match span {
                InlineSpan::Text(t) => {
                    ui.label(egui::RichText::new(t).size(13.5).color(palette.text));
                }
                InlineSpan::Bold(b) => {
                    ui.label(
                        egui::RichText::new(b)
                            .size(14.0)
                            .strong()
                            .color(palette.bold),
                    );
                }
                InlineSpan::Code(c) => {
                    ui.label(
                        egui::RichText::new(c)
                            .size(12.5)
                            .monospace()
                            .color(palette.inline_code_fg)
                            .background_color(palette.inline_code_bg),
                    );
                }
                InlineSpan::Link { label, target } => {
                    let link_text = egui::RichText::new(&label)
                        .size(13.5)
                        .color(palette.link_fg)
                        .underline();
                    if ui
                        .add(egui::Link::new(link_text))
                        .on_hover_text(&target)
                        .clicked()
                    {
                        if target.starts_with('#') {
                            *clicked_anchor = Some(normalize_anchor_slug(&target));
                        } else {
                            ui.ctx().open_url(egui::OpenUrl::new_tab(&target));
                        }
                    }
                }
            }
        }
    });
}

fn build_layout_job(spans: &[InlineSpan], palette: &HelpThemePalette) -> egui::text::LayoutJob {
    let mut job = egui::text::LayoutJob::default();

    let regular_fmt = egui::TextFormat {
        font_id: egui::FontId::proportional(13.5),
        color: palette.text,
        ..Default::default()
    };
    let bold_fmt = egui::TextFormat {
        font_id: egui::FontId::proportional(14.0),
        color: palette.bold,
        ..Default::default()
    };
    let code_fmt = egui::TextFormat {
        font_id: egui::FontId::monospace(12.5),
        color: palette.inline_code_fg,
        background: palette.inline_code_bg,
        ..Default::default()
    };

    for span in spans {
        match span {
            InlineSpan::Text(t) => job.append(t, 0.0, regular_fmt.clone()),
            InlineSpan::Bold(b) => job.append(b, 0.0, bold_fmt.clone()),
            InlineSpan::Code(c) => job.append(c, 0.0, code_fmt.clone()),
            InlineSpan::Link { label, .. } => job.append(label, 0.0, bold_fmt.clone()),
        }
    }

    job
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_help_markdown_embedded_non_empty() {
        assert!(!HELP_MARKDOWN.trim().is_empty());
        assert!(HELP_MARKDOWN.contains("MMEX-Sync"));
        assert!(HELP_MARKDOWN.contains("Quick Start & Execution Modes"));
        assert!(HELP_MARKDOWN.contains("Command-Line Interface (CLI) Reference"));
        assert!(HELP_MARKDOWN.contains("Security & Encrypted Databases"));
    }

    #[test]
    fn test_help_markdown_filter() {
        let all_sections = filter_markdown_sections(HELP_MARKDOWN, "");
        assert!(all_sections.len() > 10);

        // Case-insensitive search for "--clearDb"
        let clear_db_sections = filter_markdown_sections(HELP_MARKDOWN, "cleardb");
        assert!(!clear_db_sections.is_empty());
        assert!(clear_db_sections.len() < all_sections.len());
        assert!(clear_db_sections
            .iter()
            .any(|s| s.body.to_lowercase().contains("cleardb")
                || s.heading
                    .as_ref()
                    .map(|(_, h)| h.to_lowercase().contains("cleardb"))
                    .unwrap_or(false)));

        // Non-matching query returns empty vector
        let none_sections =
            filter_markdown_sections(HELP_MARKDOWN, "non_existent_keyword_xyz_98765");
        assert!(none_sections.is_empty());
    }

    #[test]
    fn test_parse_inline_spans_with_links() {
        let spans = parse_inline_spans(
            "1. [Overview & Key Features](#-1-overview--key-features) with **bold** and `code`",
        );
        assert_eq!(
            spans,
            vec![
                InlineSpan::Text("1. ".to_string()),
                InlineSpan::Link {
                    label: "Overview & Key Features".to_string(),
                    target: "#-1-overview--key-features".to_string(),
                },
                InlineSpan::Text(" with ".to_string()),
                InlineSpan::Bold("bold".to_string()),
                InlineSpan::Text(" and ".to_string()),
                InlineSpan::Code("code".to_string()),
            ]
        );
    }

    #[test]
    fn test_anchor_slug_matching_all_toc_links() {
        let sections = parse_markdown_sections(HELP_MARKDOWN);
        let heading_slugs: Vec<String> = sections
            .iter()
            .filter_map(|s| {
                s.heading
                    .as_ref()
                    .map(|(_, title)| normalize_anchor_slug(title))
            })
            .collect();

        let mut link_count = 0usize;
        for line in HELP_MARKDOWN.lines() {
            for span in parse_inline_spans(line) {
                if let InlineSpan::Link { target, .. } = span {
                    if target.starts_with('#') {
                        link_count += 1;
                        let target_slug = normalize_anchor_slug(&target);
                        assert!(
                            heading_slugs.contains(&target_slug),
                            "TOC anchor '{}' (normalized: '{}') did not match any heading slug in HELP.md",
                            target,
                            target_slug
                        );
                    }
                }
            }
        }
        assert!(link_count >= 25, "Expected at least 25 internal TOC links");
    }

    #[test]
    fn test_theme_palette_light_and_dark_contrast() {
        let light = HelpThemePalette::for_theme(false);
        let dark = HelpThemePalette::for_theme(true);

        // In Light Mode, bold text and headings must be dark (low RGB luminance) for readability on white
        let light_bold_luma =
            (light.bold.r() as u32 + light.bold.g() as u32 + light.bold.b() as u32) / 3;
        let light_h3_luma = (light.h3.r() as u32 + light.h3.g() as u32 + light.h3.b() as u32) / 3;
        assert!(
            light_bold_luma < 80,
            "Light mode bold text must be dark, got luma {}",
            light_bold_luma
        );
        assert!(
            light_h3_luma < 100,
            "Light mode H3 heading must be dark, got luma {}",
            light_h3_luma
        );

        // In Dark Mode, bold text and headings must be bright (high RGB luminance) for readability on dark
        let dark_bold_luma =
            (dark.bold.r() as u32 + dark.bold.g() as u32 + dark.bold.b() as u32) / 3;
        assert!(
            dark_bold_luma > 200,
            "Dark mode bold text must be bright, got luma {}",
            dark_bold_luma
        );
    }
}
