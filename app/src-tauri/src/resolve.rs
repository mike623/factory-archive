//! Turning a SCIM / Satisfactory Blueprints / direct URL into blueprint files.
//!
//! Source detection is real. Downloading is not built yet: neither site documents
//! its download links, so `resolve` reports that clearly instead of producing
//! placeholder files that would end up in someone's world.

#[derive(Debug, PartialEq, Clone, Copy)]
pub enum Source {
    Scim,
    Sbp,
    Direct,
}

impl Source {
    pub fn label(self) -> &'static str {
        match self {
            Source::Scim => "SCIM",
            Source::Sbp => "Satisfactory Blueprints",
            Source::Direct => "Direct URL",
        }
    }
}

/// Mirrors `detectSource` in `src/modals.tsx`.
pub fn detect_source(url: &str) -> Option<Source> {
    let u = url.trim().to_ascii_lowercase();
    if !(u.starts_with("https://") || u.starts_with("http://")) { return None; }
    if u.contains("satisfactory-calculator.com") { return Some(Source::Scim); }
    if u.contains("satisfactoryblueprints.com") { return Some(Source::Sbp); }
    Some(Source::Direct)
}

pub struct Resolved {
    pub name: String,
    pub sbp: Vec<u8>,
    pub cfg: Option<Vec<u8>>,
}

pub fn resolve(url: &str) -> Result<Resolved, String> {
    match detect_source(url) {
        None => Err("That doesn't look like a blueprint link. Paste a SCIM, Satisfactory Blueprints or direct .sbp URL.".into()),
        Some(src) => Err(format!(
            "Importing from {} links isn't available yet. Ask the host to add this blueprint, or download the .sbp/.sbpcfg yourself and send them over.",
            src.label()
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_sources() {
        assert_eq!(detect_source("https://satisfactory-calculator.com/en/blueprints/index/details/id/5868/name/4x4+360%2Fmin+Steel+Ingots+from+240+Coal+and+Iron+Ore"), Some(Source::Scim));
        assert_eq!(detect_source("https://satisfactoryblueprints.com/blueprint/c4ae7a98-699a-4aab-af31-61f99cfd71f0"), Some(Source::Sbp));
        assert_eq!(detect_source("https://files.example.com/x.sbp"), Some(Source::Direct));
        assert_eq!(detect_source("file:///etc/passwd"), None);
        assert_eq!(detect_source("hello"), None);
    }

    #[test]
    fn unresolved_links_never_produce_files() {
        assert!(resolve("https://satisfactory-calculator.com/en/blueprints/index/details/id/5868/name/x").is_err());
    }
}
