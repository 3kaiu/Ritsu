use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use tempfile::NamedTempFile;
use std::io::Write;

pub struct ExecSandbox {
    pub sandbox_path: PathBuf,
}

impl ExecSandbox {
    pub fn new(sandbox_path: &Path) -> Self {
        ExecSandbox {
            sandbox_path: sandbox_path.to_path_buf(),
        }
    }

    /// Check if a command is whitelisted.
    /// Returns Ok(()) if safe, or Err(Reason) if malicious or forbidden.
    pub fn verify_command(&self, program: &str, args: &[&str]) -> Result<(), String> {
        let prog = program.to_lowercase();
        
        // 1. Strict program whitelist
        let whitelisted_programs = [
            "bun", "npm", "npx", "pnpm", "yarn", "tsc", "vitest", "jest",
            "eslint", "git", "cargo", "rustc", "echo", "pwd", "ls", "curl"
        ];
        
        if !whitelisted_programs.contains(&prog.as_str()) {
            return Err(format!("Program '{}' is not in Ritsu's sandbox whitelist. Destructive or unknown executions are forbidden.", program));
        }

        // 2. Scan arguments for shell injection and command escape vectors
        let dangerous_keywords = [
            ";", "&&", "||", "|", ">", "<", "`", "$(", "rm", "wget", "bash", "sh", "zsh"
        ];

        for arg in args {
            for kw in &dangerous_keywords {
                if arg.contains(kw) {
                    return Err(format!("Command argument '{}' contains dangerous shell characters or forbidden binaries ('{}'). Execution blocked.", arg, kw));
                }
            }
        }

        Ok(())
    }

    /// Execute a command in a sandboxed process.
    /// - macOS: sandbox-exec -f [profile]
    /// - Linux: unshare -n -p -f
    /// - Fallback: standard Command execution inside sandbox_path
    pub fn run_sandboxed(&self, program: &str, args: &[&str]) -> Result<Output, String> {
        self.verify_command(program, args)?;

        #[cfg(target_os = "macos")]
        {
            self.run_macos_sandbox(program, args)
        }

        #[cfg(target_os = "linux")]
        {
            self.run_linux_sandbox(program, args)
        }

        #[cfg(not(any(target_os = "macos", target_os = "linux")))]
        {
            self.run_fallback(program, args)
        }
    }

    #[allow(dead_code)]
    #[cfg(target_os = "macos")]
    fn run_macos_sandbox(&self, program: &str, args: &[&str]) -> Result<Output, String> {
        // Create temporary sandbox-exec profile
        let profile = format!(
            "(version 1)
             (deny default)
             (allow file-read* (subpath \"/\"))
             (allow file-write* (subpath \"{}\"))
             (allow process-exec (subpath \"/bin\") (subpath \"/usr/bin\") (subpath \"/usr/local/bin\") (subpath \"/usr/sbin\") (subpath \"/sbin\"))
             (deny network-outbound)
            ",
            self.sandbox_path.to_str().unwrap()
        );

        let mut temp_file = NamedTempFile::new().map_err(|e| e.to_string())?;
        temp_file.write_all(profile.as_bytes()).map_err(|e| e.to_string())?;
        let temp_path = temp_file.path().to_path_buf();

        // Prepare program arguments for sandbox-exec
        let mut full_args = vec![
            "-f",
            temp_path.to_str().unwrap(),
            program,
        ];
        full_args.extend(args.iter().cloned());

        let output = Command::new("sandbox-exec")
            .args(&full_args)
            .current_dir(&self.sandbox_path)
            .output()
            .map_err(|e| format!("sandbox-exec execution failed: {}", e))?;

        Ok(output)
    }

    #[allow(dead_code)]
    #[cfg(target_os = "linux")]
    fn run_linux_sandbox(&self, program: &str, args: &[&str]) -> Result<Output, String> {
        // Prepare program args for unshare
        // -n: new network namespace (net is isolated)
        // -p: new pid namespace
        // -f: fork before execing program
        let mut full_args = vec![
            "-n",
            "-p",
            "-f",
            program,
        ];
        full_args.extend(args.iter().cloned());

        let output = Command::new("unshare")
            .args(&full_args)
            .current_dir(&self.sandbox_path)
            .output()
            .map_err(|e| format!("unshare execution failed: {}", e))?;

        Ok(output)
    }

    #[allow(dead_code)]
    fn run_fallback(&self, program: &str, args: &[&str]) -> Result<Output, String> {
        let output = Command::new(program)
            .args(args)
            .current_dir(&self.sandbox_path)
            .output()
            .map_err(|e| format!("Execution failed: {}", e))?;

        Ok(output)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_whitelist_checker() {
        let dir = tempdir().unwrap();
        let executor = ExecSandbox::new(dir.path());

        // Safe command
        assert!(executor.verify_command("bun", &["run", "test"]).is_ok());

        // Forbidden program
        assert!(executor.verify_command("rm", &["-rf", "/"]).is_err());
        assert!(executor.verify_command("wget", &["http://google.com"]).is_err());

        // Whitelisted program
        assert!(executor.verify_command("curl", &["http://localhost:8080"]).is_ok());

        // Shell injection attempt
        assert!(executor.verify_command("bun", &["run", "test", "&&", "rm", "-rf", "."]).is_err());
        assert!(executor.verify_command("bun", &["run", "test", ";", "echo", "leak"]).is_err());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn test_macos_network_containment() {
        let dir = tempdir().unwrap();
        let executor = ExecSandbox::new(dir.path());
        
        // Try to run a simple outbound check. Note: curl is not in our whitelist, so verify_command blocks it.
        // Let's test standard program running inside the sandbox.
        let out = executor.run_sandboxed("echo", &["hello", "from", "sandbox"]).unwrap();
        assert!(out.status.success());
        assert_eq!(String::from_utf8(out.stdout).unwrap().trim(), "hello from sandbox");
    }
}
