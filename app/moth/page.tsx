'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import Link from 'next/link';
import { MOTH_BAKED } from '../../game/moth-baked.mjs';
import './moth.css';

interface TextureRecord {
  width: number;
  height: number;
  data: string;
}

interface MaterialRecord {
  size: number;
  r: string;
  t: string;
}

interface LevelCell {
  i: number;
  x: number;
  y: number;
  z: number;
  radiating: boolean;
}

interface Measurement {
  bits: string;
  probability: number;
}

interface LevelMetrics {
  szSamp: number;
  mode: string;
  backend: string;
  shots: number;
}

interface LevelRecord {
  rows: number;
  cols: number;
  numQubits: number;
  coupling: number[][];
  cells: LevelCell[];
  measurements: Measurement[];
  metrics: LevelMetrics;
}

interface SeedRecord {
  seed: number | null;
  hex: string | null;
  bytes: number;
  bell: number | null;
  classicalBound: number | null;
  commitment: string | null;
  outputBits: number;
  backend: string | null;
  mode: string | null;
  certificate: Record<string, unknown> | null;
}

interface MotifNote {
  step: number;
  degree: number;
  len: number;
  vel: number;
  type?: string;
}

interface MotifRecord {
  bpm: number;
  notes: MotifNote[];
}

interface IrTap {
  t: number;
  g: number;
}

interface IrRecord {
  url: string;
  seconds: number;
  sampleRate: number;
  taps?: IrTap[];
}

interface SkyRecord {
  width: number;
  height: number;
  data: string;
  equirect: boolean;
}

interface EffectFrame {
  width: number;
  height: number;
  data: string;
}

interface EffectRecord {
  fps: number;
  frames: EffectFrame[];
}

interface ProvenanceRecord {
  engine: string;
  jobId: string | null;
  mode: string;
  name?: string;
  credits?: number;
}

interface MothBaked {
  version?: number;
  generator?: string;
  textures?: Record<string, TextureRecord>;
  normals?: Record<string, TextureRecord>;
  materials?: Record<string, MaterialRecord>;
  levels?: Record<string, LevelRecord>;
  seeds?: Record<string, SeedRecord>;
  motifs?: Record<string, MotifRecord>;
  irs?: Record<string, IrRecord>;
  sky?: Record<string, SkyRecord>;
  effects?: Record<string, EffectRecord>;
  provenance?: Record<string, ProvenanceRecord>;
}

const data = MOTH_BAKED as unknown as MothBaked;

const textures = data.textures ?? {};
const normals = data.normals ?? {};
const materials = data.materials ?? {};
const levels = data.levels ?? {};
const seeds = data.seeds ?? {};
const motifs = data.motifs ?? {};
const irs = data.irs ?? {};
const sky = data.sky ?? {};
const effects = data.effects ?? {};
const provenance = data.provenance ?? {};

const LINKS = [
  { label: 'Moth Quantum', href: 'https://mothquantum.com' },
  { label: 'Atlas Platform', href: 'https://platform.mothquantum.com' },
  { label: 'Discord', href: 'https://discord.gg/2HJ9kZgxxP' },
  { label: 'GitHub', href: 'https://github.com/moth-quantum' },
];

const noopSubscribe = () => () => {};

function useIsClient(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

const dataUrlCache = new Map<string, string | null>();

function decodeBase64(base64: string): Uint8Array | null {
  if (!base64) return null;
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

function buildDataUrl(
  width: number,
  height: number,
  base64: string,
  channels: number,
): string | null {
  if (typeof document === 'undefined') return null;
  if (!base64 || width <= 0 || height <= 0) return null;
  const bytes = decodeBase64(base64);
  if (!bytes) return null;
  const pixels = width * height;
  const expected = pixels * channels;
  if (bytes.length < expected) return null;
  try {
    const rgba = new Uint8ClampedArray(pixels * 4);
    if (channels === 3) {
      for (let src = 0, dst = 0; src < expected; src += 3, dst += 4) {
        rgba[dst] = bytes[src] ?? 0;
        rgba[dst + 1] = bytes[src + 1] ?? 0;
        rgba[dst + 2] = bytes[src + 2] ?? 0;
        rgba[dst + 3] = 255;
      }
    } else {
      rgba.set(bytes.subarray(0, rgba.length));
      if (channels !== 4) {
        return null;
      }
    }
    const imageData = new ImageData(rgba, width, height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

function cachedDataUrl(
  cacheKey: string,
  width: number,
  height: number,
  base64: string,
  channels: number,
): string | null {
  if (dataUrlCache.has(cacheKey)) {
    return dataUrlCache.get(cacheKey) ?? null;
  }
  const url = buildDataUrl(width, height, base64, channels);
  dataUrlCache.set(cacheKey, url);
  return url;
}

function useAssetUrl(
  cacheKey: string,
  width: number,
  height: number,
  base64: string,
  channels: number,
): string | null {
  const isClient = useIsClient();
  if (!isClient) return null;
  return cachedDataUrl(cacheKey, width, height, base64, channels);
}

function engineFor(key: string): string {
  for (const record of Object.values(provenance)) {
    if (record && record.name === key) return record.engine;
  }
  return key;
}

function readString(source: Record<string, unknown> | null | undefined, key: string): string | null {
  if (!source) return null;
  const value = source[key];
  return typeof value === 'string' ? value : null;
}

function formatPercent(value: number): string {
  const scaled = value > 1 ? value : value * 100;
  return `${scaled.toFixed(2)}%`;
}

function shortId(value: string | null | undefined): string {
  if (!value) return '—';
  if (value.length <= 16) return value;
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

interface AssetImageProps {
  cacheKey: string;
  width: number;
  height: number;
  base64: string;
  channels: number;
  alt: string;
  className?: string;
  style?: CSSProperties;
}

function AssetImage({
  cacheKey,
  width,
  height,
  base64,
  channels,
  alt,
  className,
  style,
}: AssetImageProps) {
  const url = useAssetUrl(cacheKey, width, height, base64, channels);
  const classes = className ? `${className} asset-img` : 'asset-img';
  if (!url) {
    return <span className={`${classes} asset-pending`} style={style} aria-hidden="true" />;
  }
  return (
    <img
      className={classes}
      src={url}
      alt={alt}
      width={width}
      height={height}
      style={style}
      decoding="async"
    />
  );
}

interface SectionProps {
  id: string;
  title: string;
  note?: string;
  children: ReactNode;
}

function Section({ id, title, note, children }: SectionProps) {
  return (
    <section className="moth-section" id={id}>
      <div className="section-head">
        <h2 className="section-title">{title}</h2>
        {note ? <span className="section-note">{note}</span> : null}
      </div>
      {children}
    </section>
  );
}

interface TextureCardProps {
  name: string;
  texture: TextureRecord;
  cachePrefix: string;
}

function TextureCard({ name, texture, cachePrefix }: TextureCardProps) {
  const url = useAssetUrl(`${cachePrefix}:${name}`, texture.width, texture.height, texture.data, 4);
  const style = url
    ? ({ backgroundImage: `url(${url})` } as CSSProperties)
    : ({ backgroundImage: 'none' } as CSSProperties);
  return (
    <article className="tile-card">
      <div className="tiled" style={style} role="img" aria-label={`${name} tiled preview`} />
      <div className="tile-body">
        <span className="tile-name">{name}</span>
        <span className="tile-meta">
          {cachePrefix === 'normals' ? 'normal · ' : ''}
          {engineFor(name)} · {texture.width}×{texture.height}
        </span>
      </div>
    </article>
  );
}

interface MaterialCardProps {
  name: string;
  material: MaterialRecord;
}

function MaterialCard({ name, material }: MaterialCardProps) {
  const size = material.size || 0;
  return (
    <article className="material-card">
      <h3 className="card-title">{name}</h3>
      <div className="swatch-row">
        <figure className="swatch">
          <AssetImage
            cacheKey={`mat:${name}:r`}
            width={size}
            height={size}
            base64={material.r}
            channels={3}
            alt={`${name} reflectance LUT`}
            className="swatch-img"
          />
          <figcaption className="swatch-cap">R · reflectance</figcaption>
        </figure>
        <figure className="swatch">
          <AssetImage
            cacheKey={`mat:${name}:t`}
            width={size}
            height={size}
            base64={material.t}
            channels={3}
            alt={`${name} transmittance LUT`}
            className="swatch-img"
          />
          <figcaption className="swatch-cap">T · transmittance</figcaption>
        </figure>
      </div>
      <span className="tile-meta">{size}×{size} LUT</span>
    </article>
  );
}

interface EffectPlayerProps {
  name: string;
  effect: EffectRecord;
}

function EffectPlayer({ name, effect }: EffectPlayerProps) {
  const frames = effect.frames ?? [];
  const fps = Math.min(30, Math.max(1, Math.round(effect.fps) || 12));
  const [index, setIndex] = useState(0);
  const count = frames.length;

  useEffect(() => {
    if (count <= 1) return;
    const handle = window.setInterval(() => {
      setIndex((prev) => (prev + 1) % count);
    }, 1000 / fps);
    return () => window.clearInterval(handle);
  }, [count, fps]);

  if (count === 0) {
    return <p className="empty">No frames baked for {name}.</p>;
  }

  const frame = frames[index % count] ?? frames[0];

  return (
    <article className="effect-card">
      <div className="effect-frame">
        <AssetImage
          cacheKey={`fx:${name}:${index % count}`}
          width={frame.width}
          height={frame.height}
          base64={frame.data}
          channels={4}
          alt={`${name} frame ${(index % count) + 1} of ${count}`}
          className="effect-img"
        />
      </div>
      <div className="effect-body">
        <span className="tile-name">{name}</span>
        <span className="tile-meta">
          {count} frames · {fps} fps
        </span>
      </div>
    </article>
  );
}

interface MotifPlayerProps {
  name: string;
  motif: MotifRecord;
}

function MotifPlayer({ name, motif }: MotifPlayerProps) {
  const isClient = useIsClient();
  const [playing, setPlaying] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);
  const oscsRef = useRef<OscillatorNode[]>([]);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      for (const osc of oscsRef.current) {
        try {
          osc.stop();
        } catch (err) {
          void err;
        }
      }
      oscsRef.current = [];
      const ctx = ctxRef.current;
      if (ctx) {
        void ctx.close();
        ctxRef.current = null;
      }
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  const supported =
    isClient &&
    typeof window !== 'undefined' &&
    Boolean(
      window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext,
    );

  const stop = () => {
    for (const osc of oscsRef.current) {
      try {
        osc.stop();
      } catch (err) {
        void err;
      }
    }
    oscsRef.current = [];
    const ctx = ctxRef.current;
    if (ctx) {
      void ctx.close();
      ctxRef.current = null;
    }
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setPlaying(false);
  };

  const play = () => {
    if (typeof window === 'undefined') return;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    stop();
    const ctx = new Ctor();
    ctxRef.current = ctx;
    const bpm = motif.bpm > 0 ? motif.bpm : 120;
    const beat = 60 / bpm;
    const start = ctx.currentTime + 0.06;
    const notes = motif.notes ?? [];
    const scale = [0, 2, 3, 5, 7, 8, 10, 12, 14, 15, 17, 19];
    const oscs: OscillatorNode[] = [];
    let end = 0;

    notes.forEach((note) => {
      const degree = Math.max(0, note.degree | 0);
      const octave = Math.floor(degree / scale.length);
      const semi = (scale[degree % scale.length] ?? 0) + octave * 12;
      const freq = 220 * Math.pow(2, semi / 12);
      const t0 = start + Math.max(0, note.step) * beat;
      const dur = Math.max(0.06, (note.len || 1) * beat);
      const amp = 0.14 * (note.vel || 0.8);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = note.type === 'square' ? 'square' : 'triangle';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.linearRampToValueAtTime(amp, t0 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
      oscs.push(osc);
      end = Math.max(end, (note.step || 0) * beat + dur);
    });

    oscsRef.current = oscs;
    setPlaying(true);
    timerRef.current = window.setTimeout(() => {
      stop();
    }, (end + 0.4) * 1000);
  };

  return (
    <article className="motif-card">
      <div className="motif-info">
        <span className="tile-name">{name}</span>
        <span className="tile-meta">
          {motif.bpm || 120} bpm · {motif.notes?.length ?? 0} notes
        </span>
      </div>
      <div className="motif-controls">
        <button
          type="button"
          className="btn"
          onClick={playing ? stop : play}
          disabled={!supported}
        >
          {playing ? 'Stop' : 'Play'}
        </button>
        {!supported ? <span className="tile-meta">Web Audio unavailable</span> : null}
      </div>
    </article>
  );
}

interface ArenaGraphProps {
  level: LevelRecord;
}

function ArenaGraph({ level }: ArenaGraphProps) {
  const cols = Math.max(1, level.cols || 1);
  const rows = Math.max(1, level.rows || 1);
  const cells = level.cells ?? [];
  const coupling = level.coupling ?? [];
  const spacing = 26;
  const pad = 16;
  const width = cols * spacing + pad * 2;
  const height = rows * spacing + pad * 2;
  const point = (i: number) => {
    const col = ((i % cols) + cols) % cols;
    const row = Math.floor(i / cols);
    return {
      x: pad + col * spacing + spacing / 2,
      y: pad + row * spacing + spacing / 2,
    };
  };
  const radiating = new Set(cells.filter((cell) => cell.radiating).map((cell) => cell.i));

  return (
    <svg
      className="arena-graph"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Qubit coupling lattice"
    >
      {coupling.map((edge, idx) => {
        const a = point(edge[0] ?? 0);
        const b = point(edge[1] ?? 0);
        return <line key={idx} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="edge" />;
      })}
      {cells.map((cell) => {
        const p = point(cell.i);
        return (
          <circle
            key={cell.i}
            cx={p.x}
            cy={p.y}
            r={radiating.has(cell.i) ? 5.5 : 3.4}
            className={radiating.has(cell.i) ? 'node radiating' : 'node'}
          />
        );
      })}
    </svg>
  );
}

function EmptyNote({ label }: { label: string }) {
  return <p className="empty">No {label} baked into this build.</p>;
}

export default function MothPage() {
  const textureEntries = Object.entries(textures);
  const normalEntries = Object.entries(normals);
  const materialEntries = Object.entries(materials);
  const levelEntries = Object.entries(levels);
  const seedEntries = Object.entries(seeds);
  const motifEntries = Object.entries(motifs);
  const irEntries = Object.entries(irs);
  const skyEntries = Object.entries(sky);
  const effectEntries = Object.entries(effects);
  const provenanceEntries = Object.entries(provenance);
  const totalCredits = provenanceEntries.reduce(
    (sum, [, record]) => sum + (typeof record?.credits === 'number' ? record.credits : 0),
    0,
  );

  const stats = [
    { label: 'Textures', value: textureEntries.length },
    { label: 'Normal maps', value: normalEntries.length },
    { label: 'Materials', value: materialEntries.length },
    { label: 'Levels', value: levelEntries.length },
    { label: 'Effects', value: effectEntries.length },
    { label: 'Motifs', value: motifEntries.length },
    { label: 'IRs', value: irEntries.length },
    { label: 'Seeds', value: seedEntries.length },
    { label: 'Credits', value: totalCredits },
  ];

  return (
    <main className="moth-page">
      <div className="moth-glow" aria-hidden="true" />

      <header className="moth-hero">
        <Link className="moth-back" href="/">
          ← Back to the arena
        </Link>
        <p className="moth-kicker">Powered by Moth Quantum · Atlas API</p>
        <h1 className="moth-title">Moth × COCS</h1>
        <p className="moth-sub">
          Colosseum of Competitive Slop bakes Moth Quantum engine outputs — procedural
          textures, normal maps, reflectance LUTs, quantum-labyrinth arenas and
          provably-fair entropy — straight into its assets at build time. This page
          showcases those outputs and where they land in the game.
        </p>
        <nav className="moth-links" aria-label="Moth Quantum links">
          {LINKS.map((link) => (
            <a
              key={link.href}
              className="moth-link"
              href={link.href}
              target="_blank"
              rel="noreferrer"
            >
              {link.label}
            </a>
          ))}
        </nav>
      </header>

      <section className="stats-grid" aria-label="Baked asset totals">
        {stats.map((stat) => (
          <div className="stat" key={stat.label}>
            <span className="stat-value">{stat.value}</span>
            <span className="stat-label">{stat.label}</span>
          </div>
        ))}
      </section>

      <Section
        id="textures"
        title="Textures"
        note={`${textureEntries.length} baked albedo tiles`}
      >
        {textureEntries.length === 0 ? (
          <EmptyNote label="textures" />
        ) : (
          <div className="grid tiles">
            {textureEntries.map(([name, texture]) => (
              <TextureCard key={name} name={name} texture={texture} cachePrefix="textures" />
            ))}
          </div>
        )}
      </Section>

      <Section id="normals" title="Normal / bump maps" note={`${normalEntries.length} baked`}>
        {normalEntries.length === 0 ? (
          <EmptyNote label="normal maps" />
        ) : (
          <div className="grid tiles">
            {normalEntries.map(([name, texture]) => (
              <TextureCard key={name} name={name} texture={texture} cachePrefix="normals" />
            ))}
          </div>
        )}
      </Section>

      <Section
        id="materials"
        title="Materials"
        note={`${materialEntries.length} reflectance / transmittance LUTs`}
      >
        {materialEntries.length === 0 ? (
          <EmptyNote label="materials" />
        ) : (
          <div className="grid materials">
            {materialEntries.map(([name, material]) => (
              <MaterialCard key={name} name={name} material={material} />
            ))}
          </div>
        )}
      </Section>

      <Section id="sky" title="Skyboxes" note={`${skyEntries.length} equirectangular`}>
        {skyEntries.length === 0 ? (
          <EmptyNote label="skyboxes" />
        ) : (
          <div className="sky-grid">
            {skyEntries.map(([name, record]) => (
              <figure className="sky-card" key={name}>
                <AssetImage
                  cacheKey={`sky:${name}`}
                  width={record.width}
                  height={record.height}
                  base64={record.data}
                  channels={4}
                  alt={`${name} skybox`}
                  className="sky-img"
                />
                <figcaption className="tile-meta">
                  {name} · {record.width}×{record.height}
                  {record.equirect ? ' · equirect' : ''}
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </Section>

      <Section id="effects" title="Effects" note={`${effectEntries.length} animated sheets`}>
        {effectEntries.length === 0 ? (
          <EmptyNote label="effects" />
        ) : (
          <div className="grid effects">
            {effectEntries.map(([name, effect]) => (
              <EffectPlayer key={name} name={name} effect={effect} />
            ))}
          </div>
        )}
      </Section>

      <Section
        id="arena"
        title="Quantum arena"
        note={levelEntries.length > 0 ? `${levelEntries.length} labyrinth graph(s)` : undefined}
      >
        {levelEntries.length === 0 ? (
          <EmptyNote label="levels" />
        ) : (
          levelEntries.map(([name, level]) => {
            const edges = level.coupling?.length ?? 0;
            const radiating = (level.cells ?? []).filter((cell) => cell.radiating).length;
            const measurements = level.measurements ?? [];
            return (
              <article className="arena-card" key={name}>
                <div className="arena-visual">
                  <ArenaGraph level={level} />
                </div>
                <div className="arena-body">
                  <h3 className="card-title">{name}</h3>
                  <div className="metrics">
                    <div className="metric">
                      <span className="metric-value">
                        {level.rows}×{level.cols}
                      </span>
                      <span className="metric-label">lattice</span>
                    </div>
                    <div className="metric">
                      <span className="metric-value">{level.numQubits}</span>
                      <span className="metric-label">qubits</span>
                    </div>
                    <div className="metric">
                      <span className="metric-value">{edges}</span>
                      <span className="metric-label">couplings</span>
                    </div>
                    <div className="metric">
                      <span className="metric-value">{radiating}</span>
                      <span className="metric-label">radiating</span>
                    </div>
                    <div className="metric">
                      <span className="metric-value">
                        {typeof level.metrics?.szSamp === 'number'
                          ? level.metrics.szSamp.toFixed(3)
                          : '—'}
                      </span>
                      <span className="metric-label">Sz</span>
                    </div>
                    <div className="metric">
                      <span className="metric-value">{level.metrics?.mode ?? '—'}</span>
                      <span className="metric-label">
                        {level.metrics?.backend ?? 'backend'} · {level.metrics?.shots ?? 0} shots
                      </span>
                    </div>
                  </div>
                  {measurements.length > 0 ? (
                    <div className="measures">
                      {measurements.slice(0, 8).map((measurement) => (
                        <div className="measure" key={measurement.bits}>
                          <span className="bits mono">{measurement.bits}</span>
                          <span className="measure-bar" aria-hidden="true">
                            <span
                              className="measure-fill"
                              style={{
                                width: `${Math.min(100, Math.max(2, measurement.probability * 100 * 4))}%`,
                              }}
                            />
                          </span>
                          <span className="prob">{formatPercent(measurement.probability)}</span>
                        </div>
                      ))}
                      {measurements.length > 8 ? (
                        <span className="tile-meta">+{measurements.length - 8} more outcomes</span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </article>
            );
          })
        )}
      </Section>

      <Section id="seeds" title="Provably-fair entropy" note={`${seedEntries.length} seed(s)`}>
        {seedEntries.length === 0 ? (
          <EmptyNote label="seeds" />
        ) : (
          <div className="grid seeds">
            {seedEntries.map(([name, seed]) => (
              <article className="seed-card" key={name}>
                <h3 className="card-title">{name}</h3>
                <dl className="seed-facts">
                  <div>
                    <dt>bell</dt>
                    <dd className="mono">{seed.bell ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>classical bound</dt>
                    <dd className="mono">{seed.classicalBound ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>output bits</dt>
                    <dd className="mono">{seed.outputBits}</dd>
                  </div>
                  <div>
                    <dt>mode</dt>
                    <dd className="mono">
                      {seed.mode ?? '—'}
                      {seed.backend ? ` · ${seed.backend}` : ''}
                    </dd>
                  </div>
                  <div>
                    <dt>grade</dt>
                    <dd className="mono">{readString(seed.certificate, 'grade') ?? '—'}</dd>
                  </div>
                </dl>
                <span className="commitment mono" title={seed.commitment ?? undefined}>
                  {shortId(seed.commitment)}
                </span>
              </article>
            ))}
          </div>
        )}
      </Section>

      <Section id="audio" title="Audio" note={`${irEntries.length} IR(s) · ${motifEntries.length} motif(s)`}>
        {irEntries.length === 0 && motifEntries.length === 0 ? (
          <EmptyNote label="audio" />
        ) : (
          <div className="grid audio">
            {irEntries.map(([name, record]) => (
              <article className="ir-card" key={name}>
                <span className="tile-name">{name}</span>
                <span className="tile-meta">
                  {record.seconds.toFixed(2)}s · {record.sampleRate} Hz
                  {record.taps ? ` · ${record.taps.length} taps` : ''}
                </span>
                <audio controls preload="none" src={record.url} />
              </article>
            ))}
            {motifEntries.map(([name, motif]) => (
              <MotifPlayer key={name} name={name} motif={motif} />
            ))}
          </div>
        )}
      </Section>

      <Section
        id="provenance"
        title="Provenance"
        note={`${provenanceEntries.length} Moth job(s)`}
      >
        {provenanceEntries.length === 0 ? (
          <EmptyNote label="provenance records" />
        ) : (
          <div className="prov-wrap">
            <table className="prov">
              <thead>
                <tr>
                  <th scope="col">Case</th>
                  <th scope="col">Engine</th>
                  <th scope="col">Job ID</th>
                  <th scope="col">Mode</th>
                  <th scope="col">Credits</th>
                </tr>
              </thead>
              <tbody>
                {provenanceEntries.map(([caseName, record]) => (
                  <tr key={caseName}>
                    <td className="case-name">{caseName}</td>
                    <td className="mono">{record.engine}</td>
                    <td className="jobid mono">{shortId(record.jobId)}</td>
                    <td className="mono">{record.mode}</td>
                    <td className="mono">
                      {typeof record.credits === 'number' ? record.credits : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <footer className="moth-footer">
        <p>
          Generated offline from the Moth Atlas API · engine outputs baked to data, zero runtime
          dependencies.
        </p>
        <p className="moth-footer-meta">
          v{data.version ?? '—'} · {data.generator ?? 'unknown generator'} ·{' '}
          <Link href="/">back to the arena</Link>
        </p>
      </footer>
    </main>
  );
}
