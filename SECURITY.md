# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

We take the security of Yachiyo Chat seriously. If you discover a security vulnerability or sensitive data exposure, please report it promptly.

### How to Report

1. **Do not create public GitHub issues** for security vulnerabilities.
2. Please report vulnerabilities privately via [GitHub Security Advisory](https://github.com/liangcka/yachiyo-chat/security/advisories/new) or by contacting the maintainer directly.
3. Include detailed steps to reproduce the issue, along with any relevant payloads, environment details, or proof of concept.

### Scope & Privacy Policy
- Yachiyo Chat is designed with a strict client-first privacy model: all conversation history, images, and user-provided API keys remain strictly on the user's client (IndexedDB / LocalStorage) and are never stored on the Cloudflare edge server.
- The serverless edge Functions (`/api/*`) strictly proxy chat requests, apply rate limits via Cloudflare KV, and avoid persisting user conversations or images.
- Please never commit or share private API keys, access codes, or session secrets in reports.
