/** Matrix authentication: login, token validation, session resolution. */

import * as fs from "node:fs";
import * as path from "node:path";
import { MatrixClient } from "matrix-bot-sdk";
import { isRecord } from "../../../core/helpers.ts";
import type { AgentContext } from "../../../core/types.ts";
import type { MatrixAuthSession, MatrixPlatformConfig } from "./types.ts";

const STORAGE_DIR = path.join("data", "matrix");

export function canAuthenticateMatrix(config: MatrixPlatformConfig): boolean {
  return Boolean(
    config.homeserverUrl &&
      (config.accessToken || (config.username && config.password)),
  );
}

export async function resolveMatrixSession(
  context: AgentContext,
  config: MatrixPlatformConfig,
): Promise<MatrixAuthSession> {
  if (config.accessToken) {
    if (
      config.homeserverUrl &&
      await isAccessTokenValid(config.homeserverUrl, config.accessToken)
    ) {
      return { accessToken: config.accessToken, managedDevice: false };
    }

    if (!config.username || !config.password) {
      throw new Error(
        "MATRIX_ACCESS_TOKEN is no longer valid. Generate a new token, or set MATRIX_USERNAME and MATRIX_PASSWORD so Missy can log in on its own.",
      );
    }
    context.logger.warn(
      "Configured MATRIX_ACCESS_TOKEN is invalid; falling back to username/password login.",
    );
  }

  if (!config.homeserverUrl || !config.username || !config.password) {
    throw new Error(
      "Matrix managed device login requires MATRIX_HOMESERVER_URL, MATRIX_USERNAME, and MATRIX_PASSWORD.",
    );
  }

  const matrixStore = context.keystore.namespace("matrix");
  const stored = matrixStore.get("botSdkSession");

  // Try the stored access token first — if it's still valid we can skip login entirely.
  if (isRecord(stored) && typeof stored.accessToken === "string") {
    const valid = await isAccessTokenValid(
      config.homeserverUrl,
      stored.accessToken,
    );
    if (valid) {
      return { accessToken: stored.accessToken, managedDevice: true };
    }
    context.logger.warn(
      "Stored Matrix access token is no longer valid; re-authenticating.",
    );
  }

  const reuseDeviceId = config.deviceId ??
    (isRecord(stored) && typeof stored.deviceId === "string"
      ? stored.deviceId
      : undefined);

  if (!reuseDeviceId) {
    fs.rmSync(path.join(STORAGE_DIR, "crypto"), {
      recursive: true,
      force: true,
    });
  }

  const { accessToken, deviceId, userId } = await managedPasswordLogin(
    config.homeserverUrl,
    config.username,
    config.password,
    config.deviceDisplayName,
    reuseDeviceId,
  );

  await matrixStore.set("botSdkSession", {
    accessToken,
    deviceId,
    loggedInAt: new Date().toISOString(),
    userId,
  });

  context.logger.info(
    reuseDeviceId
      ? "Re-authenticated Matrix managed device (deviceId reused)"
      : "Created Matrix managed device",
    { deviceId, userId },
  );

  return { accessToken, managedDevice: true };
}

export async function managedPasswordLogin(
  homeserverUrl: string,
  username: string,
  password: string,
  deviceName?: string,
  deviceId?: string,
): Promise<{ accessToken: string; deviceId: string; userId: string }> {
  const body: Record<string, unknown> = {
    type: "m.login.password",
    identifier: {
      type: "m.id.user",
      user: username,
    },
    password,
    initial_device_display_name: deviceName,
  };

  if (deviceId) {
    body.device_id = deviceId;
  }

  const url = `${homeserverUrl.replace(/\/+$/, "")}/_matrix/client/v3/login`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Matrix login failed (${response.status}): ${text || response.statusText}`,
    );
  }

  const payload = await response.json();
  const accessToken =
    typeof payload === "object" && payload !== null &&
    typeof (payload as Record<string, unknown>).access_token === "string"
      ? (payload as Record<string, unknown>).access_token as string
      : undefined;
  if (!accessToken) {
    throw new Error("Matrix login response did not include an access_token.");
  }

  // Verify the new token and discover the effective device / user IDs.
  const probe = new MatrixClient(homeserverUrl, accessToken);
  const whoami = await probe.getWhoAmI();
  probe.stop();

  return {
    accessToken,
    deviceId: whoami.device_id ?? deviceId ?? "unknown",
    userId: whoami.user_id ?? "unknown",
  };
}

export async function isAccessTokenValid(
  homeserverUrl: string,
  accessToken: string,
): Promise<boolean> {
  try {
    const probe = new MatrixClient(homeserverUrl, accessToken);
    await probe.getWhoAmI();
    return true;
  } catch {
    return false;
  }
}
