use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PolicyViolation {
    pub rule_id: String,
    pub file_path: String,
    pub line_number: usize,
    pub message: String,
    pub severity: String, // "error" | "warn"
}

pub struct PolicyEngine {
    pub project_root: PathBuf,
}

impl PolicyEngine {
    pub fn new(project_root: &Path) -> Self {
        PolicyEngine {
            project_root: project_root.to_path_buf(),
        }
    }

    /// Run full policy audit on a list of files.
    pub fn audit_files(&self, files: &[String]) -> Vec<PolicyViolation> {
        let mut violations = Vec::new();
        for file_rel in files {
            let full_path = self.project_root.join(file_rel);
            if full_path.exists() && full_path.is_file() {
                violations.extend(self.audit_file(file_rel, &full_path));
            }
        }
        violations
    }

    /// Audit a single file for clean architecture, empty catches, debugger, console.logs, and SQL drop commands.
    pub fn audit_file(&self, file_rel: &str, file_path: &Path) -> Vec<PolicyViolation> {
        let mut violations = Vec::new();
        let content = match fs::read_to_string(file_path) {
            Ok(c) => c,
            Err(_) => return violations,
        };

        let ext = file_path.extension().and_then(|e| e.to_str()).unwrap_or("");
        let is_js_ts = ext == "ts" || ext == "tsx" || ext == "js" || ext == "jsx";

        // --- 1. Tree-sitter AST queries for TS/JS files ---
        if is_js_ts {
            let mut parser = tree_sitter::Parser::new();
            let lang = if ext == "ts" || ext == "tsx" {
                tree_sitter_typescript::language_typescript()
            } else {
                tree_sitter_javascript::language()
            };

            if parser.set_language(lang).is_ok() {
                if let Some(tree) = parser.parse(&content, None) {
                    let root_node = tree.root_node();

                    // Query for empty catch block (AP-7)
                    let empty_catch_query_str = "(statement_block) @empty_body";
                    if let Ok(query) = tree_sitter::Query::new(lang, empty_catch_query_str) {
                        let mut cursor = tree_sitter::QueryCursor::new();
                        let matches = cursor.matches(&query, root_node, content.as_bytes());
                        for m in matches {
                            for capture in m.captures {
                                let node = capture.node;
                                if node.child_count() <= 2 {
                                    // Check if parent is catch_clause
                                    if let Some(parent) = node.parent() {
                                        if parent.kind() == "catch_clause" {
                                            let start_position = node.start_position();
                                            violations.push(PolicyViolation {
                                                rule_id: "AP-7".to_string(),
                                                file_path: file_rel.to_string(),
                                                line_number: start_position.row + 1,
                                                message: "Empty catch block found. Silent failures must be prevented by adding logging or rethrowing.".to_string(),
                                                severity: "warn".to_string(),
                                            });
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // Query for Clean Architecture imports (R-1)
                    if file_rel.contains("/domain/") {
                        let import_query_str = "(string_literal) @import_path";
                        if let Ok(query) = tree_sitter::Query::new(lang, import_query_str) {
                            let mut cursor = tree_sitter::QueryCursor::new();
                            let matches = cursor.matches(&query, root_node, content.as_bytes());
                            for m in matches {
                                for capture in m.captures {
                                    let node = capture.node;
                                    
                                    // Traverse ancestors to check if it's an import path
                                    let mut is_import = false;
                                    let mut parent = node.parent();
                                    while let Some(p) = parent {
                                        let p_type = p.kind();
                                        if p_type == "import_statement" || p_type == "import_require_clause" || p_type == "import_alias_declaration" || p_type == "import_declaration" {
                                            is_import = true;
                                            break;
                                        }
                                        parent = p.parent();
                                    }

                                    if is_import {
                                        let start = node.start_byte();
                                        let end = node.end_byte();
                                        if start < end && end <= content.len() {
                                            let mut path_val = content[start..end].to_string();
                                            // Strip quotes
                                            if path_val.starts_with('"') || path_val.starts_with('\'') {
                                                path_val.remove(0);
                                            }
                                            if path_val.ends_with('"') || path_val.ends_with('\'') {
                                                path_val.pop();
                                            }

                                            if path_val.contains("/infrastructure/") || path_val.contains("/controllers/") || path_val.contains("/modules/") {
                                                let start_position = node.start_position();
                                                violations.push(PolicyViolation {
                                                    rule_id: "R-1".to_string(),
                                                    file_path: file_rel.to_string(),
                                                    line_number: start_position.row + 1,
                                                    message: "Clean Architecture Violation: Domain layer must not import from Infrastructure, Application, or Controllers layers.".to_string(),
                                                    severity: "error".to_string(),
                                                });
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // --- 2. Fallback/Line-by-line regex linter (Parallel & Deduped) ---
        let mut line_num = 0;
        for line in content.lines() {
            line_num += 1;
            let clean_line = line.trim();

            // 1. Debugger statement check (AP-1)
            if clean_line.contains("debugger;") || clean_line == "debugger" {
                violations.push(PolicyViolation {
                    rule_id: "AP-1".to_string(),
                    file_path: file_rel.to_string(),
                    line_number: line_num,
                    message: "debugger statement found. Remove before committing.".to_string(),
                    severity: "error".to_string(),
                });
            }

            // Clean Architecture check (R-1)
            if file_rel.contains("/domain/") {
                if clean_line.starts_with("import ") && (clean_line.contains("/infrastructure/") || clean_line.contains("/controllers/") || clean_line.contains("/modules/")) {
                    violations.push(PolicyViolation {
                        rule_id: "R-1".to_string(),
                        file_path: file_rel.to_string(),
                        line_number: line_num,
                        message: "Clean Architecture Violation: Domain layer must not import from Infrastructure, Application, or Controllers layers.".to_string(),
                        severity: "error".to_string(),
                    });
                }
            }

            // Empty catch blocks check (AP-7)
            if clean_line.contains("catch") && (clean_line.contains("{}") || clean_line.contains("{\n}") || clean_line.contains("{ }")) {
                violations.push(PolicyViolation {
                    rule_id: "AP-7".to_string(),
                    file_path: file_rel.to_string(),
                    line_number: line_num,
                    message: "Empty catch block found. Silent failures must be prevented by adding logging or rethrowing.".to_string(),
                    severity: "warn".to_string(),
                });
            }

            // Destructive SQL DROP statements (R-5 sql safety)
            if clean_line.to_uppercase().contains("DROP TABLE") || clean_line.to_uppercase().contains("DROP DATABASE") {
                violations.push(PolicyViolation {
                    rule_id: "R-5".to_string(),
                    file_path: file_rel.to_string(),
                    line_number: line_num,
                    message: "Destructive SQL drop statement found. Ensure migrations only apply non-destructive alterations unless explicitly approved.".to_string(),
                    severity: "error".to_string(),
                });
            }

            // Hardcoded API secrets smell (R-6 API leakage)
            if (clean_line.contains("api_key") || clean_line.contains("secret") || clean_line.contains("token") || clean_line.contains("password"))
                && (clean_line.contains("=") || clean_line.contains(":")) {
                if let Some(first_quote) = clean_line.find('"').or_else(|| clean_line.find('\'')) {
                    if let Some(last_quote) = clean_line.rfind('"').or_else(|| clean_line.rfind('\'')) {
                        if last_quote > first_quote {
                            let quoted_val = &clean_line[first_quote + 1..last_quote];
                            if quoted_val.len() > 20 && !quoted_val.contains('/') && !quoted_val.contains('\\') && !quoted_val.contains('.') {
                                violations.push(PolicyViolation {
                                    rule_id: "R-6".to_string(),
                                    file_path: file_rel.to_string(),
                                    line_number: line_num,
                                    message: "Hardcoded API credentials smell detected. Move secrets to environment configurations.".to_string(),
                                    severity: "error".to_string(),
                                });
                            }
                        }
                    }
                }
            }
        }

        // --- 3. Sorting and Deduplication ---
        violations.sort_by(|a, b| {
            a.line_number.cmp(&b.line_number)
                .then(a.rule_id.cmp(&b.rule_id))
                .then(a.message.cmp(&b.message))
        });
        violations.dedup_by(|a, b| {
            a.rule_id == b.rule_id && a.line_number == b.line_number
        });

        violations
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn test_policy_violations_engine() {
        let dir = tempdir().unwrap();
        let engine = PolicyEngine::new(dir.path());

        // Create a mock domain file violating clean architecture
        let domain_file = dir.path().join("src/domain/user.ts");
        fs::create_dir_all(domain_file.parent().unwrap()).unwrap();
        fs::write(
            &domain_file,
            "import { UserDb } from '../infrastructure/db';\n// clean code\ndebugger;\ncatch(e) {}"
        ).unwrap();

        let violations = engine.audit_file("src/domain/user.ts", &domain_file);
        
        assert_eq!(violations.len(), 3);
        assert_eq!(violations[0].rule_id, "R-1"); // Clean Arch
        assert_eq!(violations[1].rule_id, "AP-1"); // debugger
        assert_eq!(violations[2].rule_id, "AP-7"); // empty catch
    }

    #[test]
    fn test_secrets_leak_engine() {
        let dir = tempdir().unwrap();
        let engine = PolicyEngine::new(dir.path());

        // Create a file with a secret key path (should NOT violate R-6)
        let safe_file = dir.path().join("safe.ts");
        fs::write(
            &safe_file,
            "const hasKey = existsSync(resolve(root, \".ritsu/secret.key\"));"
        ).unwrap();
        let safe_violations = engine.audit_file("safe.ts", &safe_file);
        assert_eq!(safe_violations.len(), 0);

        // Create a file with a hardcoded token (should violate R-6)
        let unsafe_file = dir.path().join("unsafe.ts");
        fs::write(
            &unsafe_file,
            "const token = \"ghp_1234567890abcdefghijklmnopqrstuvwxyz\";"
        ).unwrap();
        let unsafe_violations = engine.audit_file("unsafe.ts", &unsafe_file);
        assert_eq!(unsafe_violations.len(), 1);
        assert_eq!(unsafe_violations[0].rule_id, "R-6");
    }

    #[test]
    fn test_tree_sitter_queries() {
        let dir = tempdir().unwrap();
        let engine = PolicyEngine::new(dir.path());

        // Create a mock domain file violating clean architecture and empty catch
        let domain_file = dir.path().join("src/domain/user.ts");
        fs::create_dir_all(domain_file.parent().unwrap()).unwrap();
        fs::write(
            &domain_file,
            "import { db } from '../infrastructure/db';\ntry {\n  let x = 1;\n} catch (e) {}"
        ).unwrap();

        let violations = engine.audit_file("src/domain/user.ts", &domain_file);
        
        let has_r1 = violations.iter().any(|v| v.rule_id == "R-1");
        let has_ap7 = violations.iter().any(|v| v.rule_id == "AP-7");
        
        assert!(has_r1, "Should detect R-1 Clean Architecture violation");
        assert!(has_ap7, "Should detect AP-7 Empty catch block violation");
    }
}
