"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiGetRoom } from "../lib/clientApi";
import type { PublicPlayer, PublicRoomState } from "../types";

/** Poll cadence for durable room/lobby state. Live play uses the realtime channel. */
export const POLL_MS = 1200;

export interface UseColorHideRoom {
  state: PublicRoomState | null;
  /** The caller's own roster entry (derived from yourId), or null. */
  me: PublicPlayer | null;
  fatal: string | null;
  connected: boolean;
  applyState: (incoming: PublicRoomState) => void;
  refetch: () => Promise<void>;
  setPaused: (paused: boolean) => void;
  /** Estimated current server clock (ms epoch), for countdown alignment. */
  serverNow: () => number;
}

/**
 * Polls durable room state (roster, phase, map, result) on an interval and keeps
 * the freshest version. Mirrors the platform's established `useRoom` pattern so it
 * behaves consistently with the other games; high-frequency play (positions) is
 * handled separately by the realtime transport, not this hook.
 */
export function useColorHideRoom(roomId: string): UseColorHideRoom {
  const [state, setState] = useState<PublicRoomState | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [connected, setConnected] = useState(true);

  const pausedRef = useRef(false);
  const terminalRef = useRef(false);
  /** Last server clock sample + the client time we received it, for drift-free countdown. */
  const clockRef = useRef({ serverNow: 0, at: 0 });

  const applyState = useCallback((incoming: PublicRoomState) => {
    clockRef.current = { serverNow: incoming.serverNow, at: Date.now() };
    setState((prev) => {
      if (!prev || incoming.version >= prev.version) return incoming;
      return prev;
    });
  }, []);

  const serverNow = useCallback(() => {
    const c = clockRef.current;
    return c.at ? c.serverNow + (Date.now() - c.at) : Date.now();
  }, []);

  const refetch = useCallback(async () => {
    const res = await apiGetRoom(roomId);
    if (res.ok) {
      setConnected(true);
      setFatal(null);
      applyState(res.data.publicState);
      return;
    }
    if (res.code === "network_error") {
      setConnected(false);
      return;
    }
    if (res.status === 404 || res.code === "not_found") {
      terminalRef.current = true;
      setFatal(res.message);
      return;
    }
    setConnected(false);
    setFatal((prev) => prev ?? res.message);
  }, [roomId, applyState]);

  const setPaused = useCallback((paused: boolean) => {
    pausedRef.current = paused;
  }, []);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      if (!active) return;
      if (!pausedRef.current && !terminalRef.current) await refetch();
      if (active && !terminalRef.current) timer = setTimeout(tick, POLL_MS);
    };

    terminalRef.current = false;
    void tick();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [refetch]);

  const me =
    state && state.yourId
      ? state.players.find((p) => p.id === state.yourId) ?? null
      : null;

  return { state, me, fatal, connected, applyState, refetch, setPaused, serverNow };
}
