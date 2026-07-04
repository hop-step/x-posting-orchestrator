import type { Env } from "../env";
import type { XAccount } from "../domain/auth/types";
import type { Clock } from "../shared/clock";
import { decryptToken, encryptToken } from "../infrastructure/crypto/token-crypto";
import type { PublicationRepository } from "./repository";

type Fetcher = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => Promise<Response>;

interface RefreshTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

export class TokenManager {
  private readonly fetcher: Fetcher;

  constructor(
    private readonly repository: PublicationRepository,
    private readonly env: Env,
    private readonly clock: Clock,
    fetcher?: Fetcher
  ) {
    this.fetcher = fetcher ?? ((input, init) => fetch(input, init));
  }

  async getAccessToken(account: XAccount): Promise<string | null> {
    const secret = this.env.TOKEN_ENCRYPTION_KEY_V1;
    if (secret === undefined || account.accessTokenCiphertext === null || account.accessTokenIv === null) {
      return null;
    }
    const marginMs = Number(this.env.TOKEN_REFRESH_MARGIN_MINUTES ?? "10") * 60 * 1000;
    if (account.accessTokenExpiresAtMs !== null && account.accessTokenExpiresAtMs - marginMs > this.clock.nowMs()) {
      return decryptToken({ ciphertext: account.accessTokenCiphertext, iv: account.accessTokenIv }, secret);
    }
    if (account.refreshTokenCiphertext === null || account.refreshTokenIv === null) {
      return null;
    }
    return this.refresh(account, secret);
  }

  private async refresh(account: XAccount, secret: string): Promise<string | null> {
    if (this.env.X_CLIENT_ID === undefined || this.env.X_CLIENT_SECRET === undefined) {
      return null;
    }
    const refreshToken = await decryptToken({ ciphertext: account.refreshTokenCiphertext ?? "", iv: account.refreshTokenIv ?? "" }, secret);
    const body = new URLSearchParams({
      refresh_token: refreshToken,
      grant_type: "refresh_token",
      client_id: this.env.X_CLIENT_ID
    });
    const response = await this.fetcher("https://api.x.com/2/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${btoa(`${this.env.X_CLIENT_ID}:${this.env.X_CLIENT_SECRET}`)}`
      },
      body
    });
    if (!response.ok) {
      await this.repository.updateXAccount({ ...account, status: "AUTH_ERROR", updatedAtMs: this.clock.nowMs() });
      return null;
    }
    const json: RefreshTokenResponse = await response.json();
    if (json.access_token === undefined) {
      await this.repository.updateXAccount({ ...account, status: "AUTH_ERROR", updatedAtMs: this.clock.nowMs() });
      return null;
    }
    const encryptedAccess = await encryptToken(json.access_token, secret);
    const encryptedRefresh = await encryptToken(json.refresh_token ?? refreshToken, secret);
    await this.repository.updateXAccount({
      ...account,
      status: "ACTIVE",
      accessTokenCiphertext: encryptedAccess.ciphertext,
      accessTokenIv: encryptedAccess.iv,
      refreshTokenCiphertext: encryptedRefresh.ciphertext,
      refreshTokenIv: encryptedRefresh.iv,
      accessTokenExpiresAtMs: this.clock.nowMs() + (json.expires_in ?? 7200) * 1000,
      scopes: json.scope?.split(" ") ?? account.scopes,
      tokenKeyVersion: 1,
      updatedAtMs: this.clock.nowMs()
    });
    return json.access_token;
  }
}
