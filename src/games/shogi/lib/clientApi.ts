import type { DroppableType } from "./engine";
import type { PublicRoomState } from "../types";

/** Client-side API + token helpers. Safe to import only in client components. */

const TOKEN_HEADER = "x-shogi-token";
const tokenKey = (roomId: string) => `shogi:token:${roomId}`;

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
    /* storage may be unavailable (private mode) — the game still works per-tab */
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

const base = "/api/games/shogi/rooms";

async function request<T>(
  url: string,
  init: RequestInit,
  roomId?: string,
): Promise<ApiResult<T>> {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  if (roomId) {
    const token = getStoredToken(roomId);
    if (token) headers.set(TOKEN_HEADER, token);
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

  if (res.ok) {
    return { ok: true, data: (body ?? {}) as T };
  }

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

export interface CreateRoomResponse {
  roomId: string;
  token: string;
  publicState: PublicRoomState;
}

export function apiCreateRoom(): Promise<ApiResult<CreateRoomResponse>> {
  return request<CreateRoomResponse>(base, { method: "POST" });
}

export function apiGetRoom(
  roomId: string,
): Promise<ApiResult<{ publicState: PublicRoomState }>> {
  return request<{ publicState: PublicRoomState }>(
    `${base}/${roomId}`,
    { method: "GET" },
    roomId,
  );
}

export function apiJoinRoom(
  roomId: string,
): Promise<ApiResult<{ token: string | null; publicState: PublicRoomState }>> {
  return request<{ token: string | null; publicState: PublicRoomState }>(
    `${base}/${roomId}/join`,
    { method: "POST" },
    roomId,
  );
}

/** A move payload: a board move `{from,to,promote}` or a drop `{drop,to}`. */
export interface MovePayload {
  from?: { row: number; col: number };
  to: { row: number; col: number };
  promote?: boolean;
  drop?: DroppableType;
}

export function apiMove(
  roomId: string,
  payload: MovePayload,
): Promise<ApiResult<{ publicState: PublicRoomState }>> {
  return request<{ publicState: PublicRoomState }>(
    `${base}/${roomId}/move`,
    { method: "POST", body: JSON.stringify(payload) },
    roomId,
  );
}
