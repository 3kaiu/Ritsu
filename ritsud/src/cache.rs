#![allow(dead_code)]

use rusqlite::{params, Connection, Error as SqliteError};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::Path;

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct FilePatch {
    pub file_path: String,
    pub original_sha256: String,
    pub patched_content: String,
}

#[derive(Debug)]
pub struct CacheEntry {
    pub key_hash: String,
    pub contract_id: String,
    pub agent_role: String,
    pub original_prompt: String,
    pub modified_files: Vec<FilePatch>,
    pub artifacts: HashMap<String, String>,
    pub ok: bool,
    pub quality_gates_passed: bool,
    pub llm_output: String,
    pub tokens_saved: u64,
    pub chunk_signatures: HashMap<String, String>,
}

/// Initialize the SQLite database and create the rainbow_cache table if not exists.
pub fn init_cache_db(project_root: &str) -> Result<Connection, SqliteError> {
    let ritsu_dir = Path::new(project_root).join(".ritsu");
    if !ritsu_dir.exists() {
        fs::create_dir_all(&ritsu_dir).map_err(|e| {
            SqliteError::ToSqlConversionFailure(Box::new(e))
        })?;
    }
    
    let db_path = ritsu_dir.join("vectors.db");
    let conn = Connection::open(db_path)?;
    
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    
    conn.execute(
        "CREATE TABLE IF NOT EXISTS rainbow_cache (
            key_hash TEXT PRIMARY KEY,
            contract_id TEXT NOT NULL,
            agent_role TEXT NOT NULL,
            original_prompt TEXT NOT NULL,
            modified_files TEXT NOT NULL,
            artifacts TEXT NOT NULL,
            ok INTEGER NOT NULL,
            quality_passed INTEGER NOT NULL,
            llm_output TEXT NOT NULL,
            tokens_saved INTEGER NOT NULL,
            chunk_signatures TEXT NOT NULL DEFAULT '{}',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
         );",
        [],
    )?;
    
    // Migration: add chunk_signatures column if it does not exist
    let _ = conn.execute(
        "ALTER TABLE rainbow_cache ADD COLUMN chunk_signatures TEXT NOT NULL DEFAULT '{}';",
        [],
    );
    
    Ok(conn)
}

/// Helper function to strip comments and whitespaces from code for normalization.
pub fn normalize_content(content: &str) -> String {
    let mut clean = String::with_capacity(content.len());
    let mut chars = content.chars().peekable();
    
    while let Some(c) = chars.next() {
        if c == '/' {
            if let Some(&'/') = chars.peek() {
                // Skip single-line comment
                chars.next();
                while let Some(nc) = chars.next() {
                    if nc == '\n' || nc == '\r' {
                        break;
                    }
                }
                continue;
            } else if let Some(&'*') = chars.peek() {
                // Skip multi-line comment
                chars.next();
                while let Some(nc) = chars.next() {
                    if nc == '*' {
                        if let Some(&'/') = chars.peek() {
                            chars.next();
                            break;
                        }
                    }
                }
                continue;
            }
        }
        
        // Skip whitespaces, newlines, and tabs to normalize styling variations
        if !c.is_whitespace() {
            clean.push(c);
        }
    }
    clean
}

/// Compute a normalized semantic hash of file contents by stripping comments and whitespaces.
/// This works for any language (TS, JS, Go, Rust, SQL, shell scripts) without external C parsers.
pub fn calculate_semantic_hash(content: &str) -> String {
    let clean = normalize_content(content);
    let mut hasher = Sha256::new();
    hasher.update(clean.as_bytes());
    format!("{:x}", hasher.finalize())
}

/// Compute a joint dependency-aware hash for TS/JS files by splitting them into
/// Imports, Globals, and Functions/Classes chunks and hashing their sorted representation.
pub fn calculate_dependency_aware_hash(content: &str, ext: &str) -> String {
    let is_js_ts = ext == "ts" || ext == "tsx" || ext == "js" || ext == "jsx";
    if !is_js_ts {
        return calculate_semantic_hash(content);
    }

    let mut parser = tree_sitter::Parser::new();
    let lang = if ext == "ts" || ext == "tsx" {
        tree_sitter_typescript::language_typescript()
    } else {
        tree_sitter_javascript::language()
    };

    if parser.set_language(lang).is_err() {
        return calculate_semantic_hash(content);
    }

    let tree = match parser.parse(content, None) {
        Some(t) => t,
        None => return calculate_semantic_hash(content),
    };

    let mut imports = Vec::new();
    let mut globals = Vec::new();
    let mut functions = Vec::new();

    fn collect_nodes(
        node: tree_sitter::Node,
        content: &str,
        is_top_level_var: bool,
        imports: &mut Vec<String>,
        globals: &mut Vec<String>,
        functions: &mut Vec<String>,
    ) {
        let kind = node.kind();
        
        if kind == "import_statement" || kind == "import_declaration" {
            if let Ok(text) = node.utf8_text(content.as_bytes()) {
                imports.push(normalize_content(text));
            }
            return;
        }

        if is_top_level_var && (kind == "lexical_declaration" || kind == "variable_declaration") {
            if let Ok(text) = node.utf8_text(content.as_bytes()) {
                globals.push(normalize_content(text));
            }
            return;
        }

        if kind == "function_declaration" || kind == "generator_function_declaration" || kind == "method_definition" {
            if let Ok(text) = node.utf8_text(content.as_bytes()) {
                functions.push(normalize_content(text));
            }
            return;
        }

        if kind == "class_declaration" {
            if let Ok(text) = node.utf8_text(content.as_bytes()) {
                functions.push(normalize_content(text));
            }
        }

        let mut cursor = node.walk();
        if cursor.goto_first_child() {
            loop {
                let child = cursor.node();
                let child_is_top_level = is_top_level_var && (kind == "program" || kind == "export_statement");
                collect_nodes(child, content, child_is_top_level, imports, globals, functions);
                if !cursor.goto_next_sibling() {
                    break;
                }
            }
        }
    }

    collect_nodes(tree.root_node(), content, true, &mut imports, &mut globals, &mut functions);

    // Sort and dedup to ensure order/formatting independence
    imports.sort();
    imports.dedup();
    globals.sort();
    globals.dedup();
    functions.sort();
    functions.dedup();

    let imports_block = imports.join("\n");
    let globals_block = globals.join("\n");
    let functions_block = functions.join("\n");

    let total_signature = format!(
        "IMPORTS:\n{}\nGLOBALS:\n{}\nFUNCTIONS:\n{}",
        imports_block, globals_block, functions_block
    );

    let mut hasher = Sha256::new();
    hasher.update(total_signature.as_bytes());
    format!("{:x}", hasher.finalize())
}

/// Helper function to retrieve name of a Tree-sitter AST node.
fn get_node_name(node: &tree_sitter::Node, content: &str) -> String {
    let mut cursor = node.walk();
    if cursor.goto_first_child() {
        loop {
            let child = cursor.node();
            let kind = child.kind();
            if kind == "identifier" || kind == "type_identifier" || kind == "property_identifier" {
                if let Ok(text) = child.utf8_text(content.as_bytes()) {
                    return text.to_string();
                }
            }
            if !cursor.goto_next_sibling() {
                break;
            }
        }
    }
    format!("{}_{}", node.kind(), node.start_byte())
}

/// Split the code file into AST chunks and return a mapping of chunk names to their semantic hashes.
pub fn get_ast_chunks(content: &str, ext: &str) -> HashMap<String, String> {
    let mut chunks = HashMap::new();
    let is_js_ts = ext == "ts" || ext == "tsx" || ext == "js" || ext == "jsx";
    if !is_js_ts {
        chunks.insert("file:root".to_string(), calculate_semantic_hash(content));
        return chunks;
    }

    let mut parser = tree_sitter::Parser::new();
    let lang = if ext == "ts" || ext == "tsx" {
        tree_sitter_typescript::language_typescript()
    } else {
        tree_sitter_javascript::language()
    };

    if parser.set_language(lang).is_err() {
        chunks.insert("file:root".to_string(), calculate_semantic_hash(content));
        return chunks;
    }

    let tree = match parser.parse(content, None) {
        Some(t) => t,
        None => {
            chunks.insert("file:root".to_string(), calculate_semantic_hash(content));
            return chunks;
        }
    };

    fn collect_chunks(
        node: tree_sitter::Node,
        content: &str,
        is_top_level_var: bool,
        chunks: &mut HashMap<String, String>,
    ) {
        let kind = node.kind();
        
        if kind == "import_statement" || kind == "import_declaration" {
            if let Ok(text) = node.utf8_text(content.as_bytes()) {
                chunks.insert(format!("import:{}", get_node_name(&node, content)), calculate_semantic_hash(text));
            }
            return;
        }

        if is_top_level_var && (kind == "lexical_declaration" || kind == "variable_declaration") {
            let mut cursor = node.walk();
            if cursor.goto_first_child() {
                loop {
                    let child = cursor.node();
                    if child.kind() == "variable_declarator" {
                        if let Ok(text) = child.utf8_text(content.as_bytes()) {
                            chunks.insert(format!("global_var:{}", get_node_name(&child, content)), calculate_semantic_hash(text));
                        }
                    }
                    if !cursor.goto_next_sibling() {
                        break;
                    }
                }
            }
            return;
        }

        if kind == "function_declaration" || kind == "generator_function_declaration" {
            if let Ok(text) = node.utf8_text(content.as_bytes()) {
                chunks.insert(format!("function:{}", get_node_name(&node, content)), calculate_semantic_hash(text));
            }
            return;
        }

        if kind == "method_definition" {
            if let Ok(text) = node.utf8_text(content.as_bytes()) {
                let class_name = node.parent()
                    .and_then(|p| p.parent())
                    .map(|gp| get_node_name(&gp, content))
                    .unwrap_or_else(|| "unknown_class".to_string());
                chunks.insert(format!("method:{}:{}", class_name, get_node_name(&node, content)), calculate_semantic_hash(text));
            }
            return;
        }

        if kind == "class_declaration" {
            if let Ok(text) = node.utf8_text(content.as_bytes()) {
                chunks.insert(format!("class:{}", get_node_name(&node, content)), calculate_semantic_hash(text));
            }
        }

        let mut cursor = node.walk();
        if cursor.goto_first_child() {
            loop {
                let child = cursor.node();
                let child_is_top_level = is_top_level_var && (kind == "program" || kind == "export_statement");
                collect_chunks(child, content, child_is_top_level, chunks);
                if !cursor.goto_next_sibling() {
                    break;
                }
            }
        }
    }

    collect_chunks(tree.root_node(), content, true, &mut chunks);
    chunks
}

/// Compute AST chunks for a file in the project.
pub fn get_file_chunk_signatures(project_root: &str, file_rel: &str) -> HashMap<String, String> {
    let full_path = Path::new(project_root).join(file_rel);
    let ext = Path::new(file_rel).extension().and_then(|e| e.to_str()).unwrap_or("");
    if full_path.exists() {
        if let Ok(mut f) = File::open(full_path) {
            let mut buf = String::new();
            if f.read_to_string(&mut buf).is_ok() {
                return get_ast_chunks(&buf, ext);
            }
        }
    }
    HashMap::new()
}

/// Compute the cache key from a task prompt and the list of target files.
pub fn get_cache_key(prompt: &str, target_files: &[String], project_root: &str) -> String {
    let mut hasher = Sha256::new();
    // Add prompt
    hasher.update(prompt.as_bytes());
    
    // Add target files path and their content hashes
    for file in target_files {
        hasher.update(file.as_bytes());
        let full_path = Path::new(project_root).join(file);
        let ext = Path::new(file).extension().and_then(|e| e.to_str()).unwrap_or("");
        
        if full_path.exists() {
            if let Ok(mut f) = File::open(full_path) {
                let mut buf = String::new();
                if f.read_to_string(&mut buf).is_ok() {
                    let dep_hash = calculate_dependency_aware_hash(&buf, ext);
                    hasher.update(dep_hash.as_bytes());
                }
            }
        } else {
            hasher.update(b"not-exists");
        }
    }
    
    format!("{:x}", hasher.finalize())
}

/// Retrieve a cached execution result by key.
pub fn check_cache(conn: &Connection, key_hash: &str) -> Result<Option<CacheEntry>, SqliteError> {
    let mut stmt = conn.prepare(
        "SELECT key_hash, contract_id, agent_role, original_prompt, modified_files, artifacts, ok, quality_passed, llm_output, tokens_saved, chunk_signatures 
         FROM rainbow_cache WHERE key_hash = ?1"
    )?;
    
    let mut rows = stmt.query(params![key_hash])?;
    if let Some(row) = rows.next()? {
        let modified_files_json: String = row.get(4)?;
        let artifacts_json: String = row.get(5)?;
        let chunk_signatures_json: String = row.get(10)?;
        
        let modified_files: Vec<FilePatch> = serde_json::from_str(&modified_files_json)
            .map_err(|e| SqliteError::ToSqlConversionFailure(Box::new(e)))?;
            
        let artifacts: HashMap<String, String> = serde_json::from_str(&artifacts_json)
            .map_err(|e| SqliteError::ToSqlConversionFailure(Box::new(e)))?;
            
        let chunk_signatures: HashMap<String, String> = serde_json::from_str(&chunk_signatures_json)
            .map_err(|e| SqliteError::ToSqlConversionFailure(Box::new(e)))?;
            
        let entry = CacheEntry {
            key_hash: row.get(0)?,
            contract_id: row.get(1)?,
            agent_role: row.get(2)?,
            original_prompt: row.get(3)?,
            modified_files,
            artifacts,
            ok: row.get::<_, i32>(6)? != 0,
            quality_gates_passed: row.get::<_, i32>(7)? != 0,
            llm_output: row.get(8)?,
            tokens_saved: row.get::<_, i64>(9)? as u64,
            chunk_signatures,
        };
        
        Ok(Some(entry))
    } else {
        Ok(None)
    }
}

/// Insert or replace a cache record.
pub fn insert_cache(conn: &Connection, entry: &CacheEntry) -> Result<(), SqliteError> {
    let modified_files_json = serde_json::to_string(&entry.modified_files)
        .map_err(|e| SqliteError::ToSqlConversionFailure(Box::new(e)))?;
        
    let artifacts_json = serde_json::to_string(&entry.artifacts)
        .map_err(|e| SqliteError::ToSqlConversionFailure(Box::new(e)))?;
        
    let chunk_signatures_json = serde_json::to_string(&entry.chunk_signatures)
        .map_err(|e| SqliteError::ToSqlConversionFailure(Box::new(e)))?;
        
    conn.execute(
        "INSERT OR REPLACE INTO rainbow_cache (
            key_hash, contract_id, agent_role, original_prompt, modified_files, artifacts, ok, quality_passed, llm_output, tokens_saved, chunk_signatures
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            entry.key_hash,
            entry.contract_id,
            entry.agent_role,
            entry.original_prompt,
            modified_files_json,
            artifacts_json,
            if entry.ok { 1 } else { 0 },
            if entry.quality_gates_passed { 1 } else { 0 },
            entry.llm_output,
            entry.tokens_saved as i64,
            chunk_signatures_json
        ],
    )?;
    
    Ok(())
}

/// Restore cached modified files and artifacts directly onto the workspace.
pub fn restore_files(entry: &CacheEntry, project_root: &str) -> std::io::Result<()> {
    for patch in &entry.modified_files {
        let full_path = Path::new(project_root).join(&patch.file_path);
        if let Some(parent) = full_path.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut file = File::create(full_path)?;
        file.write_all(patch.patched_content.as_bytes())?;
    }
    
    for (path_str, content) in &entry.artifacts {
        let full_path = Path::new(project_root).join(path_str);
        if let Some(parent) = full_path.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut file = File::create(full_path)?;
        file.write_all(content.as_bytes())?;
    }
    
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_calculate_semantic_hash() {
        let code1 = "// Hello comment\nfunction test() {\n    let a = 1;\n    /* multiline comment */\n    return a;\n}";
        let code2 = "function test(){let a=1;return a;}";
        assert_eq!(calculate_semantic_hash(code1), calculate_semantic_hash(code2));
    }

    #[test]
    fn test_calculate_dependency_aware_hash() {
        let code_base = "
            import { a } from 'module-a';
            import { b } from 'module-b';
            const GLOBAL_VAL = 42;
            function foo() { return 1; }
            class Bar {
                baz() { return 2; }
            }
        ";

        // 1. Reordering imports and whitespaces shouldn't change hash
        let code_reorder_imports = "
            import { b } from 'module-b';
            import { a } from 'module-a';
            const GLOBAL_VAL = 42;
            function foo() {
                return 1;
            }
            class Bar {
                baz() {
                    return 2;
                }
            }
        ";
        assert_eq!(
            calculate_dependency_aware_hash(code_base, "ts"),
            calculate_dependency_aware_hash(code_reorder_imports, "ts")
        );

        // 2. Adding a comment shouldn't change hash
        let code_comment = "
            import { a } from 'module-a';
            import { b } from 'module-b';
            const GLOBAL_VAL = 42; // some comment
            /* multiline comment */
            function foo() { return 1; }
            class Bar {
                baz() { return 2; }
            }
        ";
        assert_eq!(
            calculate_dependency_aware_hash(code_base, "ts"),
            calculate_dependency_aware_hash(code_comment, "ts")
        );

        // 3. Modifying a function body SHOULD change hash
        let code_modified_func = "
            import { a } from 'module-a';
            import { b } from 'module-b';
            const GLOBAL_VAL = 42;
            function foo() { return 999; }
            class Bar {
                baz() { return 2; }
            }
        ";
        assert_ne!(
            calculate_dependency_aware_hash(code_base, "ts"),
            calculate_dependency_aware_hash(code_modified_func, "ts")
        );

        // 4. Modifying a global variable SHOULD change hash
        let code_modified_global = "
            import { a } from 'module-a';
            import { b } from 'module-b';
            const GLOBAL_VAL = 100;
            function foo() { return 1; }
            class Bar {
                baz() { return 2; }
            }
        ";
        assert_ne!(
            calculate_dependency_aware_hash(code_base, "ts"),
            calculate_dependency_aware_hash(code_modified_global, "ts")
        );
    }

    #[test]
    fn test_get_ast_chunks() {
        let code = "
            import { a } from 'module-a';
            const GLOBAL_VAL = 42;
            function foo() { return 1; }
            class Bar {
                baz() { return 2; }
            }
        ";
        let chunks = get_ast_chunks(code, "ts");
        
        // Assert some known chunks exist in the result
        assert!(chunks.contains_key("import:import_statement_13"));
        assert!(chunks.contains_key("global_var:GLOBAL_VAL"));
        assert!(chunks.contains_key("function:foo"));
        assert!(chunks.contains_key("class:Bar"));
        assert!(chunks.contains_key("method:Bar:baz"));

        // Verify fallback works for non-js/ts files
        let py_code = "def test():\n    pass";
        let py_chunks = get_ast_chunks(py_code, "py");
        assert_eq!(py_chunks.len(), 1);
        assert!(py_chunks.contains_key("file:root"));
    }

    #[test]
    fn test_sqlite_db_cache_lifecycle() {
        let dir = tempdir().unwrap();
        let root = dir.path().to_str().unwrap();
        let conn = init_cache_db(root).unwrap();

        let patch = FilePatch {
            file_path: "src/dummy.rs".to_string(),
            original_sha256: "abc".to_string(),
            patched_content: "println!(\"foo\");".to_string(),
        };

        let entry = CacheEntry {
            key_hash: "hash123".to_string(),
            contract_id: "C1".to_string(),
            agent_role: "frontend".to_string(),
            original_prompt: "write a dummy page".to_string(),
            modified_files: vec![patch],
            artifacts: HashMap::new(),
            ok: true,
            quality_gates_passed: true,
            llm_output: "Done!".to_string(),
            tokens_saved: 42000,
            chunk_signatures: HashMap::new(),
        };

        insert_cache(&conn, &entry).unwrap();
        let retrieved = check_cache(&conn, "hash123").unwrap().unwrap();
        assert_eq!(retrieved.contract_id, "C1");
        assert_eq!(retrieved.agent_role, "frontend");
        assert_eq!(retrieved.modified_files[0].file_path, "src/dummy.rs");
        assert_eq!(retrieved.modified_files[0].patched_content, "println!(\"foo\");");
    }
}
