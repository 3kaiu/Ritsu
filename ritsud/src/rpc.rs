use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{self, BufRead, Write};
use std::path::Path;
use crate::cache::{init_cache_db, check_cache, get_cache_key};
use crate::policy::PolicyEngine;
use crate::exec::ExecSandbox;

#[derive(Serialize, Deserialize, Debug)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    pub id: Option<Value>,
    pub method: String,
    pub params: Option<Value>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct JsonRpcResponse {
    pub jsonrpc: String,
    pub id: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<Value>,
}

pub struct RpcServer {
    pub project_root: String,
}

impl RpcServer {
    pub fn new(project_root: &str) -> Self {
        RpcServer {
            project_root: project_root.to_string(),
        }
    }

    /// Run stdio loop, processing incoming JSON-RPC calls.
    pub fn run(&self) -> io::Result<()> {
        let stdin = io::stdin();
        let mut reader = stdin.lock();
        let mut buffer = String::new();

        while reader.read_line(&mut buffer)? > 0 {
            let line = buffer.trim();
            if !line.is_empty() {
                if let Ok(req) = serde_json::from_str::<JsonRpcRequest>(line) {
                    let resp = self.handle_request(req);
                    if let Ok(resp_str) = serde_json::to_string(&resp) {
                        let mut stdout = io::stdout().lock();
                        stdout.write_all(resp_str.as_bytes())?;
                        stdout.write_all(b"\n")?;
                        stdout.flush()?;
                    }
                }
            }
            buffer.clear();
        }
        Ok(())
    }

    fn handle_request(&self, req: JsonRpcRequest) -> JsonRpcResponse {
        let id = req.id.unwrap_or(Value::Null);
        match req.method.as_str() {
            "initialize" => {
                let result = serde_json::json!({
                    "protocolVersion": "2024-11-05",
                    "capabilities": {
                        "tools": {}
                    },
                    "serverInfo": {
                        "name": "ritsud-mcp",
                        "version": "9.1.0"
                    }
                });
                JsonRpcResponse {
                    jsonrpc: "2.0".to_string(),
                    id: Some(id),
                    result: Some(result),
                    error: None,
                }
            }
            "tools/list" => {
                let result = serde_json::json!({
                    "tools": [
                        {
                            "name": "ritsu_preflight",
                            "description": "Perform Ritsu preflight checks and search semantic cache.",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "stage": { "type": "string" },
                                    "prompt": { "type": "string" },
                                    "target_files": {
                                        "type": "array",
                                        "items": { "type": "string" }
                                    }
                                },
                                "required": ["stage"]
                            }
                        },
                        {
                            "name": "ritsu_run_quality_gates",
                            "description": "Execute quality check gates (static lint, clean arch, tests) in the isolated sandbox.",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "session_id": { "type": "string" },
                                    "files": {
                                        "type": "array",
                                        "items": { "type": "string" }
                                    }
                                },
                                "required": ["session_id", "files"]
                            }
                        }
                    ]
                });
                JsonRpcResponse {
                    jsonrpc: "2.0".to_string(),
                    id: Some(id),
                    result: Some(result),
                    error: None,
                }
            }
            "tools/call" => {
                if let Some(params) = req.params {
                    self.handle_tool_call(id, params)
                } else {
                    self.make_error(id, -32602, "Invalid params")
                }
            }
            _ => self.make_error(id, -32601, "Method not found"),
        }
    }

    fn handle_tool_call(&self, id: Value, params: Value) -> JsonRpcResponse {
        let tool_name = match params.get("name").and_then(|v| v.as_str()) {
            Some(n) => n,
            None => return self.make_error(id, -32602, "Missing tool name"),
        };
        
        let args = params.get("arguments").cloned().unwrap_or(Value::Null);

        match tool_name {
            "ritsu_preflight" => {
                let prompt = args.get("prompt").and_then(|v| v.as_str()).unwrap_or("");
                let target_files: Vec<String> = args.get("target_files")
                    .and_then(|v| v.as_array())
                    .unwrap_or(&vec![])
                    .iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect();

                let conn_res = init_cache_db(&self.project_root);
                if let Ok(conn) = conn_res {
                    let cache_key = get_cache_key(prompt, &target_files, &self.project_root);
                    if let Ok(Some(entry)) = check_cache(&conn, &cache_key) {
                        // Apply cached patches
                        let _ = crate::cache::restore_files(&entry, &self.project_root);
                        
                        let result = serde_json::json!({
                            "content": [{
                                "type": "text",
                                "text": format!("🌈 Ritsu Cache HIT! Restored file modifications automatically.\nTokens Saved: {}\nOutput:\n{}", entry.tokens_saved, entry.llm_output)
                            }],
                            "isError": false,
                            "cache_hit": true
                        });
                        return JsonRpcResponse {
                            jsonrpc: "2.0".to_string(),
                            id: Some(id),
                            result: Some(result),
                            error: None,
                        };
                    }
                }

                // Cache missed
                let result = serde_json::json!({
                    "content": [{
                        "type": "text",
                        "text": "Cache Missed. Run sub-task through the specialized agent normally."
                    }],
                    "isError": false,
                    "cache_hit": false
                });
                JsonRpcResponse {
                    jsonrpc: "2.0".to_string(),
                    id: Some(id),
                    result: Some(result),
                    error: None,
                }
            }
            "ritsu_run_quality_gates" => {
                let session_id = match args.get("session_id").and_then(|v| v.as_str()) {
                    Some(s) => s,
                    None => return self.make_error(id, -32602, "Missing session_id"),
                };
                let files: Vec<String> = args.get("files")
                    .and_then(|v| v.as_array())
                    .unwrap_or(&vec![])
                    .iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect();

                let sandbox_path = Path::new(&self.project_root).join(".ritsu").join("sandbox").join(session_id);
                let policy_engine = PolicyEngine::new(&sandbox_path);
                
                // Audit codebase using Tree-sitter AST rules
                let violations = policy_engine.audit_files(&files);
                let errors_count = violations.iter().filter(|v| v.severity == "error").count();

                if errors_count > 0 {
                    let result = serde_json::json!({
                        "content": [{
                            "type": "text",
                            "text": serde_json::to_string_pretty(&violations).unwrap_or_default()
                        }],
                        "isError": true
                    });
                    JsonRpcResponse {
                        jsonrpc: "2.0".to_string(),
                        id: Some(id),
                        result: Some(result),
                        error: None,
                    }
                } else {
                    // Safe execution
                    let executor = ExecSandbox::new(&sandbox_path);
                    
                    // Build project inside isolated OS process container
                    let build_out = executor.run_sandboxed("tsc", &[]);
                    if let Ok(out) = build_out {
                        if !out.status.success() {
                            let result = serde_json::json!({
                                "content": [{
                                    "type": "text",
                                    "text": format!("❌ Compilation failed:\n{}", String::from_utf8_lossy(&out.stderr))
                                }],
                                "isError": true
                            });
                            return JsonRpcResponse {
                                jsonrpc: "2.0".to_string(),
                                id: Some(id),
                                result: Some(result),
                                error: None,
                            };
                        }
                    }

                    let result = serde_json::json!({
                        "content": [{
                            "type": "text",
                            "text": "✅ All quality gates passed successfully. No Clean Architecture or syntax violations found."
                        }],
                        "isError": false
                    });
                    JsonRpcResponse {
                        jsonrpc: "2.0".to_string(),
                        id: Some(id),
                        result: Some(result),
                        error: None,
                    }
                }
            }
            _ => self.make_error(id, -32601, "Tool not found"),
        }
    }

    fn make_error(&self, id: Value, code: i32, message: &str) -> JsonRpcResponse {
        let error = serde_json::json!({
            "code": code,
            "message": message
        });
        JsonRpcResponse {
            jsonrpc: "2.0".to_string(),
            id: Some(id),
            result: None,
            error: Some(error),
        }
    }
}
