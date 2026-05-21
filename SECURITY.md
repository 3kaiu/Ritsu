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

- `ritsu_exec` command execution and shell injection protections
- Path traversal in artifact operations
- HMAC signature verification in trace events
- Git branch name injection in sync operations
- Policy engine integrity (anti-pattern enforcement)

## Supported Versions

| Version | Supported |
|---------|-----------|
| ≥ 1.3.0 | ✅ |
| < 1.3.0 | ❌ |
