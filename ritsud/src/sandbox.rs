#![allow(dead_code)]

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

pub struct Sandbox {
    pub session_id: String,
    pub path: PathBuf,
    pub project_root: PathBuf,
}

impl Sandbox {
    /// Create a new Git Worktree Sandbox using Sparse Checkout.
    /// This only checks out the target files to avoid giant disk I/O on Monorepos.
    pub fn create(
        project_root: &str,
        session_id: &str,
        commit_sha: &str,
        target_files: &[String],
    ) -> Result<Self, String> {
        let root_path = Path::new(project_root);
        let sandbox_path = root_path.join(".ritsu").join("sandbox").join(session_id);
        
        // Ensure parent sandbox directory exists
        if let Some(parent) = sandbox_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        
        // If sandbox path already exists, clean it up first
        if sandbox_path.exists() {
            let _ = Self::cleanup_dir(project_root, session_id, &sandbox_path);
        }
        
        // 1. Add Git Worktree without checkout
        let output = Command::new("git")
            .args(&[
                "worktree",
                "add",
                "--no-checkout",
                sandbox_path.to_str().unwrap(),
                commit_sha,
            ])
            .current_dir(project_root)
            .output()
            .map_err(|e| format!("Failed to run git worktree add: {}", e))?;
            
        if !output.status.success() {
            return Err(format!(
                "git worktree add failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }
        
        // 2. Initialize sparse checkout inside the worktree
        let output = Command::new("git")
            .args(&["sparse-checkout", "init", "--cone"])
            .current_dir(&sandbox_path)
            .output()
            .map_err(|e| format!("Failed to run git sparse-checkout init: {}", e))?;
            
        if !output.status.success() {
            let _ = Self::cleanup_dir(project_root, session_id, &sandbox_path);
            return Err(format!(
                "git sparse-checkout init failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }
        
        // 3. Set the sparse checkout paths to target files only
        if !target_files.is_empty() {
            let mut args = vec!["sparse-checkout".to_string(), "set".to_string()];
            args.extend(target_files.iter().cloned());
            
            let output = Command::new("git")
                .args(&args)
                .current_dir(&sandbox_path)
                .output()
                .map_err(|e| format!("Failed to run git sparse-checkout set: {}", e))?;
                
            if !output.status.success() {
                let _ = Self::cleanup_dir(project_root, session_id, &sandbox_path);
                return Err(format!(
                    "git sparse-checkout set failed: {}",
                    String::from_utf8_lossy(&output.stderr)
                ));
            }

            // 4. Checkout the sparse files into the working directory
            let checkout_output = Command::new("git")
                .args(&["checkout"])
                .current_dir(&sandbox_path)
                .output()
                .map_err(|e| format!("Failed to run git checkout: {}", e))?;

            if !checkout_output.status.success() {
                let _ = Self::cleanup_dir(project_root, session_id, &sandbox_path);
                return Err(format!(
                    "git checkout failed: {}",
                    String::from_utf8_lossy(&checkout_output.stderr)
                ));
            }
        }
        
        Ok(Sandbox {
            session_id: session_id.to_string(),
            path: sandbox_path,
            project_root: root_path.to_path_buf(),
        })
    }
    
    /// Delete the worktree and clean up files.
    pub fn destroy(self) -> Result<(), String> {
        Self::cleanup_dir(
            self.project_root.to_str().unwrap(),
            &self.session_id,
            &self.path,
        )
    }
    
    fn cleanup_dir(project_root: &str, session_id: &str, sandbox_path: &Path) -> Result<(), String> {
        // Run git worktree remove
        let output = Command::new("git")
            .args(&["worktree", "remove", "--force", session_id])
            .current_dir(project_root)
            .output();
            
        // Clean up the directory recursively if it still exists
        if sandbox_path.exists() {
            let _ = fs::remove_dir_all(sandbox_path);
        }
        
        match output {
            Ok(out) if out.status.success() => Ok(()),
            Ok(out) => Err(format!(
                "git worktree remove failed: {}",
                String::from_utf8_lossy(&out.stderr)
            )),
            Err(e) => Err(e.to_string()),
        }
    }
    
    /// Create a Copy-on-Write write proxy:
    /// Read file from main project workspace and write it to sandbox path.
    pub fn write_shadow_file(&self, relative_path: &str, content: &str) -> std::io::Result<()> {
        let shadow_file_path = self.path.join(relative_path);
        if let Some(parent) = shadow_file_path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(shadow_file_path, content)
    }
    
    /// Read file from shadow workspace.
    pub fn read_shadow_file(&self, relative_path: &str) -> std::io::Result<String> {
        fs::read_to_string(self.path.join(relative_path))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    
    // Helper to init git repo in temp dir for testing worktree
    fn init_git_repo(path: &Path) {
        Command::new("git").arg("init").current_dir(path).output().unwrap();
        Command::new("git")
            .args(&["config", "user.email", "test@ritsu.ai"])
            .current_dir(path)
            .output()
            .unwrap();
        Command::new("git")
            .args(&["config", "user.name", "Test Ritsu"])
            .current_dir(path)
            .output()
            .unwrap();
            
        let dummy = path.join("dummy.txt");
        fs::write(&dummy, "initial code base").unwrap();
        
        Command::new("git").args(&["add", "dummy.txt"]).current_dir(path).output().unwrap();
        Command::new("git").args(&["commit", "-m", "initial commit"]).current_dir(path).output().unwrap();
    }

    #[test]
    fn test_git_worktree_sandbox_lifecycle() {
        let repo_dir = tempdir().unwrap();
        init_git_repo(repo_dir.path());
        
        let project_root = repo_dir.path().to_str().unwrap();
        
        // Get commit SHA
        let commit_sha_output = Command::new("git")
            .args(&["rev-parse", "HEAD"])
            .current_dir(project_root)
            .output()
            .unwrap();
        let commit_sha = String::from_utf8(commit_sha_output.stdout).unwrap().trim().to_string();
        
        let sandbox = Sandbox::create(
            project_root,
            "session_test",
            &commit_sha,
            &["dummy.txt".to_string()],
        ).unwrap();
        
        assert!(sandbox.path.exists());
        assert!(sandbox.path.join("dummy.txt").exists());
        
        // Test write proxy (COW)
        sandbox.write_shadow_file("dummy.txt", "updated sandbox version").unwrap();
        let read = sandbox.read_shadow_file("dummy.txt").unwrap();
        assert_eq!(read, "updated sandbox version");
        
        // Ensure main repo is NOT polluted
        let main_read = fs::read_to_string(repo_dir.path().join("dummy.txt")).unwrap();
        assert_eq!(main_read, "initial code base");
        
        // Destroy sandbox
        sandbox.destroy().unwrap();
        assert!(!repo_dir.path().join(".ritsu/sandbox/session_test").exists());
    }
}
