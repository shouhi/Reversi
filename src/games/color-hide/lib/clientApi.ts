import type { PublicRoomState, MapId } from "../types";

/** Client-side API + token helpers. Safe to import only in client components. */

const tokenKey = (roomId: string) => `color-hide:token:${roomId}`;
const pidKey = (roomId: string) => `color-hide:pid:${roomId}`;
const nickKey = "color-hide:nickname";

export function getStoredToken(roomId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(tokenKey(roomId));
  } catch {
    return null;
  }
}

export function storeToken(roomId: string, token: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(tokenKey(roomId), token);
  } catch {
    /* storage may be unavailable (private mode) — play still works per-tab */
  }
}

export function getStoredPlayerId(roomId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(pidKey(roomId));
  } catch {
    return null;
  }
}

export function storePlayerId(roomId: string, playerId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(pidKey(roomId), playerId);
  } catch {
    /* ignore */
  }
}

/** A remembered nickname so friends don't retype it per room. */
export function getStoredNickname(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(nickKey) ?? "";
  } catch {
    return "";
  }
}

export function storeNickname(nickname: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(nickKey, nickname);
  } catch {
    /* ignore */
  }
}

export type ApiResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      status: number;
      code: string;
      message: string;
      publicState: PublicRoomState | null;
    };

async function request<T>(
  url: string,
  init: RequestInit,
  roomId?: string,
): Promise<ApiResult<T>> {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  if (roomId) {
    const token = getStoredToken(roomId);
    if (token) headers.set("x-color-hide-token", token);
  }

  let res: Response;
  try {
    res = await fetch(url, { ...init, headers, cache: "no-store" });
  } catch {
    return {
      ok: false,
      status: 0,
      code: "network_error",
      message: "Network error — check your connection.",
      publicState: null,
    };
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (res.ok) return { ok: true, data: (body ?? {}) as T };

  const payload = body as
    | { error?: { code?: string; message?: string }; publicState?: PublicRoomState | null }
    | null;
  return {
    ok: false,
    status: res.status,
    code: payload?.error?.code ?? "unknown",
    message: payload?.error?.message ?? "Something went wrong.",
    publicState: payload?.publicState ?? null,
  };
}

const base = "/api/games/color-hide/rooms";

export interface CreateRoomResponse {
  roomId: string;
  token: string;
  playerId: string;
  publicState: PublicRoomState;
}

export function apiCreateRoom(nickname: string): Promise<ApiResult<CreateRoomResponse>> {
  return request<CreateRoomResponse>(base, {
    method: "POST",
    body: JSON.stringify({ nickname }),
  });
}

export function apiGetRoom(
  roomId: string,
): Promise<ApiResult<{ publicState: PublicRoomState }>> {
  return request(`${base}/${roomId}`, { method: "GET" }, roomId);
}

export interface JoinRoomResponse {
  token: string | null;
  playerId: string;
  publicState: PublicRoomState;
}

export function apiJoinRoom(
  roomId: string,
  nickname: string,
): Promise<ApiResult<JoinRoomResponse>> {
  return request<JoinRoomResponse>(
    `${base}/${roomId}/join`,
    { method: "POST", body: JSON.stringify({ nickname }) },
    roomId,
  );
}

type ActionBody =
  | { action: "ready"; ready: boolean }
  | { action: "nickname"; nickname: string }
  | { action: "map"; mapId: MapId }
  | { action: "start" }
  | { action: "lobby" };

function action(
  roomId: string,
  body: ActionBody,
): Promise<ApiResult<{ publicState: PublicRoomState }>> {
  return request(
    `${base}/${roomId}/action`,
    { method: "POST", body: JSON.stringify(body) },
    roomId,
  );
}

export const apiSetReady = (roomId: string, ready: boolean) =>
  action(roomId, { action: "ready", ready });
export const apiSetNickname = (roomId: string, nickname: string) =>
  action(roomId, { action: "nickname", nickname });
export const apiSelectMap = (roomId: string, mapId: MapId) =>
  action(roomId, { action: "map", mapId });
export const apiStartGame = (roomId: string) =>
  action(roomId, { action: "start" });
export const apiReturnToLobby = (roomId: string) =>
  action(roomId, { action: "lobby" });

export function apiGetPaints(
  roomId: string,
): Promise<ApiResult<{ paints: Record<string, string> }>> {
  return request(`${base}/${roomId}/paint`, { method: "GET" }, roomId);
}

export function apiCommitPaint(
  roomId: string,
  dataUrl: string,
): Promise<ApiResult<{ bytes: number }>> {
  return request(
    `${base}/${roomId}/paint`,
    { method: "POST", body: JSON.stringify({ paint: dataUrl }) },
    roomId,
  );
}
