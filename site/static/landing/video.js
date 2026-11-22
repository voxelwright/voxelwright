// Video on the window screen. A hidden media element plays the file, sound and all,
// and is the clock: each frame the program copies whatever frame the element is
// showing into the picture, so the windows and the audio cannot drift apart, and
// pausing the element pauses both. The picture is the view's own shape (screen.js);
// the video is fitted into the band of the view where the city's windows are.
//
// A program repaints only when the element shows a new frame ('key'), so a paused or
// still-loading video costs no upload.

// The band of the view, top to bottom, where the windows are: above it is sky.
const BAND = [0.1, 0.98];

// Where a video of 'aspect' lands on a w × h picture: as tall as the band allows,
// unless that would lose more than 'crop' of its width off the sides. A wide view
// shows it whole; a tall phone crops a 4:3 picture's sides rather than shrinking it
// to a thin strip.
export function fitVideo(w, h, aspect, crop = 0.5) {
  const top = BAND[0] * h,
    tall = (BAND[1] - BAND[0]) * h;
  const height = Math.min(tall, w / (1 - crop) / aspect);
  const width = height * aspect;
  return { x: (w - width) / 2, y: top + (tall - height) / 2, width, height };
}

// 'cover' is how much of a pane's own look the video replaces (0 to 255), 'outside'
// what the panes beyond the video show (null keeps the city's own windows), and
// 'contrast' a lift around mid-grey, so a picture survives the haze and the glass.
export function videoProgram(media, { rows = 128, gain = 1.15, cover = 240, outside = null, crop = 0.5, contrast = 1 } = {}) {
  const curve = Uint8ClampedArray.from({ length: 256 }, (_, v) => (v - 128) * contrast + 128);
  let frames = 0;
  let canvas, ctx;
  let held = false,
    last = -1;
  const ready = () => media.readyState >= 2 && media.videoWidth > 0;
  // A new frame on screen: counted by requestVideoFrameCallback where there is one;
  // otherwise the element's time, which changes on every display frame while playing.
  const watch = "requestVideoFrameCallback" in media;
  let handle = 0;
  const tick = () => {
    frames++;
    handle = media.requestVideoFrameCallback(tick);
  };
  if (watch) handle = media.requestVideoFrameCallback(tick);
  // A seek lands a new frame too, even where the callback waits for the next paint.
  const seeked = () => frames++;
  media.addEventListener("seeked", seeked);
  return {
    // Stop counting frames and hold the last picture while the windows fade; the
    // element outlives the program.
    dispose() {
      if (watch) media.cancelVideoFrameCallback(handle);
      media.removeEventListener("seeked", seeked);
      held = true;
    },
    moving: true,
    rows,
    gain,
    key() {
      if (held) return last;
      last = !ready() ? -1 : watch ? frames : media.currentTime;
      return last;
    },
    draw(px, w, h) {
      if (!canvas || canvas.width !== w || canvas.height !== h) {
        canvas = typeof OffscreenCanvas === "function" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
        ctx = canvas.getContext("2d", { willReadFrequently: true, alpha: true });
        ctx.imageSmoothingQuality = "high";
      }
      ctx.clearRect(0, 0, w, h);
      if (outside) {
        ctx.fillStyle = `rgb(${outside[0]} ${outside[1]} ${outside[2]})`;
        ctx.fillRect(0, 0, w, h);
      }
      let at = null;
      if (ready()) {
        at = fitVideo(w, h, media.videoWidth / media.videoHeight, crop);
        ctx.drawImage(media, at.x, at.y, at.width, at.height);
      }
      const image = ctx.getImageData(0, 0, w, h).data;
      const [x0, y0, x1, y1] = at ? [at.x, at.y, at.x + at.width, at.y + at.height] : [0, 0, 0, 0];
      for (let y = 0, i = 0; y < h; y++) {
        const inY = y + 0.5 >= y0 && y + 0.5 <= y1;
        for (let x = 0; x < w; x++, i += 4) {
          const inside = inY && x + 0.5 >= x0 && x + 0.5 <= x1;
          px[i] = curve[image[i]];
          px[i + 1] = curve[image[i + 1]];
          px[i + 2] = curve[image[i + 2]];
          px[i + 3] = inside ? cover : outside ? outside[3] : 0;
          if (!inside && !outside) px[i] = px[i + 1] = px[i + 2] = 0;
        }
      }
    },
  };
}
