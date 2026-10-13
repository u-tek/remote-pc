"""PC Monitor: disk space, uptime and a scratch note on your phone. No dependencies.

Run: python examples/pc_monitor.py   (with the Remote PC agent running on this PC)
"""
import os
import shutil
import sys
import threading
import time
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "python"))
from remote_pc import PhoneApp, ui  # noqa: E402

state = {"note": "", "unit": "GB", "started": time.time()}


def drives():
    if os.name == "nt":
        return [f"{d}:\\" for d in "CDEFGH" if os.path.exists(f"{d}:\\")]
    return ["/"]


def size(n):
    return f"{n / (1024 ** 3 if state['unit'] == 'GB' else 1024 ** 2):,.1f} {state['unit']}"


def home(app):
    disks = []
    for d in drives():
        u = shutil.disk_usage(d)
        disks.append(ui.progress(u.used / u.total, title=d, label=f"{size(u.free)} free of {size(u.total)}"))
    minutes = int((time.time() - state["started"]) / 60)
    return ui.screen("PC Monitor", [
        ui.section("Storage", disks),
        ui.section("Display", [ui.choice("Units", ["GB", "MB"], state["unit"], lambda u: state.update(unit=u), style="segmented")]),
        ui.section("This script", [ui.label("Running for", f"{minutes} min"), ui.label("Updated", datetime.now().strftime("%H:%M:%S"))]),
        ui.section("Note", [ui.field(None, state["note"], lambda t: state.update(note=t), placeholder="Write something for later", multiline=True)]),
    ], large_title=True, refresh=lambda: None)


app = PhoneApp("pc-monitor", "PC Monitor", home, icon=ui.icon("gauge.with.dots.needle.50percent", "green"))


def tick():
    while True:
        time.sleep(30)
        if app.viewers:
            app.update()


threading.Thread(target=tick, daemon=True).start()
print("PC Monitor is on your phone. Ctrl+C to stop.")
app.run()
