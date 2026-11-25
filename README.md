# 🏁 PIT WALL // SYNC

**Formula 1-Inspired Squad Timetable & Meeting Window Synchronizer built for HBTU Kanpur.**

`PIT WALL // SYNC` helps student teams, hackathon squads, and project groups find overlapping free hours across weekly class schedules, simulate availability by benching drivers, import official HBTU timetables via AI or PDF parsing, and dispatch locked meeting slots in one click.

---

## ✨ Key Features

### 1. Minimalistic F1 Telemetry Interface
* **Circuit-Framed Header:** Features a custom SVG closed-loop F1 track surrounding the `PIT WALL // SYNC` title with FIA apex kerbs, a checkered start/finish gantry, DRS zone indicator, and an animated telemetry car orbiting the circuit.
* **Live Telemetry Bar:** Displays real-time system status, HBTU Kanpur header telemetry, and live backend AI engine readiness (`GET /api/ai/status`).
* **Dark & Light Telemetry Themes:** One-click switch between matte obsidian dark mode (`#090A0D`) and clean light mode (`#F4F5F7`) with `localStorage` persistence.

### 2. Driver Roster & Squad Simulation
* **Multi-Driver Management:** Add team members ("Drivers") with distinct telemetry color coding and live weekly busy-hour counters (`00H`).
* **Bench / Activate Toggle (Eye Icon):** Temporarily exclude a team member from overlap calculations to simulate a smaller subgroup without deleting their schedule.
* **Demo Squad Loader:** Load a pre-configured 4-driver HBTU squad (`Pranjal`, `Aarav`, `Diya`, `Kabir`) to test clash heatmaps and pit windows immediately.

### 3. Dual-Mode Track Map (Monday – Saturday, 08:00 – 20:00)
* **Qualifying Mode (Individual Edit):**
  * Click or drag across hourly cells to paint (`PAINT BUSY`) or erase (`ERASE BUSY`) lectures and labs for the selected driver.
  * Click any day header (`MON–SAT`) or hour header (`08:00–19:00`) to batch-toggle an entire row or column, or use `CLEAR` / `ALL BUSY` for quick resets.
* **Race Telemetry Mode (Combined Squad Heatmap):**
  * Overlays all active drivers onto a single track map with F1 flag indicators:
    * 🟢 **Clear Track (`0 BUSY`):** Everyone is free.
    * 🟡 **Yellow Flag (`1 BUSY`):** Single-member clash.
    * 🔴 **Red Flag (`2+ BUSY`):** Multiple schedule conflicts.
  * Click any clear cell directly on the heatmap to lock a 1-hour pit window.
* **Sector Inspect & Undo:** Hover over any slot for an instant breakdown of who is free vs. busy, with 6-second `UNDO` support on destructive actions.

### 4. Dual-Engine HBTU Timetable Importer
* **AI Smart Read (`POST /api/ai/read-timetable`):**
  * Upload any timetable PDF, screenshot, or photo (`PNG`, `JPG`, `WEBP` up to 20 MB).
  * Automatically converts PDF pages to high-resolution images in-browser via `pdfjs-dist` and sends them to the configured OpenAI-compatible vision endpoint.
  * Understands HBTU period timings (`10:00–16:50` + lunch break), merges consecutive lab blocks, flags inferred periods as `GUESSED` for review, and maps classes onto
  
