# Trade Journal

A trading journal with a calendar, performance charts, a score radar, drawdown, and an
activity heatmap. It runs two ways from the same code:

- **Desktop app** (Electron) — packaged `.exe` for Windows.
- **Website** (GitHub Pages) — open it in any browser, including on your phone.

All data is stored locally in the browser via `localStorage`, so it stays on your device.

## 🚀 Live Demo

**[Try it now: https://itsawolfee.github.io/Trade-Journal/](https://itsawolfee.github.io/Trade-Journal/)**

## ✨ Features

- 📅 **Calendar View** - Track trades by date
- 📊 **Performance Charts** - Visualize your trading performance
- 🎯 **Score Radar** - Multi-dimensional performance analysis
- 📉 **Drawdown Tracking** - Monitor risk and drawdowns
- 🔥 **Activity Heatmap** - See your trading patterns at a glance
- 💾 **Local Storage** - All data stays private on your device
- 📱 **Mobile Friendly** - Works on desktop, tablet, and phone

## Run the desktop app

```bash
npm install
npm run desktop
```

Build a portable Windows executable:

```bash
npm run build
```

## Use it as a website / on your phone

The app is a static site (entry point: `index.html`, which opens `HTML/dashboard.html`).

It is published automatically to GitHub Pages by
`.github/workflows/deploy-pages.yml` on every push to `main`.

One-time setup on GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions.**

After the first deploy, your site is available at:

```
https://<your-username>.github.io/<your-repo-name>/
```

Open that link on your phone and add it to your home screen for an app-like experience.

> Note: data is saved per-browser/per-device. Trades entered on your desktop will not
> automatically appear on your phone (and vice versa).
