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
import {
  CROUCH_SPEED_MULT,
  RUN_SPEED,
  WALK_SPEED,
} from "../../lib/constants";
import Character from "./Character";
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
  transport: RealtimeTransport;
  roster: RosterEntry[];
  paints: Record<string, string>;
  caughtIds: string[];
}

const EYE = 1.5;
const CAM_DIST = 4.4;
const SEND_INTERVAL = 1000 / 18;
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

  // Live snapshot (visibility-filtered by the server) + caught set, updated from
  // the realtime channel. Kept in refs so the frame loop reads without re-render.
  const snapshot = useRef<Map<string, NetPlayer>>(new Map());
  const [caught, setCaught] = useState<Set<string>>(new Set(props.caughtIds));

  useEffect(() => {
    setCaught((prev) => new Set([...prev, ...props.caughtIds]));
  }, [props.caughtIds]);

  useEffect(() => {
    props.transport.onMessage((msg: ServerMsg) => {
      if (msg.type === "snapshot") {
        const map = new Map<string, NetPlayer>();
        for (const p of msg.players) map.set(p.id, p);
        snapshot.current = map;
      } else if (msg.type === "caught") {
        setCaught((prev) => new Set(prev).add(msg.hiderId));
      }
    });
  }, [props.transport]);

  // Keyboard input.
  useEffect(() => {
    const keys = new Set<string>();
    const recompute = () => {
      const i = input.current;
      i.move.x = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);
      i.move.y = (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0);
      i.running = keys.has("ShiftLeft") || keys.has("ShiftRight");
    };
    const cyclePose = () => {
      input.current.poseIndex = (input.current.poseIndex + 1) % POSES.length;
      setPoseLabel(POSES[input.current.poseIndex]);
    };
    const down = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code === "KeyE") cyclePose();
      else if (e.code === "KeyC") {
        input.current.poseIndex = input.current.poseIndex === 1 ? 0 : 1;
        setPoseLabel(POSES[input.current.poseIndex]);
      } else if (e.code === "Space") {
        input.current.catchReq = true;
      } else {
        keys.add(e.code);
        recompute();
      }
    };
    const up = (e: KeyboardEvent) => {
      keys.delete(e.code);
      recompute();
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
    if (lookPointer.current !== null) return;
    lookPointer.current = e.pointerId;
    lastPtr.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (e.pointerId !== lookPointer.current) return;
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
        <SceneContents {...props} input={input} snapshot={snapshot} caught={caught} quality={quality} />
      </Canvas>

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
}

function SceneContents({
  mapId,
  myId,
  myRole,
  canMove,
  canCatch,
  transport,
  roster,
  paints,
  input,
  snapshot,
  caught,
  quality,
}: ContentsProps) {
  const map = useMemo(() => getMap(mapId), [mapId]);
  const myTexture = useMemo(() => textureForPaint(paints[myId]), [paints, myId]);
  const { camera } = useThree();

  const localGroup = useRef<THREE.Group>(null);
  const poseGroup = useRef<THREE.Group>(null);
  const pos = useRef(spawnFor(mapId, myId, myRole, roster));
  const camYaw = useRef(0);
  const camPitch = useRef(0.25);
  const seq = useRef(0);
  const sinceSend = useRef(0);

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
    const moving = canMove && mlen > 0.05;
    if (moving) {
      mx /= Math.max(1, mlen);
      my /= Math.max(1, mlen);
      const base = pose === "stand" ? (i.running ? RUN_SPEED : WALK_SPEED) : WALK_SPEED * CROUCH_SPEED_MULT;
      const vx = (fwd.x * my + right.x * mx) * base * dt;
      const vz = (fwd.z * my + right.z * mx) * base * dt;
      pos.current = resolveMove(
        pos.current,
        { x: pos.current.x + vx, y: 0, z: pos.current.z + vz },
        map.obstacles,
        map.bounds,
      );
    }

    // --- place local character ---
    if (localGroup.current) {
      localGroup.current.position.set(pos.current.x, 0, pos.current.z);
      localGroup.current.rotation.y = camYaw.current;
    }
    if (poseGroup.current) applyPoseVisual(poseGroup.current, pose);

    // --- third-person camera with occlusion pull-in ---
    tmpTarget.set(pos.current.x, EYE, pos.current.z);
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

    // --- send input (throttled) ---
    sinceSend.current += dt * 1000;
    if (sinceSend.current >= SEND_INTERVAL) {
      sinceSend.current = 0;
      seq.current += 1;
      transport.sendInput({
        seq: seq.current,
        t: performance.now(),
        x: pos.current.x,
        z: pos.current.z,
        yaw: camYaw.current,
        pitch: 0,
        anim: moving ? (i.running ? "run" : "walk") : pose === "stand" ? "idle" : "crouch",
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
          <Character texture={myTexture} />
        </group>
      </group>
      <RemotePlayers
        roster={roster}
        myId={myId}
        paints={paints}
        snapshot={snapshot}
        caught={caught}
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
}: {
  roster: RosterEntry[];
  myId: string;
  paints: Record<string, string>;
  snapshot: React.MutableRefObject<Map<string, NetPlayer>>;
  caught: Set<string>;
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
}: {
  entry: RosterEntry;
  texture: THREE.Texture;
  snapshot: React.MutableRefObject<Map<string, NetPlayer>>;
  caught: boolean;
}) {
  const group = useRef<THREE.Group>(null);
  const pose = useRef<THREE.Group>(null);
  // A player is rendered ONLY while present in the current (server-filtered)
  // snapshot. `<Html>` labels ignore group.visible, so we must conditionally
  // MOUNT the whole subtree — otherwise a roster member who hasn't opened the 3D
  // view (or has disconnected) would show a stale name at the origin. Presence is
  // state (flips rarely), so no per-frame re-render.
  const [present, setPresent] = useState(false);
  const presentRef = useRef(false);
  const freshRef = useRef(true);

  useFrame(() => {
    const net = snapshot.current.get(entry.id);
    const isPresent = !!net;
    if (isPresent !== presentRef.current) {
      presentRef.current = isPresent;
      if (isPresent) freshRef.current = true; // snap on (re)appearance
      setPresent(isPresent);
    }
    const g = group.current;
    if (!net || !g) return;
    if (freshRef.current) {
      // First frame after (re)appearing: snap to the real position, never lerp
      // in from the origin.
      g.position.set(net.x, 0, net.z);
      freshRef.current = false;
    } else {
      g.position.x += (net.x - g.position.x) * 0.25;
      g.position.z += (net.z - g.position.z) * 0.25;
    }
    g.rotation.y = net.yaw;
    if (pose.current) applyPoseVisual(pose.current, net.pose);
  });

  if (!present) return null; // not in the snapshot → no mesh AND no name label
  return (
    <group ref={group}>
      <group ref={pose}>
        <Character texture={texture} />
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
