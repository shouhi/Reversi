"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiGetRoom } from "../lib/clientApi";
import type { PublicRoomState } from "../types";

/** Poll cadence. The spec targets 1–1.5s for a face-to-face game. */
export const POLL_MS = 1200;

export interface UseRoom {
  state: PublicRoomState | null;
  /** Terminal, non-recoverable problem (room missing / storage down at load). */
  fatal: string | null;
  /** Whether the last network attempt succeeded. */
  connected: boolean;
  /** Apply an authoritative state received from a mutation (join/move). */
  applyState: (incoming: PublicRoomState) => void;
  /** Force an immediate re-sync with the server. */
  refetch: () => Promise<void>;
  /** Pause/resume the background poll (used around a local move). */
  setPaused: (paused: boolean) => void;
}

export function useRoom(roomId: string): UseRoom {
  const [state, setState] = useState<PublicRoomState | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [connected, setConnected] = useState(true);

  const pausedRef = useRef(false);
  const terminalRef = useRef(false);

  const applyState = useCallback((incoming: PublicRoomState) => {
    setState((prev) => {
      // Never move backwards in version — avoids flicker from a late poll.
      if (!prev || incoming.version >= prev.version) return incoming;
      return prev;
    });
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
      // Transient — keep the last known board and show an "offline" hint.
      setConnected(false);
      return;
    }
    if (res.status === 404 || res.code === "not_found") {
      terminalRef.current = true;
      setFatal(res.message);
      return;
    }
    // 503 and the like: surface, but keep trying (storage may recover).
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
      if (!pausedRef.current && !terminalRef.current) {
        await refetch();
      }
      if (active && !terminalRef.current) {
        timer = setTimeout(tick, POLL_MS);
      }
    };

    // Reset terminal flag when the room changes, then fetch immediately.
    terminalRef.current = false;
    void tick();

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [refetch]);

  return { state, fatal, connected, applyState, refetch, setPaused };
}
