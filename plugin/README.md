# Onyx Sync

> **Zero-Knowledge End-to-End Encrypted (E2EE) self-hosted sync engine for your notes.**

Onyx Sync gives you full ownership over your notes with military-grade client-side encryption. The server stores only encrypted payloads and cryptographic hashes — **the server administrator cannot inspect note titles, file contents, or directory structures.**

---

## ✨ Features

- 🛡️ **Zero-Knowledge Architecture**: All note contents, attachments, and file paths are encrypted locally using AES-256-GCM before transmission. Encryption keys are derived via PBKDF2 (100,000 iterations) and never leave your devices.
- 🚀 **Self-Hosted & Independent**: Deploy on your own VPS (Docker / Node.js + SQLite) or run 100% serverless on Cloudflare Workers + D1 + R2. Zero vendor lock-in.
- ⚡ **Incremental & Bandwidth-Efficient**: Content-addressed chunking deduplicates unmodified files and images. Only changed blocks are uploaded.
- 🔄 **Real-Time & Offline First**: Instant multi-device sync over WebSockets, coupled with a durable IndexedDB outbox with exponential backoff for uninterrupted offline editing.
- 📱 **Cross-Platform**: Built exclusively on standard Web Crypto API and Obsidian storage APIs, supporting Windows, macOS, Linux, iOS, and Android.

---

## 🚀 Quick Start (3 Steps)

### Step 1: Deploy Your Onyx Server

Onyx Sync requires an Onyx backend server. You can spin one up in minutes:

- **Option A: Docker / VPS (Easiest)**
  ```bash
  docker run -d \
    --name onyx-sync \
    -p 8080:8080 \
    -v onyx_data:/app/data \
    -e ADMIN_PASSWORD=your_strong_admin_password \
    ghcr.io/dxer/onyx-sync:latest
  ```
- **Option B: Cloudflare Workers (Free Serverless)**
  Deploy to Cloudflare Workers + D1 + R2 with zero ongoing server costs.

👉 **[Read full server deployment guides in the Onyx Main Repository →](https://github.com/dxer/onyx-sync)**

---

### Step 2: Create a Device Token

1. Open your browser and navigate to your Onyx server dashboard (e.g., `https://sync.yourdomain.com` or `http://localhost:8080`).
2. Log in with your admin credentials.
3. In the **Vaults & Devices** tab, create a new device token (e.g., `MacBook-Pro` or `iPhone`).
4. Copy the generated Device Token.

---

### Step 3: Configure Onyx Sync Plugin

1. Open **Settings** → **Community Plugins** → **Onyx Sync**.
2. Fill in:
   - **Server URL**: Your deployed Onyx server address (e.g., `https://sync.yourdomain.com`).
   - **Device Token**: The token generated in Step 2.
   - **End-to-End Encryption Passphrase**: A strong passphrase shared across your trusted devices.
3. Click **Test Connection**. Once verified, toggle **Auto Sync** or click the ribbon refresh icon to sync immediately!

---

## 🔒 Security & Privacy by Design

| What the Server Sees | What Only You See |
| :--- | :--- |
| Random 64-character encrypted path hashes | `Work/Project-Plan.md` |
| AES-256-GCM ciphertext bytes | Your notes and attachments |
| Content HMAC (for deduplication) | Plaintext file content |
| Anonymous commit revision timestamps | All unencrypted metadata |

- **No Plaintext Passwords/Tokens Stored**: All authentication tokens are hashed with SHA-256 on the server.
- **Strict Content Security Policy (CSP)**: Built-in Web dashboard operates under strict CSP with zero external CDN dependencies.

---

## 📖 Documentation & Links

- **Main Repository & Server Source**: [https://github.com/dxer/onyx-sync](https://github.com/dxer/onyx-sync)
- **Bug Reports & Feature Requests**: [GitHub Issues](https://github.com/dxer/onyx-sync/issues)
- **License**: MIT License

---

## 🇨🇳 中文简要说明

Onyx Sync 是一款专注于**安全与隐私**的自托管端到端加密同步插件：

- **真正的零知识端到端加密**：所有文件路径、笔记内容、附件在离开设备前均通过 AES-256-GCM 本地加密，服务端管理员无法查看任何笔记标题与内容。
- **极简自建**：支持单 Docker 容器快速启动（支持 VPS / 软路由 / NAS），或一键部署至免费的 Cloudflare Workers Serverless 架构。
- **低带宽增量同步**：基于内容哈希去重，仅上传变更内容；支持断网离线缓存与网络恢复后自动指数退避重试。
- **多端通用**：基于纯 Web Crypto 标准接口，完美支持桌面端（Windows / macOS / Linux）与移动端（iOS / Android）。

服务端详细部署文档与源码请访问：[Onyx 主仓库](https://github.com/dxer/onyx-sync)。
