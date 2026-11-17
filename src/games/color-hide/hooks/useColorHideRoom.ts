"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiGetRoom } from "../lib/clientApi";
import type { Phase, PublicPlayer, PublicRoomState } from "../types";

/**
 * Poll cadence for durable room/lobby state. It is PHASE-AWARE to cut Vercel
 * Function load (the dominant cost): the lobby needs snappy roster/ready updates,
 * but during the long active phases the countdown is derived from the server clock
 * and catches arrive over the realtime channel, so the HTTP room only needs an
 * occasional refresh. This roughly halves per-player GET volume across a round.
 */
export const LOBBY_POLL_MS = 1500;
export const ACTIVE_POLL_MS = 3000;

function pollInterval(phase: Phase | undefined): number {
  return phase === "painting" || phase === "hiding" || phase === "seeking"
    ? ACTIVE_POLL_MS
    : LOBBY_POLL_MS;
}

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
  /** Current phase, read by the poll loop to pick its cadence (no re-render). */
  const phaseRef = useRef<Phase>("lobby");
  /** Last server clock sample + the client time we received it, for drift-free countdown. */
  const clockRef = useRef({ serverNow: 0, at: 0 });

  const applyState = useCallback((incoming: PublicRoomState) => {
    clockRef.current = { serverNow: incoming.serverNow, at: Date.now() };
    phaseRef.current = incoming.phase;
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
      if (active && !terminalRef.current) {
        timer = setTimeout(tick, pollInterval(phaseRef.current));
      }
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
