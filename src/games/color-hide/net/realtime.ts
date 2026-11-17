import type { MapId, Phase, Pose, Role, Vec3 } from "../types";
import type { AnimState, NetPlayer, ServerMsg } from "./protocol";
import { getMap } from "../lib/maps";
import type { Aabb } from "../lib/geometry";
import {
  evaluateVisibility,
  canCatch,
  type SeekerState,
} from "../lib/detection";
import { validateMove } from "../lib/movement";
import { hidersCanMove, seekerCanSeek } from "../lib/phases";
import {
  CROUCH_SPEED_MULT,
  NET_TICK_HZ,
  PLAYER_RADIUS,
  RUN_SPEED,
  WALK_SPEED,
} from "../lib/constants";

/**
 * COLOR HIDE — authoritative realtime netcode (transport-agnostic).
 *
 * Holds the ephemeral live state of a round (positions / look / anim) that is
 * deliberately NOT persisted in the KV store. It is driven by callbacks so the
 * same class runs behind the local WS host today and a PartyKit host later, and
 * so it unit-tests with zero sockets.
 *
 * Two security guarantees live here and are covered by tests:
 *   1. SNAPSHOT FILTERING — a seeker only ever receives the positions of hiders
 *      currently visible to them (range + FOV + line of sight). Hidden hiders are
 *      never serialized to the seeker. Hiders see teammates + the seeker.
 *   2. SERVER-VALIDATED CATCH — a "catch" only succeeds when the server's own
 *      detection math agrees; a client claim alone never removes a hider.
 *
 * Durable facts (roster, roles, phase, map, caught) come from a {@link RoomMetaProvider}
 * (the KV store, read over HTTP by the host). The netcode caches that meta and
 * refreshes it periodically; it writes catches back through the provider.
 */

/** The slice of durable room state the netcode needs. */
export interface RoomMeta {
  phase: Phase;
  phaseStartedAt: number;
  mapId: MapId;
  seekerId: string | null;
  players: Array<{ id: string; role: Role | null; caught: boolean }>;
}

export interface RoomMetaProvider {
  /** Latest durable meta for a room, or null if it no longer exists. */
  getMeta(roomId: string): Promise<RoomMeta | null>;
  /** Persist that `hiderId` was caught (idempotent). */
  persistCatch(roomId: string, hiderId: string): Promise<void>;
}

/** How the netcode emits messages + closes connections (host-provided). */
export interface Outbound {
  send(connId: string, msg: ServerMsg): void;
  close(connId: string): void;
}

interface LivePlayer {
  connId: string;
  playerId: string;
  pos: Vec3;
  yaw: number;
  pitch: number;
  anim: AnimState;
  pose: Pose;
  lastInputAt: number;
  seq: number;
}

interface RoomRuntime {
  meta: RoomMeta | null;
  metaFetchedAt: number;
  /** playerId → live state. */
  live: Map<string, LivePlayer>;
  /** Consecutive meta-fetch failures, for exponential backoff. */
  metaFailures: number;
}

/**
 * Default: refresh a room's durable meta from the app at most this often. Chosen
 * at 2.5s to cut Vercel GET load vs the old 1s while keeping gameplay-relevant
 * staleness small (phase progression is driven by the faster client polling + the
 * app's lazy tick, not by this). Overridable per host via the constructor.
 */
const DEFAULT_META_REFRESH_MS = 2_500;
/** Max backoff multiplier applied to the refresh interval after fetch failures. */
const MAX_META_BACKOFF = 8;

/** A fully-posed player, the input to the pure snapshot filter. */
export interface PosedPlayer {
  id: string;
  pos: Vec3;
  yaw: number;
  pitch: number;
  anim: AnimState;
  pose: Pose;
  role: Role | null;
  caught: boolean;
}

/**
 * The SECURITY-CRITICAL, pure snapshot filter. Given a recipient and everyone's
 * authoritative pose, returns only the players the recipient is allowed to see:
 *
 *   - themselves, always;
 *   - the seeker, always (the seeker is not hiding);
 *   - caught hiders, always (revealed to everyone);
 *   - uncaught hiders: visible to a fellow hider (teammates); visible to the
 *     SEEKER only when range + FOV + line of sight all pass.
 *
 * Because this is pure, tests prove a seeker never receives a hidden hider's
 * position — the exact guarantee the spec demands.
 */
export function buildSnapshot(
  recipient: PosedPlayer,
  players: PosedPlayer[],
  obstacles: Aabb[],
): NetPlayer[] {
  const seekerView: SeekerState | null =
    recipient.role === "seeker"
      ? { pos: recipient.pos, yaw: recipient.yaw, pitch: recipient.pitch }
      : null;

  const out: NetPlayer[] = [];
  for (const p of players) {
    let include = false;
    if (p.id === recipient.id) include = true;
    else if (p.role === "seeker") include = true;
    else if (p.role === "hider") {
      if (p.caught) include = true;
      else if (recipient.role === "hider") include = true;
      else if (seekerView) {
        include = evaluateVisibility(seekerView, { pos: p.pos }, obstacles).visible;
      }
    }
    if (!include) continue;
    out.push({
      id: p.id,
      x: p.pos.x,
      z: p.pos.z,
      yaw: p.yaw,
      pitch: p.pitch,
      anim: p.anim,
      pose: p.pose,
      role: p.role,
    });
  }
  return out;
}

export class ColorHideServer {
  private rooms = new Map<string, RoomRuntime>();
  private conns = new Map<string, { roomId: string; playerId: string }>();
  private readonly metaRefreshMs: number;

  constructor(
    private readonly provider: RoomMetaProvider,
    private readonly out: Outbound,
    options?: { metaRefreshMs?: number },
  ) {
    this.metaRefreshMs =
      options?.metaRefreshMs && options.metaRefreshMs > 0
        ? options.metaRefreshMs
        : DEFAULT_META_REFRESH_MS;
  }

  // -- connection lifecycle -------------------------------------------------

  /**
   * Attach an (already token-authenticated by the host) connection to a room.
   * Rejects if the room/player is unknown. Spawns the player at a map spawn.
   */
  async handleHello(
    connId: string,
    roomId: string,
    playerId: string,
    now: number,
  ): Promise<void> {
    const room = this.ensureRoom(roomId);
    await this.refreshMeta(roomId, now, true);
    const meta = room.meta;
    const member = meta?.players.find((p) => p.id === playerId);
    if (!meta || !member) {
      this.out.send(connId, { type: "error", message: "not in this room" });
      this.out.close(connId);
      return;
    }

    this.conns.set(connId, { roomId, playerId });
    const spawn = this.spawnFor(meta, playerId);
    room.live.set(playerId, {
      connId,
      playerId,
      pos: spawn,
      yaw: 0,
      pitch: 0,
      anim: "idle",
      pose: "stand",
      lastInputAt: now,
      seq: 0,
    });
    this.out.send(connId, {
      type: "welcome",
      playerId,
      role: member.role,
      tickHz: NET_TICK_HZ,
    });
  }

  handleDisconnect(connId: string): void {
    const c = this.conns.get(connId);
    if (!c) return;
    this.conns.delete(connId);
    this.rooms.get(c.roomId)?.live.delete(c.playerId);
  }

  // -- input ----------------------------------------------------------------

  handleInput(
    connId: string,
    msg: {
      seq: number;
      x: number;
      z: number;
      yaw: number;
      pitch: number;
      anim: AnimState;
      pose: Pose;
      running: boolean;
    },
    now: number,
  ): void {
    const c = this.conns.get(connId);
    if (!c) return;
    const room = this.rooms.get(c.roomId);
    const me = room?.live.get(c.playerId);
    if (!room || !me || !room.meta) return;
    if (msg.seq <= me.seq) return; // stale / out-of-order input
    me.seq = msg.seq;

    // Look + anim + pose are always accepted (cosmetic / owner-controlled).
    me.yaw = msg.yaw;
    me.pitch = msg.pitch;
    me.anim = msg.anim;
    me.pose = msg.pose;

    const role = this.roleOf(room.meta, c.playerId);
    const member = room.meta.players.find((p) => p.id === c.playerId);
    const canMove =
      role === "hider"
        ? hidersCanMove(room.meta.phase) && !member?.caught
        : role === "seeker"
          ? seekerCanSeek(room.meta.phase)
          : false;

    if (!canMove) {
      me.lastInputAt = now;
      return; // frozen: keep the authoritative position fixed
    }

    const dtMs = Math.min(Math.max(now - me.lastInputAt, 0), 500);
    const map = getMap(room.meta.mapId);
    const maxSpeed =
      me.pose === "stand"
        ? msg.running
          ? RUN_SPEED
          : WALK_SPEED
        : WALK_SPEED * CROUCH_SPEED_MULT;

    me.pos = validateMove(
      me.pos,
      { x: msg.x, y: 0, z: msg.z },
      dtMs,
      map.obstacles,
      map.bounds,
      { maxSpeed, radius: PLAYER_RADIUS },
    );
    me.lastInputAt = now;
  }

  // -- catch ----------------------------------------------------------------

  /**
   * Validate + apply a seeker's catch attempt. Returns true if a hider was
   * caught. The server's own detection decides — a client claim is never trusted.
   */
  async handleCatch(connId: string, targetId: string, now: number): Promise<boolean> {
    const c = this.conns.get(connId);
    if (!c) return false;
    const room = this.rooms.get(c.roomId);
    if (!room || !room.meta) return false;
    await this.refreshMeta(c.roomId, now);
    const meta = room.meta;
    if (!meta) return false;

    if (this.roleOf(meta, c.playerId) !== "seeker") return false;
    if (!seekerCanSeek(meta.phase)) return false;

    const seekerLive = room.live.get(c.playerId);
    const targetLive = room.live.get(targetId);
    const targetMember = meta.players.find((p) => p.id === targetId);
    if (!seekerLive || !targetLive || !targetMember) return false;
    if (targetMember.role !== "hider" || targetMember.caught) return false;

    const seeker: SeekerState = {
      pos: seekerLive.pos,
      yaw: seekerLive.yaw,
      pitch: seekerLive.pitch,
    };
    const map = getMap(meta.mapId);
    if (!canCatch(seeker, { pos: targetLive.pos }, map.obstacles)) return false;

    // Persist + reflect locally, then tell the room.
    await this.provider.persistCatch(c.roomId, targetId);
    targetMember.caught = true;
    this.broadcast(c.roomId, { type: "caught", hiderId: targetId, byId: c.playerId });
    return true;
  }

  handlePing(connId: string, t: number): void {
    this.out.send(connId, { type: "pong", t });
  }

  // -- tick (per-recipient filtered snapshots) ------------------------------

  /** Emits a filtered snapshot to every connected player in every room. */
  tick(now: number): void {
    for (const [roomId, room] of this.rooms) {
      if (!room.meta || room.live.size === 0) continue;
      for (const recipient of room.live.values()) {
        this.out.send(recipient.connId, {
          type: "snapshot",
          t: now,
          players: this.snapshotFor(roomId, recipient),
        });
      }
    }
  }

  /** Builds the filtered view for one recipient by delegating to {@link buildSnapshot}. */
  private snapshotFor(roomId: string, recipient: LivePlayer): NetPlayer[] {
    const room = this.rooms.get(roomId);
    if (!room || !room.meta) return [];
    const meta = room.meta;
    const map = getMap(meta.mapId);

    const posed: PosedPlayer[] = [];
    let recipientPosed: PosedPlayer | null = null;
    for (const p of room.live.values()) {
      const member = meta.players.find((m) => m.id === p.playerId);
      const entry: PosedPlayer = {
        id: p.playerId,
        pos: p.pos,
        yaw: p.yaw,
        pitch: p.pitch,
        anim: p.anim,
        pose: p.pose,
        role: member?.role ?? null,
        caught: member?.caught ?? false,
      };
      posed.push(entry);
      if (p.playerId === recipient.playerId) recipientPosed = entry;
    }
    if (!recipientPosed) return [];
    return buildSnapshot(recipientPosed, posed, map.obstacles);
  }

  // -- helpers --------------------------------------------------------------

  private ensureRoom(roomId: string): RoomRuntime {
    let room = this.rooms.get(roomId);
    if (!room) {
      room = { meta: null, metaFetchedAt: 0, live: new Map(), metaFailures: 0 };
      this.rooms.set(roomId, room);
    }
    return room;
  }

  /**
   * Refreshes a room's cached meta if stale (or forced). Resilient to app
   * outages: on a failed fetch it KEEPS the last-known meta (so a transient
   * Vercel hiccup never stalls a live round) and backs off the retry interval
   * exponentially to reduce load during an outage.
   */
  async refreshMeta(roomId: string, now: number, force = false): Promise<void> {
    const room = this.ensureRoom(roomId);
    const interval =
      this.metaRefreshMs * Math.min(2 ** room.metaFailures, MAX_META_BACKOFF);
    if (!force && now - room.metaFetchedAt < interval) return;
    room.metaFetchedAt = now;
    const meta = await this.provider.getMeta(roomId);
    if (meta) {
      room.meta = meta;
      room.metaFailures = 0;
    } else {
      // Keep the last-known meta; just record the failure for backoff.
      room.metaFailures += 1;
    }
  }

  private roleOf(meta: RoomMeta, playerId: string): Role | null {
    return meta.players.find((p) => p.id === playerId)?.role ?? null;
  }

  private spawnFor(meta: RoomMeta, playerId: string): Vec3 {
    const map = getMap(meta.mapId);
    if (playerId === meta.seekerId) return { ...map.seekerSpawn };
    // Deterministic hider spawn: index among hiders (sorted by id).
    const hiderIds = meta.players
      .filter((p) => p.role === "hider")
      .map((p) => p.id)
      .sort();
    const idx = Math.max(0, hiderIds.indexOf(playerId));
    return { ...map.spawns[idx % map.spawns.length] };
  }

  private broadcast(roomId: string, msg: ServerMsg): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    for (const p of room.live.values()) this.out.send(p.connId, msg);
  }

  /** Test/host hook: the current live player count across all rooms. */
  get liveCount(): number {
    let n = 0;
    for (const r of this.rooms.values()) n += r.live.size;
    return n;
  }

  /**
   * Test-only seam (matches this repo's `__reset*` convention): force a connected
   * player's authoritative pose. Used by unit tests to set up precise geometry
   * without driving many inputs; not called in production paths.
   */
  __setPose(
    connId: string,
    pose: { pos: Vec3; yaw?: number; pitch?: number },
  ): void {
    const c = this.conns.get(connId);
    const live = c && this.rooms.get(c.roomId)?.live.get(c.playerId);
    if (!live) return;
    live.pos = pose.pos;
    if (pose.yaw !== undefined) live.yaw = pose.yaw;
    if (pose.pitch !== undefined) live.pitch = pose.pitch;
  }
}
