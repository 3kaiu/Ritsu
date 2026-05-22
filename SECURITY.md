# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Ritsu, please report it privately by opening a GitHub Security Advisory at:

https://github.com/3kaiu/Ritsu/security/advisories/new

Please do NOT disclose the issue publicly until it has been addressed.

## What to Include

- Description of the vulnerability
- Steps to reproduce
- Affected versions
- Potential impact

## Response

We aim to acknowledge receipt within 48 hours and provide a fix within 7 days for critical issues.

## Scope

Ritsu's security boundary includes:

- `ritsu_exec` command execution protections (binary allow-list, shell metachar rejection)
- Path traversal prevention in artifact operations
- HMAC signature verification (ts, correlation_id, trace_id, span_id, skill, domain, status, artifact, violation)
- Git branch name injection in sync operations
- Code security detection: `security_smell` detector (eval, XSS, command injection, SQL injection, path traversal)
- Credential leak detection: `regex` detector (API keys, tokens, passwords in diffs)
- Policy engine integrity (11 detectors, anti-pattern enforcement)
- `sandbox` mode for high-risk MCP tool operations

## Supported Versions

| Version | Supported |
|---------|-----------|
| ≥ 8.0.0 | ✅ |
| ≥ 7.3.0 | ✅ |
| < 7.3.0 | ❌ |
