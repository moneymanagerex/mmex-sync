use eframe::egui;

/// Complete User & Reference Guide embedded at compile time from `docs/HELP.md`.
pub const HELP_MARKDOWN: &str = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/docs/HELP.md"));

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

/// Renders the filtered Markdown help content inside an `egui::Ui`.
pub fn render_help_markdown(ui: &mut egui::Ui, markdown: &str, query: &str) {
    let sections = filter_markdown_sections(markdown, query);

    for (idx, section) in sections.iter().enumerate() {
        if let Some((level, title)) = &section.heading {
            if idx > 0 {
                ui.add_space(8.0);
            }
            render_heading(ui, *level, title);
            ui.add_space(4.0);
        }

        render_section_body(ui, &section.body, idx);
    }
}

fn render_heading(ui: &mut egui::Ui, level: u8, title: &str) {
    let clean = strip_markdown_links(title);
    let (size, color) = match level {
        1 => (20.0, egui::Color32::from_rgb(120, 200, 255)),
        2 => (17.0, egui::Color32::from_rgb(150, 215, 255)),
        3 => (14.5, egui::Color32::from_rgb(220, 235, 250)),
        _ => (13.5, egui::Color32::from_rgb(200, 215, 230)),
    };
    ui.label(egui::RichText::new(clean).size(size).strong().color(color));
}

fn render_section_body(ui: &mut egui::Ui, body: &str, section_idx: usize) {
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
                .fill(egui::Color32::from_rgb(24, 28, 36))
                .inner_margin(egui::Margin::same(8.0))
                .show(ui, |ui| {
                    ui.set_min_width(ui.available_width());
                    ui.add(
                        egui::Label::new(
                            egui::RichText::new(code_text)
                                .monospace()
                                .color(egui::Color32::from_rgb(200, 225, 255)),
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
            render_blockquote(ui, &quote_lines);
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
                        .color(egui::Color32::from_rgb(130, 195, 255)),
                );
                render_inline_markdown(ui, item_text);
            });
            i += 1;
            continue;
        }

        // Standard paragraph
        render_inline_markdown(ui, trimmed);
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

fn render_blockquote(ui: &mut egui::Ui, quote_lines: &[&str]) {
    egui::Frame::group(ui.style())
        .fill(egui::Color32::from_rgb(35, 45, 62))
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
                            .color(egui::Color32::from_rgb(255, 210, 90)),
                    );
                } else {
                    render_inline_markdown(ui, q_line);
                }
            }
        });
}

fn render_table(ui: &mut egui::Ui, table_lines: &[&str], id_salt: String) {
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
                        ui.label(egui::RichText::new(cell).strong());
                    } else {
                        render_inline_markdown(ui, cell);
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
    let chars: Vec<char> = input.chars().collect();
    let mut i = 0;

    while i < chars.len() {
        if chars[i] == '[' {
            if let Some(close_bracket) = chars[i + 1..].iter().position(|&c| c == ']') {
                let close_idx = i + 1 + close_bracket;
                if close_idx + 1 < chars.len() && chars[close_idx + 1] == '(' {
                    if let Some(close_paren) = chars[close_idx + 2..].iter().position(|&c| c == ')')
                    {
                        let label: String = chars[i + 1..close_idx].iter().collect();
                        out.push_str(&label);
                        i = close_idx + 2 + close_paren + 1;
                        continue;
                    }
                }
            }
        }
        out.push(chars[i]);
        i += 1;
    }

    out
}

fn render_inline_markdown(ui: &mut egui::Ui, text: &str) {
    let clean = strip_markdown_links(text);
    let mut job = egui::text::LayoutJob::default();

    let default_color = ui.visuals().text_color();
    let regular_fmt = egui::TextFormat {
        font_id: egui::FontId::proportional(13.5),
        color: default_color,
        ..Default::default()
    };
    let bold_fmt = egui::TextFormat {
        font_id: egui::FontId::proportional(13.5),
        color: egui::Color32::from_rgb(245, 248, 255),
        ..Default::default()
    };
    let code_fmt = egui::TextFormat {
        font_id: egui::FontId::monospace(12.5),
        color: egui::Color32::from_rgb(255, 210, 130),
        background: egui::Color32::from_rgb(35, 40, 52),
        ..Default::default()
    };

    let mut rest = clean.as_str();
    while !rest.is_empty() {
        let next_code = rest.find('`');
        let next_bold = rest.find("**");

        match (next_code, next_bold) {
            (Some(c_idx), Some(b_idx)) if c_idx < b_idx => {
                if c_idx > 0 {
                    job.append(&rest[..c_idx], 0.0, regular_fmt.clone());
                }
                let after = &rest[c_idx + 1..];
                if let Some(end_c) = after.find('`') {
                    job.append(&after[..end_c], 0.0, code_fmt.clone());
                    rest = &after[end_c + 1..];
                } else {
                    job.append(&rest[c_idx..], 0.0, regular_fmt.clone());
                    break;
                }
            }
            (Some(c_idx), None) => {
                if c_idx > 0 {
                    job.append(&rest[..c_idx], 0.0, regular_fmt.clone());
                }
                let after = &rest[c_idx + 1..];
                if let Some(end_c) = after.find('`') {
                    job.append(&after[..end_c], 0.0, code_fmt.clone());
                    rest = &after[end_c + 1..];
                } else {
                    job.append(&rest[c_idx..], 0.0, regular_fmt.clone());
                    break;
                }
            }
            (_, Some(b_idx)) => {
                if b_idx > 0 {
                    job.append(&rest[..b_idx], 0.0, regular_fmt.clone());
                }
                let after = &rest[b_idx + 2..];
                if let Some(end_b) = after.find("**") {
                    job.append(&after[..end_b], 0.0, bold_fmt.clone());
                    rest = &after[end_b + 2..];
                } else {
                    job.append(&rest[b_idx..], 0.0, regular_fmt.clone());
                    break;
                }
            }
            (None, None) => {
                job.append(rest, 0.0, regular_fmt.clone());
                break;
            }
        }
    }

    ui.label(job);
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
}
