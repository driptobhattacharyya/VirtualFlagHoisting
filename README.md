# Independence Day Flag Hoisting Application

## Overview
This application was created for Independence Day celebrations. It allows users to mimic the pulling of a thread in front of their laptop camera, which will hoist the Indian national flag on screen. When the flag reaches the top, a celebratory animation with fireworks will play.

## Features
- Hand gesture recognition using MediaPipe to detect pulling motion
- Realistic Indian flag with proper colors and proportions
- Ashoka Chakra in the center of the flag
- Wind simulation effect on the flag
- Fireworks celebration when the flag reaches the top
- Decorative elements and background
- Camera feed display for user guidance

## Requirements
- Python 3.6 or higher
- OpenCV
- MediaPipe
- Pygame
- NumPy

## Installation
1. Ensure you have Python installed
2. Install the required packages:
   ```
   pip install opencv-python mediapipe pygame numpy
   ```
3. Run the application:
   ```
   python main.py
   ```

## How to Use
1. Position yourself in front of your laptop camera
2. Make a pulling down motion with your hand to hoist the flag
3. Continue pulling until the flag reaches the top
4. Enjoy the celebration animation
5. Press 'X' to close the application when finished

## Technical Details
- The application uses MediaPipe's hand tracking to detect hand landmarks
- The index finger movement is tracked to detect pulling motion
- The flag follows the standard Indian tricolor design with proper proportions (3:2 ratio)
- The Ashoka Chakra is displayed in the center of the white stripe
- Fireworks are implemented using particle systems

## Credits
- Indian flag specifications from the official guidelines
- Ashoka Chakra image from Wikimedia Commons
- Background and decorative elements from open sources

## Web version

The same experience runs in the browser, as a static site in `public/` served
by Cloudflare Workers static assets at
<https://virtual-flag-hoisting.driptobhattacharyya.com>. `main.py` and the
desktop instructions above are unchanged.

- Hand tracking uses MediaPipe's `HandLandmarker` (`@mediapipe/tasks-vision`)
  with the same gesture as the desktop app: pinch thumb and index finger, then
  pull down. The video is processed in the browser and is never uploaded.
- Without a camera (or if permission is denied, or tracking fails to load) you
  hoist the flag by dragging the rope down repeatedly with the mouse or a
  finger, or by pressing the down arrow key.

### Local development

Requires Node.js 20 or newer.

```
npm install
npm run dev
```

Then open the address Wrangler prints (http://localhost:8787). Browsers only
allow camera access on `localhost` or over HTTPS.

Wrangler runs `npm run build` first (the `build.command` in `wrangler.jsonc`).
That step copies the MediaPipe JavaScript and WebAssembly files from
`node_modules` and downloads the hand landmarker model (checked against a
pinned SHA-256) into `public/vendor/`, and writes `public/js/vendor.js`, which
points at them. Both are generated and not committed, so the site serves all of
its own code. The vendor paths contain the package version and the model hash,
so they can be cached for a long time. If a verified model cannot be downloaded
at build time, the site loads it from Google's storage at runtime instead.

### Deployment

```
npx wrangler login
npm run deploy
```

`wrangler.jsonc` routes the Worker to the custom domain
`virtual-flag-hoisting.driptobhattacharyya.com`. The one prerequisite is that
the `driptobhattacharyya.com` zone is on the same Cloudflare account you log in
with; the custom-domain route then creates the DNS record and the certificate
automatically. `npm run check` validates the configuration and asset bundle
without deploying.

### Layout

- `public/index.html`, `public/styles.css` - page and start screen
- `public/js/game.js` - game states, flag, fireworks, canvas rendering
- `public/js/gesture.js`, `public/js/tracker.js` - pull detection and camera
- `public/js/config.js` - thresholds and other tunable constants
- `public/_headers` - security and caching headers
- `scripts/build.mjs` - fills `public/vendor/` and writes `public/js/vendor.js`
