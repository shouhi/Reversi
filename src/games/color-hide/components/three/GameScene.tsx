"use client";

import * as THREE from "three";
import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import type { MapId, Pose, Role } from "../../types";
import type { NetPlayer, ServerMsg } from "../../net/protocol";
import type { RealtimeTransport } from "../../net/transport";
import { getMap } from "../../lib/maps";
import { resolveMove } from "../../lib/movement";
import { segmentIntersectsAabb } from "../../lib/geometry";
import { detectQuality, dprFor, shadowsFor, type Quality } from "../../lib/quality";
import { clampLookDelta } from "../../lib/touchInput";
import { damp, dampAngle, shouldSnap } from "../../lib/animation";
import { prefersReducedMotion } from "../../lib/motion";
import { sharedAudio } from "../../lib/audio";
import { moveSpeedFor } from "../../lib/balance";
import { planInputSend, type InputSample } from "../../lib/inputSend";
import AnimatedCharacter, { type CharacterAnimDriver } from "./AnimatedCharacter";
import MapScene from "./MapScene";
import { textureForPaint } from "./textures";
import MobileControls from "../MobileControls";

/** Mutable, per-frame input written by keyboard + touch controls. */
export interface GameInput {
  move: { x: number; y: number };
  look: { dx: number; dy: number };
  running: boolean;
  poseIndex: number;
  catchReq: boolean;
}

export const POSES: Pose[] = ["stand", "crouch", "lie", "ball"];

export interface RosterEntry {
  id: string;
  nickname: string;
  role: Role | null;
}

export interface GameSceneProps {
  mapId: MapId;
  myId: string;
  myRole: Role;
  /** Whether this player may move right now (phase + not caught). */
  canMove: boolean;
  /** Whether the seeker may catch right now (seeking phase). */
  canCatch: boolean;
  /** This player has been caught and is now a spectator (no movement/catch). */
  spectating?: boolean;
  /**
   * Phase 10: the in-world paint overlay is open. Movement + look input are frozen
   * and held keys are released so a key held at open-time can't cause drift, and so
   * drawing never fights camera/movement control.
   */
  inputLocked?: boolean;
  transport: RealtimeTransport;
  roster: RosterEntry[];
  paints: Record<string, string>;
  caughtIds: string[];
}

const EYE = 1.5;
const CAM_DIST = 4.4;
const LOOK_SENS = 0.005;

export default function GameScene(props: GameSceneProps) {
  const input = useRef<GameInput>({
    move: { x: 0, y: 0 },
    look: { dx: 0, dy: 0 },
    running: false,
    poseIndex: 0,
    catchReq: false,
  });
  const [touch] = useState(
    () => typeof window !== "undefined" && "ontouchstart" in window,
  );
  const [quality] = useState(detectQuality);
  const [poseLabel, setPoseLabel] = useState<Pose>("stand");
  // Spectator camera: follow the (public) seeker, or free-look from where caught.
  const [followSeeker, setFollowSeeker] = useState(true);

  // Live snapshot (visibility-filtered by the server) + caught set, updated from
  // the realtime channel. Kept in refs so the frame loop reads without re-render.
  const snapshot = useRef<Map<string, NetPlayer>>(new Map());
  const [caught, setCaught] = useState<Set<string>>(new Set(props.caughtIds));
  const reducedMotion = useMemo(prefersReducedMotion, []);
  // Brief, non-blocking screen flash on a catch that involves me.
  const [flash, setFlash] = useState<null | "success" | "caught">(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    setCaught((prev) => new Set([...prev, ...props.caughtIds]));
  }, [props.caughtIds]);

  useEffect(() => {
    const { myId } = props;
    props.transport.onMessage((msg: ServerMsg) => {
      if (msg.type === "snapshot") {
        const map = new Map<string, NetPlayer>();
        for (const p of msg.players) map.set(p.id, p);
        snapshot.current = map;
      } else if (msg.type === "caught") {
        setCaught((prev) => new Set(prev).add(msg.hiderId));
        // Server-authoritative catch: only NOW do we play a catch cue. The catcher
        // hears success, the caught hider hears the caught cue; others stay quiet.
        if (msg.byId === myId) {
          sharedAudio().play("catchSuccess");
          triggerFlash("success");
        } else if (msg.hiderId === myId) {
          sharedAudio().play("caught");
          triggerFlash("caught");
        }
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.transport, props.myId]);

  const triggerFlash = (kind: "success" | "caught") => {
    if (reducedMotion) return;
    setFlash(kind);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 420);
  };
  useEffect(() => () => flashTimer.current && clearTimeout(flashTimer.current), []);

  // Pressed keys live in a ref so the paint-mode lock (below) can release them all
  // when the overlay opens — otherwise a key held at open-time would stay "down".
  const keysRef = useRef(new Set<string>());
  const lockedRef = useRef(false);

  const recomputeKeys = () => {
    const keys = keysRef.current;
    const i = input.current;
    i.move.x = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);
    i.move.y = (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0);
    i.running = keys.has("ShiftLeft") || keys.has("ShiftRight");
  };

  // When the paint overlay opens, drop every held key + zero movement/look so the
  // character can't drift and drawing never conflicts with movement/camera input.
  useEffect(() => {
    lockedRef.current = !!props.inputLocked;
    if (props.inputLocked) {
      keysRef.current.clear();
      input.current.move = { x: 0, y: 0 };
      input.current.look = { dx: 0, dy: 0 };
      input.current.running = false;
    }
  }, [props.inputLocked]);

  // Keyboard input.
  useEffect(() => {
    const keys = keysRef.current;
    const cyclePose = () => {
      input.current.poseIndex = (input.current.poseIndex + 1) % POSES.length;
      setPoseLabel(POSES[input.current.poseIndex]);
    };
    const down = (e: KeyboardEvent) => {
      if (e.repeat || lockedRef.current) return; // paint mode: ignore gameplay keys
      if (e.code === "KeyE") cyclePose();
      else if (e.code === "KeyC") {
        input.current.poseIndex = input.current.poseIndex === 1 ? 0 : 1;
        setPoseLabel(POSES[input.current.poseIndex]);
      } else if (e.code === "Space") {
        input.current.catchReq = true;
      } else {
        keys.add(e.code);
        recomputeKeys();
      }
    };
    const up = (e: KeyboardEvent) => {
      keys.delete(e.code);
      recomputeKeys();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const cyclePoseBtn = () => {
    input.current.poseIndex = (input.current.poseIndex + 1) % POSES.length;
    setPoseLabel(POSES[input.current.poseIndex]);
  };
  const crouchBtn = () => {
    input.current.poseIndex = input.current.poseIndex === 1 ? 0 : 1;
    setPoseLabel(POSES[input.current.poseIndex]);
  };

  // Pointer-drag look (desktop + touch). Tracks ONE pointer so a second finger on
  // the virtual stick / buttons (which stopPropagation) never rotates the camera;
  // per-event deltas are clamped so a big jump can't whip the view.
  const lookPointer = useRef<number | null>(null);
  const lastPtr = useRef({ x: 0, y: 0 });
  const MAX_LOOK_STEP = 80;
  const onPointerDown = (e: React.PointerEvent) => {
    if (lockedRef.current || lookPointer.current !== null) return;
    lookPointer.current = e.pointerId;
    lastPtr.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (lockedRef.current || e.pointerId !== lookPointer.current) return;
    input.current.look.dx += clampLookDelta(e.clientX - lastPtr.current.x, MAX_LOOK_STEP);
    input.current.look.dy += clampLookDelta(e.clientY - lastPtr.current.y, MAX_LOOK_STEP);
    lastPtr.current = { x: e.clientX, y: e.clientY };
  };
  const endDrag = (e: React.PointerEvent) => {
    if (e.pointerId === lookPointer.current) lookPointer.current = null;
  };

  return (
    <div
      className="relative h-[72vh] w-full overflow-hidden rounded-xl border border-line bg-black"
      style={{ touchAction: "none" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
      onPointerCancel={endDrag}
    >
      <Canvas
        shadows={shadowsFor(quality)}
        camera={{ fov: 60, near: 0.1, far: 120 }}
        dpr={dprFor(quality)}
      >
        <SceneContents {...props} input={input} snapshot={snapshot} caught={caught} quality={quality} reducedMotion={reducedMotion} followSeeker={followSeeker} />
      </Canvas>

      {/* Spectator badge + camera toggle (only for a caught player). */}
      {props.spectating && (
        <div className="absolute left-3 top-3 z-20 flex items-center gap-2">
          <span className="rounded-md bg-black/60 px-2 py-1 text-xs font-semibold text-amber-200 ring-1 ring-amber-400/40">
            👻 観戦中
          </span>
          <button
            type="button"
            onClick={() => setFollowSeeker((v) => !v)}
            className="rounded-md bg-black/50 px-2 py-1 text-xs text-white ring-1 ring-white/20"
          >
            {followSeeker ? "🎥 鬼を追う" : "🔄 自由視点"}
          </button>
        </div>
      )}

      {/* Brief catch flash (skipped under reduced-motion). Non-blocking. */}
      {flash && (
        <div
          className="ch-flash pointer-events-none absolute inset-0 z-20"
          style={{
            background:
              flash === "success"
                ? "radial-gradient(circle, rgba(16,185,129,0.0) 55%, rgba(16,185,129,0.35) 100%)"
                : "radial-gradient(circle, rgba(239,68,68,0.0) 45%, rgba(239,68,68,0.45) 100%)",
          }}
        />
      )}

      {/* Crosshair for the seeker */}
      {props.myRole === "seeker" && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-white/70">
          ✛
        </div>
      )}

      {/* Desktop controls hint */}
      {!touch && (
        <div className="pointer-events-none absolute bottom-3 left-3 rounded bg-black/40 px-2 py-1 text-[11px] text-white/80">
          WASD移動 / ドラッグで視点 / Shift走る / C しゃがむ / E ポーズ
          {props.myRole === "seeker" ? " / Space 捕まえる" : ` (${poseLabel})`}
        </div>
      )}

      {/* Desktop seeker catch button */}
      {!touch && props.myRole === "seeker" && (
        <button
          type="button"
          onClick={() => {
            input.current.catchReq = true;
          }}
          disabled={!props.canCatch}
          className="absolute bottom-4 right-4 rounded-lg bg-amber-500 px-4 py-2 font-bold text-black disabled:opacity-40"
        >
          捕まえる (Space)
        </button>
      )}

      {touch && (
        <MobileControls
          input={input}
          isSeeker={props.myRole === "seeker"}
          onPoseCycle={cyclePoseBtn}
          onCrouch={crouchBtn}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// In-canvas simulation
// ---------------------------------------------------------------------------

interface ContentsProps extends GameSceneProps {
  input: React.MutableRefObject<GameInput>;
  snapshot: React.MutableRefObject<Map<string, NetPlayer>>;
  caught: Set<string>;
  quality: Quality;
  reducedMotion: boolean;
  followSeeker: boolean;
}

function SceneContents({
  mapId,
  myId,
  myRole,
  canMove,
  canCatch,
  spectating,
  inputLocked,
  transport,
  roster,
  paints,
  input,
  snapshot,
  caught,
  quality,
  reducedMotion,
  followSeeker,
}: ContentsProps) {
  const map = useMemo(() => getMap(mapId), [mapId]);
  const myTexture = useMemo(() => textureForPaint(paints[myId]), [paints, myId]);
  const { camera } = useThree();

  const localGroup = useRef<THREE.Group>(null);
  const poseGroup = useRef<THREE.Group>(null);
  const localAnim = useRef<CharacterAnimDriver | null>({ anim: "idle" });
  const pos = useRef(spawnFor(mapId, myId, myRole, roster));
  const camYaw = useRef(0);
  const camPitch = useRef(0.25);
  const seq = useRef(0);
  const lastSentAt = useRef(0);
  const prevSent = useRef<InputSample | null>(null);
  const lastStatus = useRef<string>("connecting");

  // Reusable temporaries (avoid per-frame allocation).
  const tmpTarget = useMemo(() => new THREE.Vector3(), []);
  const tmpCam = useMemo(() => new THREE.Vector3(), []);
  const fwd = useMemo(() => new THREE.Vector3(), []);
  const right = useMemo(() => new THREE.Vector3(), []);

  useFrame((_state, delta) => {
    const dt = Math.min(delta, 0.05);
    const i = input.current;

    // --- look ---
    camYaw.current -= i.look.dx * LOOK_SENS;
    camPitch.current = clamp(camPitch.current + i.look.dy * LOOK_SENS, -0.15, 1.0);
    i.look.dx = 0;
    i.look.dy = 0;

    const pose = POSES[i.poseIndex] ?? "stand";

    // --- movement (camera-relative, server-validated echo) ---
    fwd.set(Math.sin(camYaw.current), 0, -Math.cos(camYaw.current));
    right.set(fwd.z, 0, -fwd.x); // 90° clockwise of forward on XZ
    let mx = i.move.x;
    let my = i.move.y;
    const mlen = Math.hypot(mx, my);
    const moving = canMove && !inputLocked && mlen > 0.05;
    if (moving) {
      mx /= Math.max(1, mlen);
      my /= Math.max(1, mlen);
      const base = moveSpeedFor(myRole, { running: i.running, crouched: pose !== "stand" });
      const vx = (fwd.x * my + right.x * mx) * base * dt;
      const vz = (fwd.z * my + right.z * mx) * base * dt;
      pos.current = resolveMove(
        pos.current,
        { x: pos.current.x + vx, y: 0, z: pos.current.z + vz },
        map.obstacles,
        map.bounds,
      );
    }

    // --- cosmetic anim state (drives the local rig + relayed to others) ---
    const anim: NetPlayer["anim"] = moving
      ? i.running
        ? "run"
        : "walk"
      : pose === "stand"
        ? "idle"
        : "crouch";
    if (localAnim.current) localAnim.current.anim = anim;
    // Local footsteps only (safe): a remote player's footstep would risk leaking a
    // hider the server hasn't shown us. The engine throttles these to a cadence.
    if (moving) sharedAudio().play(i.running ? "footstepRun" : "footstepWalk");

    // --- place local character ---
    if (localGroup.current) {
      localGroup.current.position.set(pos.current.x, 0, pos.current.z);
      localGroup.current.rotation.y = camYaw.current;
    }
    if (poseGroup.current) applyPoseVisual(poseGroup.current, pose);

    // --- third-person camera with occlusion pull-in ---
    // Spectators (caught) can follow the seeker (a public position from the
    // snapshot); otherwise the camera frames the player's own position.
    let camTargetX = pos.current.x;
    let camTargetZ = pos.current.z;
    if (spectating && followSeeker) {
      for (const p of snapshot.current.values()) {
        if (p.role === "seeker") {
          camTargetX = p.x;
          camTargetZ = p.z;
          break;
        }
      }
    }
    tmpTarget.set(camTargetX, EYE, camTargetZ);
    const cp = Math.cos(camPitch.current);
    const back = new THREE.Vector3(-Math.sin(camYaw.current), 0, Math.cos(camYaw.current));
    let dist = CAM_DIST;
    // shorten distance until the segment target→camera is unobstructed
    for (let step = 0; step < 6; step++) {
      tmpCam
        .copy(tmpTarget)
        .addScaledVector(back, dist * cp)
        .add(new THREE.Vector3(0, dist * Math.sin(camPitch.current), 0));
      const blocked = map.obstacles.some((o) =>
        segmentIntersectsAabb(tmpTarget, tmpCam, o),
      );
      if (!blocked || dist <= 1.2) break;
      dist -= 0.6;
    }
    camera.position.lerp(tmpCam, 0.35);
    camera.lookAt(tmpTarget);

    // --- catch (seeker) ---
    if (i.catchReq) {
      i.catchReq = false;
      if (canCatch) tryCatch(transport, pos.current, camYaw.current, snapshot.current);
    }

    // --- send input (Phase 9-E hybrid: event + steady-move + idle heartbeat) ---
    // Local prediction above runs every frame; this governs only what reaches the
    // server, cutting inbound WebSocket messages (the billed direction) without
    // touching local responsiveness. On a (re)connection, drop the remembered sent
    // sample so the authoritative pose is resynced immediately rather than after
    // the heartbeat.
    const connStatus = transport.status;
    if (connStatus === "connected" && lastStatus.current !== "connected") {
      prevSent.current = null;
    }
    lastStatus.current = connStatus;

    const nowMs = performance.now();
    const cur: InputSample = {
      x: pos.current.x,
      z: pos.current.z,
      yaw: camYaw.current,
      moving,
      running: i.running,
      pose,
    };
    const dtSince = prevSent.current ? nowMs - lastSentAt.current : Infinity;
    if (planInputSend(prevSent.current, cur, dtSince) !== "none") {
      lastSentAt.current = nowMs;
      prevSent.current = cur;
      seq.current += 1;
      transport.sendInput({
        seq: seq.current,
        t: nowMs,
        x: cur.x,
        z: cur.z,
        yaw: cur.yaw,
        pitch: 0,
        anim,
        pose,
        moving,
        running: i.running,
      });
    }
  });

  return (
    <>
      <MapScene mapId={mapId} quality={quality} />
      <group ref={localGroup}>
        <group ref={poseGroup}>
          <AnimatedCharacter
            texture={myTexture}
            animRef={localAnim}
            caught={caught.has(myId)}
            reducedMotion={reducedMotion}
          />
        </group>
      </group>
      <RemotePlayers
        roster={roster}
        myId={myId}
        paints={paints}
        snapshot={snapshot}
        caught={caught}
        reducedMotion={reducedMotion}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Remote players — persistent groups interpolated from the latest snapshot.
// ---------------------------------------------------------------------------

function RemotePlayers({
  roster,
  myId,
  paints,
  snapshot,
  caught,
  reducedMotion,
}: {
  roster: RosterEntry[];
  myId: string;
  paints: Record<string, string>;
  snapshot: React.MutableRefObject<Map<string, NetPlayer>>;
  caught: Set<string>;
  reducedMotion: boolean;
}) {
  const others = roster.filter((r) => r.id !== myId);
  return (
    <>
      {others.map((r) => (
        <RemotePlayer
          key={r.id}
          entry={r}
          texture={textureForPaint(paints[r.id])}
          snapshot={snapshot}
          caught={caught.has(r.id)}
          reducedMotion={reducedMotion}
        />
      ))}
    </>
  );
}

function RemotePlayer({
  entry,
  texture,
  snapshot,
  caught,
  reducedMotion,
}: {
  entry: RosterEntry;
  texture: THREE.Texture;
  snapshot: React.MutableRefObject<Map<string, NetPlayer>>;
  caught: boolean;
  reducedMotion: boolean;
}) {
  const group = useRef<THREE.Group>(null);
  const pose = useRef<THREE.Group>(null);
  const animRef = useRef<CharacterAnimDriver | null>({ anim: "idle" });
  // A player is rendered ONLY while present in the current (server-filtered)
  // snapshot. `<Html>` labels ignore group.visible, so we must conditionally
  // MOUNT the whole subtree — otherwise a roster member who hasn't opened the 3D
  // view (or has disconnected) would show a stale name at the origin. Presence is
  // state (flips rarely), so no per-frame re-render.
  const [present, setPresent] = useState(false);
  const presentRef = useRef(false);
  const freshRef = useRef(true);

  useFrame((_s, delta) => {
    const dt = Math.min(delta, 0.05);
    const net = snapshot.current.get(entry.id);
    const isPresent = !!net;
    if (isPresent !== presentRef.current) {
      presentRef.current = isPresent;
      if (isPresent) freshRef.current = true; // snap on (re)appearance
      setPresent(isPresent);
    }
    const g = group.current;
    if (!net || !g) return;
    if (animRef.current) animRef.current.anim = net.anim;
    if (freshRef.current || shouldSnap(g.position, net)) {
      // First frame after (re)appearing, OR a jump too large to be real motion
      // (a correction / reconnect): snap instead of skating across the map.
      g.position.set(net.x, 0, net.z);
      g.rotation.y = net.yaw;
      freshRef.current = false;
    } else {
      // Frame-rate-independent smoothing toward the latest snapshot; yaw takes the
      // shortest path so turning past ±π never unwinds the long way.
      g.position.x = damp(g.position.x, net.x, 14, dt);
      g.position.z = damp(g.position.z, net.z, 14, dt);
      g.rotation.y = dampAngle(g.rotation.y, net.yaw, 12, dt);
    }
    if (pose.current) applyPoseVisual(pose.current, net.pose);
  });

  if (!present) return null; // not in the snapshot → no mesh AND no name label
  return (
    <group ref={group}>
      <group ref={pose}>
        <AnimatedCharacter texture={texture} animRef={animRef} caught={caught} reducedMotion={reducedMotion} />
      </group>
      <Html position={[0, 2.35, 0]} center distanceFactor={12} prepend>
        <div
          style={{
            padding: "1px 6px",
            borderRadius: 6,
            fontSize: 12,
            whiteSpace: "nowrap",
            color: caught ? "#9aa0aa" : "#fff",
            background: entry.role === "seeker" ? "rgba(245,158,11,0.85)" : "rgba(0,0,0,0.5)",
            textDecoration: caught ? "line-through" : "none",
          }}
        >
          {entry.role === "seeker" ? "👀 " : ""}
          {entry.nickname}
        </div>
      </Html>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function applyPoseVisual(g: THREE.Group, pose: Pose) {
  switch (pose) {
    case "crouch":
      g.scale.set(1, 0.68, 1);
      g.rotation.x = 0;
      break;
    case "ball":
      g.scale.set(0.72, 0.6, 0.72);
      g.rotation.x = 0;
      break;
    case "lie":
      g.scale.set(1, 1, 1);
      g.rotation.x = -Math.PI / 2.2;
      break;
    default:
      g.scale.set(1, 1, 1);
      g.rotation.x = 0;
  }
}

/** Mirror of the server's spawn assignment so local prediction starts in sync. */
function spawnFor(mapId: MapId, myId: string, role: Role, roster: RosterEntry[]) {
  const map = getMap(mapId);
  if (role === "seeker") return { ...map.seekerSpawn };
  const hiderIds = roster
    .filter((r) => r.role === "hider")
    .map((r) => r.id)
    .sort();
  const idx = Math.max(0, hiderIds.indexOf(myId));
  return { ...map.spawns[idx % map.spawns.length] };
}

/** Picks the nearest visible hider in front and asks the server to catch them. */
function tryCatch(
  transport: RealtimeTransport,
  seekerPos: { x: number; z: number },
  yaw: number,
  snapshot: Map<string, NetPlayer>,
) {
  const fx = Math.sin(yaw);
  const fz = -Math.cos(yaw);
  let best: string | null = null;
  let bestDist = Infinity;
  for (const p of snapshot.values()) {
    if (p.role !== "hider") continue;
    const dx = p.x - seekerPos.x;
    const dz = p.z - seekerPos.z;
    const d = Math.hypot(dx, dz);
    if (d > 4) continue;
    if (d > 0.01 && (dx * fx + dz * fz) / d < 0.2) continue; // must be in front
    if (d < bestDist) {
      bestDist = d;
      best = p.id;
    }
  }
  if (best) transport.sendCatch(best);
}
