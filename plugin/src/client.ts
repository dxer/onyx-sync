import { requestUrl } from 'obsidian';
import type {
  SessionInfoResponse,
  SyncStatusResponse,
  ChangesResponse,
  CommitChangeItem,
  CommitResult,
  BlobCheckResponse
} from '@onyx/shared';

export class SyncApiClient {
  private baseUrl: string;
  private token: string;

  constructor(serverUrl: string, token = '') {
    this.baseUrl = serverUrl.replace(/\/+$/, '');
    this.token = token.trim();
  }

  setCredentials(serverUrl: string, token: string): void {
    this.baseUrl = serverUrl.replace(/\/+$/, '');
    this.token = token.trim();
  }

  private getHeaders(extraHeaders: Record<string, string> = {}): Record<string, string> {
    const headers: Record<string, string> = { ...extraHeaders };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    return headers;
  }

  async checkHealth(): Promise<boolean> {
    try {
      const res = await requestUrl({
        url: `${this.baseUrl}/api/v1/health`,
        method: 'GET'
      });
      return res.status === 200;
    } catch {
      return false;
    }
  }

  // Handshake session to get bound vault info, salt, and device name
  async getSession(): Promise<SessionInfoResponse> {
    const res = await requestUrl({
      url: `${this.baseUrl}/api/v1/session`,
      method: 'GET',
      headers: this.getHeaders()
    });
    return res.json;
  }

  async getStatus(): Promise<SyncStatusResponse> {
    const res = await requestUrl({
      url: `${this.baseUrl}/api/v1/sync/status`,
      method: 'GET',
      headers: this.getHeaders()
    });
    return res.json;
  }

  async getChanges(sinceVersion: number): Promise<ChangesResponse> {
    const res = await requestUrl({
      url: `${this.baseUrl}/api/v1/sync/changes?since=${sinceVersion}`,
      method: 'GET',
      headers: this.getHeaders()
    });
    return res.json;
  }

  async commit(changes: CommitChangeItem[], requestId?: string): Promise<CommitResult> {
    const res = await requestUrl({
      url: `${this.baseUrl}/api/v1/sync/commit`,
      method: 'POST',
      headers: this.getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ requestId, changes })
    });
    return res.json;
  }

  async checkBlobs(hashes: string[]): Promise<BlobCheckResponse> {
    const res = await requestUrl({
      url: `${this.baseUrl}/api/v1/sync/blobs/check`,
      method: 'POST',
      headers: this.getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ hashes })
    });
    return res.json;
  }

  async uploadBlob(hash: string, data: Uint8Array): Promise<void> {
    await requestUrl({
      url: `${this.baseUrl}/api/v1/sync/blobs/${hash}`,
      method: 'PUT',
      headers: this.getHeaders({ 'Content-Type': 'application/octet-stream' }),
      body: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
    });
  }

  async downloadBlob(hash: string): Promise<Uint8Array> {
    const res = await requestUrl({
      url: `${this.baseUrl}/api/v1/sync/blobs/${hash}`,
      method: 'GET',
      headers: this.getHeaders()
    });
    return new Uint8Array(res.arrayBuffer);
  }

  // Exchanges the device token for a short-lived single-use WebSocket ticket.
  // Throws on deployments without WebSocket support (e.g. Cloudflare Worker).
  async createWsTicket(): Promise<{ ticket: string; expiresIn: number }> {
    const res = await requestUrl({
      url: `${this.baseUrl}/api/v1/ws/ticket`,
      method: 'POST',
      headers: this.getHeaders()
    });
    if (res.status !== 200) {
      throw new Error(`WebSocket ticket request failed: ${res.status}`);
    }
    return res.json;
  }
}
