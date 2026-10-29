import { execFile } from "node:child_process";
import fs from "node:fs";
import ffmpegStatic from "ffmpeg-static";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";

// In a packaged build the binaries sit in app.asar.unpacked; in dev they're in node_modules.
const fix = (p: string | null | undefined) => (p ? p.replace("app.asar", "app.asar.unpacked") : null);
const FFMPEG = fix(ffmpegStatic as unknown as string) ?? "ffmpeg";
const FFPROBE = fix(ffprobeInstaller.path) ?? "ffprobe";

export function binariesOk(): { ffmpeg: boolean; ffprobe: boolean } {
  return { ffmpeg: fs.existsSync(FFMPEG), ffprobe: fs.existsSync(FFPROBE) };
}

function run(bin: string, args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      args,
      { timeout: timeoutMs, killSignal: "SIGKILL", windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const msg = (stderr || err.message).toString().trim().split(/\r?\n/).slice(-3).join(" | ");
          reject(new Error((err as { killed?: boolean }).killed ? `timed out after ${timeoutMs / 1000}s` : msg));
        } else {
          resolve({ stdout: stdout.toString(), stderr: stderr.toString() });
        }
      }
    );
  });
}

export type ProbeInfo = {
  duration: number | null;
  width: number | null;
  height: number | null;
  vcodec: string | null;
  /** Display-aspect correction for anamorphic video (e.g. DVD 720x480 shown as 16:9). */
  sar: number;
  hdr: boolean;
  /** Absolute stream index of embedded cover art (MP4 covr, MKV cover.jpg attachment), if any. */
  coverStream: number | null;
};

type FfStream = {
  index: number;
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  sample_aspect_ratio?: string;
  color_transfer?: string;
  duration?: string;
  disposition?: { attached_pic?: number; default?: number };
};

export async function probe(file: string): Promise<ProbeInfo> {
  const { stdout } = await run(
    FFPROBE,
    ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file],
    30_000
  );
  const j = JSON.parse(stdout) as { format?: { duration?: string }; streams?: FfStream[] };
  const streams = j.streams ?? [];
  const cover = streams.find((s) => s.codec_type === "video" && s.disposition?.attached_pic === 1);
  const video =
    streams.find((s) => s.codec_type === "video" && !s.disposition?.attached_pic && s.disposition?.default) ??
    streams.find((s) => s.codec_type === "video" && !s.disposition?.attached_pic);

  let duration = parseFloat(j.format?.duration ?? "");
  if (!isFinite(duration) || duration <= 0) duration = parseFloat(video?.duration ?? "");
  let sar = 1;
  const m = /^(\d+):(\d+)$/.exec(video?.sample_aspect_ratio ?? "");
  if (m && +m[1] > 0 && +m[2] > 0) sar = +m[1] / +m[2];

  return {
    duration: isFinite(duration) && duration > 0 ? duration : null,
    width: video?.width ?? null,
    height: video?.height ?? null,
    vcodec: video?.codec_name ?? null,
    sar,
    hdr: video?.color_transfer === "smpte2084" || video?.color_transfer === "arib-std-b67",
    coverStream: cover ? cover.index : null,
  };
}

const FIT = "scale=480:480:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=bicubic";
const TONEMAP =
  "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0," +
  "zscale=t=bt709:m=bt709:r=tv,format=yuv420p";

const OUT = ["-frames:v", "1", "-q:v", "4", "-f", "image2", "-update", "1", "-y"];

/** Resize a still image (sidecar .jpg/.png/.webp) into the thumbnail cache. */
export async function imageThumb(src: string, out: string): Promise<void> {
  await run(
    FFMPEG,
    ["-hide_banner", "-loglevel", "error", "-nostdin", "-f", "image2", "-pattern_type", "none", "-i", src, "-vf", FIT, ...OUT, out],
    30_000
  );
}

/** Extract embedded cover art (attached_pic stream). */
export async function coverThumb(src: string, streamIndex: number, out: string): Promise<void> {
  await run(
    FFMPEG,
    ["-hide_banner", "-loglevel", "error", "-nostdin", "-i", src, "-map", `0:${streamIndex}`, "-vf", FIT, ...OUT, out],
    30_000
  );
}

/**
 * Grab one frame near `at` seconds. First try decodes keyframes only with a
 * fast (inaccurate) seek — touches only a few MB of the file even on huge
 * remuxes. Falls back to a normal accurate seek for streams without usable
 * keyframe flags.
 */
export async function frameThumb(src: string, at: number, info: ProbeInfo, out: string): Promise<void> {
  const vf = [info.hdr ? TONEMAP : null, Math.abs(info.sar - 1) > 0.01 ? "scale=iw*sar:ih,setsar=1" : null, FIT]
    .filter(Boolean)
    .join(",");
  const ss = at.toFixed(2);
  const base = ["-hide_banner", "-loglevel", "error", "-nostdin"];
  const tail = ["-map", "0:v:0", "-an", "-sn", "-dn", "-vf", vf, ...OUT, out];
  const attempts: string[][] = [
    [...base, "-skip_frame", "nokey", "-noaccurate_seek", "-ss", ss, "-t", "60", "-i", src, ...tail],
    [...base, "-ss", ss, "-i", src, ...tail],
  ];
  if (info.hdr) {
    // zscale can choke on odd metadata; retry without tonemapping before giving up.
    const plainVf = vf.replace(TONEMAP + ",", "");
    attempts.push([...base, "-ss", ss, "-i", src, "-map", "0:v:0", "-an", "-sn", "-dn", "-vf", plainVf, ...OUT, out]);
  }
  // Index-less containers (.ts, some .avi/.flv) can seek past the only keyframe
  // and then decode nothing. Last resort: the very first frame.
  if (at > 0) attempts.push([...base, "-i", src, ...tail]);

  let lastErr: Error | null = null;
  for (const args of attempts) {
    try {
      fs.rmSync(out, { force: true });
      await run(FFMPEG, args, 45_000);
      if (fs.existsSync(out) && fs.statSync(out).size > 0) return;
      lastErr = new Error("ffmpeg produced no frame");
    } catch (e) {
      lastErr = e as Error;
    }
  }
  throw lastErr ?? new Error("ffmpeg failed");
}
