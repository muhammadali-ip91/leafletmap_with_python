from cefpython3 import cefpython as cef
import customtkinter as ctk
import tkinter as tk  
import sys
import os
import platform
import time
from style import style
import json
from tkinter import filedialog, colorchooser
import threading
try:
    from PIL import Image
    _pil_available = True
except Exception:
    _pil_available = False

if platform.system() == "Windows":
    import ctypes
    from ctypes import wintypes

DEM_PATH = r"C:\\data\\dem.tif" 
_elev_transformer = None
_elev_available = False
try:
    import rasterio
    import numpy as np
    from pyproj import Transformer
    _elev_available = True
except Exception as _elev_err:
    print(f"[Elevation] rasterio/pyproj not available: {_elev_err}")
    _elev_available = False


def _elev_ensure_open():
    global _elev_ds, _elev_transformer, _elev_available
    if not _elev_available:
        return False
    if _elev_ds is None:
        try:
            _elev_ds = rasterio.open(DEM_PATH)
            _elev_transformer = Transformer.from_crs("EPSG:4326", _elev_ds.crs, always_xy=True)
            print(f"[Elevation] DEM opened: {DEM_PATH}")
        except Exception as e:
            print(f"[Elevation] Failed to open DEM {DEM_PATH}: {e}")
            _elev_available = False
            return False
    return True


def sample_elevations(points_json: str) -> str:
    try:
        pts = json.loads(points_json)
        if not isinstance(pts, list):
            raise ValueError("Input must be a list")
    except Exception as e:
        return json.dumps({"elevations": [], "error": f"bad_input: {e}"})

    if not _elev_ensure_open():
        return json.dumps({"elevations": [None]*len(pts), "error": "dem_unavailable"})

    lons = [p.get("lng") for p in pts]
    lats = [p.get("lat") for p in pts]
    try:
        xs, ys = _elev_transformer.transform(lons, lats)
        vals = list(_elev_ds.sample(zip(xs, ys)))
    except Exception as e:
        return json.dumps({"elevations": [None]*len(pts), "error": f"sample_failed: {e}"})

    nodata = _elev_ds.nodata
    out = []
    for v in vals:
        z = None
        if v is not None and len(v):
            z = float(v[0])
            if nodata is not None and z == nodata:
                z = None
            if z is not None and (z != z or z in (float('inf'), float('-inf'))):
                z = None
        out.append(z)
    return json.dumps({"elevations": out})


# Declare global browser
browser = None


def main():
    global browser
    sys.excepthook = cef.ExceptHook

    ctk.set_appearance_mode("dark")
    ctk.set_default_color_theme("blue")

    root = ctk.CTk()
    root.geometry("900x750")
    root.title("CustomTkinter + cefpython + Leaflet")

    map_frame = ctk.CTkFrame(root, width=950, height=750, corner_radius=0)
    map_frame.pack(fill="both", expand=True)

    cef.Initialize()

    def get_map_frame_dimensions():
        return map_frame.winfo_width(), map_frame.winfo_height()

    def resize_browser_window(browser, x, y, width, height):
        if platform.system() == "Windows":
            try:
                window_handle = browser.GetWindowHandle()
                if window_handle:
                    ctypes.windll.user32.SetWindowPos(
                        window_handle, 0,
                        x, y, width, height,
                        0x0040
                    )
            except Exception as e:
                print(f"Error resizing browser: {e}")

    class JSBindings:
        def __init__(self, browser_instance, tk_root):
            self.browser = browser_instance
            self.tk_root = tk_root

        def saveShapesToFile(self, json_str, file_path):
            try:
                with open(file_path, "w", encoding="utf-8") as f:
                    f.write(json_str)
                print("File saved successfully.")
            except Exception as e:
                print("Error saving file:", e)

        def openColorPicker(self, current_color="#3388ff"):
            def show_color_picker():
                try:
                    if isinstance(current_color, str) and current_color.startswith('#') and len(current_color) == 7:
                        hex_color = current_color[1:]
                        rgb = tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))
                    else:
                        rgb = (51, 136, 255)
                    color = colorchooser.askcolor(color=rgb, title="Choose Shape Color")
                    if color and color[1]:
                        selected_color = color[1]
                        cef.PostTask(cef.TID_UI, lambda: (
                            self.browser and self.browser.GetMainFrame().ExecuteFunction("changeShapeColor", selected_color)
                        ))
                except Exception as e:
                    print(f"Error in color picker: {e}")

            try:
                if self.tk_root and self.tk_root.winfo_exists():
                    self.tk_root.after(0, show_color_picker)
            except Exception as e:
                print(f"Failed to schedule color picker: {e}")

        def getElevations(self, points_json):
            try:
                return sample_elevations(points_json)
            except Exception as e:
                return json.dumps({"elevations": [], "error": f"exception: {e}"})


    def create_browser():
        global browser
        map_frame.update()
        width, height = get_map_frame_dimensions()
        if width > 0 and height > 0:
            menu_width = 1
            browser_x = menu_width + 3
            browser_width = width - browser_x
            window_info = cef.WindowInfo()
            window_info.SetAsChild(map_frame.winfo_id(), [browser_x, 0, browser_x + browser_width, height])

            browser_local = cef.CreateBrowserSync(window_info, url="about:blank")
            bindings = cef.JavascriptBindings(bindToFrames=False, bindToPopups=False)
            bindings.SetObject("cefPythonBindings", JSBindings(browser_local, root))
            browser_local.SetJavascriptBindings(bindings)

            map_path = os.path.abspath(style.map_path1).replace("\\", "/")
            browser_local.LoadUrl("file:///" + map_path)

            browser = browser_local
            return browser_local
        return None

    browser = create_browser()

    # Menu bar
    menu_bar_frame = ctk.CTkFrame(map_frame, fg_color=style.menu_bar_frame_colour, corner_radius=0)
    menu_bar_frame.pack(side="left", fill="y", padx=3, pady=4)
    menu_bar_frame.pack_propagate(False)
    menu_bar_frame.configure(width=1)

    # Prefer CTkImage for HiDPI scaling; fallback to tkinter.PhotoImage if Pillow is unavailable
    if _pil_available:
        try:
            close_icon_img = ctk.CTkImage(Image.open(style.close_icon_image), size=(24, 24))
            toggle_icon_img = ctk.CTkImage(Image.open(style.toggle_icon_image), size=(24, 24))
        except Exception:
            close_icon_img = None
            toggle_icon_img = None
    else:
        close_icon_img = None
        toggle_icon_img = None

    if close_icon_img is None or toggle_icon_img is None:
        # Fallback images (no HiDPI scaling, may show a warning)
        close_btn_icon = tk.PhotoImage(file=style.close_icon_image)
        toggle_icon = tk.PhotoImage(file=style.toggle_icon_image)
    else:
        close_btn_icon = close_icon_img
        toggle_icon = toggle_icon_img

    def update_browser_position():
        global browser
        if browser:
            width, height = get_map_frame_dimensions()
            menu_width = menu_bar_frame.winfo_width()
            browser_x = menu_width + 3
            browser_width = width - browser_x
            if browser_width > 0 and height > 0:
                resize_browser_window(browser, browser_x, 0, browser_width, height)

    def extend_menu_bar():
        # Instant expand without animation
        menu_bar_frame.configure(width=171)
        update_browser_position()
        toggle_icon_btn.configure(image=close_btn_icon, command=fold_menu_bar)

    def fold_menu_bar():
        # Instant collapse without animation
        menu_bar_frame.configure(width=1)
        update_browser_position()
        toggle_icon_btn.configure(image=toggle_icon, command=extend_menu_bar)

    toggle_icon_btn = ctk.CTkButton(
        root, image=toggle_icon, text="",
        fg_color=style.menu_bar_frame_colour, hover_color="gray",
        text_color="black",
        command=extend_menu_bar, width=30, height=30, corner_radius=5
    )
    toggle_icon_btn.place(x=4, y=10)

    def deselect():
        pin_btn.configure(fg_color="blue", command=pin_marker)
        if browser:
            browser.ExecuteFunction("togglePinMode")

    def pin_marker():
        pin_btn.configure(fg_color="yellow", command=deselect)
        if browser:
            browser.ExecuteFunction("togglePinMode")

    pin_btn = ctk.CTkButton(
        menu_bar_frame,
        text="Pin Marker",
        font=style.btn_font,
        fg_color="blue",
        hover_color="gray",
    text_color="black",
        command=pin_marker,
        corner_radius=5,
        width=140,
    )
    pin_btn.place(x=10, y=50)

    def deselect_item():
        if browser:
            browser.ExecuteFunction("deselect")

    deselect_btn = ctk.CTkButton(
        menu_bar_frame,
        text="Deselect",
        font=style.btn_font,
        fg_color="blue",
        hover_color="gray",
    text_color="black",
        command=deselect_item,
        corner_radius=5,
        width=140,
    )
    deselect_btn.place(x=10, y=100)

    def export_shapes():
        file_path = filedialog.asksaveasfilename(
            defaultextension=".json",
            filetypes=[("JSON files", "*.json")],
            title="Export Shapes"
        )
        if file_path:
            browser.ExecuteFunction("exportShapes", file_path)

    export_btn = ctk.CTkButton(
        menu_bar_frame,
        text="Export",
        font=style.btn_font,
        fg_color="blue",
        hover_color="gray",
    text_color="black",
        command=export_shapes,
        corner_radius=5,
        width=140,
    )
    export_btn.place(x=10, y=150)

    def import_shapes():
        file_path = filedialog.askopenfilename(
            filetypes=[("JSON files", "*.json")],
            title="Import Shapes"
        )
        if file_path:
            with open(file_path, "r", encoding="utf-8") as f:
                json_str = f.read()
            browser.ExecuteFunction("importShapes", json_str)

    import_btn = ctk.CTkButton(
        menu_bar_frame,
        text="Import",
        font=style.btn_font,
        fg_color="blue",
        hover_color="gray",
    text_color="black",
        command=import_shapes,
        corner_radius=5,
        width=140,
    )
    import_btn.place(x=10, y=200)

    def on_closing():
        global browser
        if browser:
            browser.CloseBrowser(True)
            browser = None
            time.sleep(0.1)
        root.after(100, shutdown_cef)

    def shutdown_cef():
        cef.Shutdown()
        root.quit()

    def loop_cef():
        cef.MessageLoopWork()
        root.after(10, loop_cef)

    toggle_icon_btn.tkraise()
    # Keep browser sized on widget/window resizes
    def _on_map_frame_configure(event):
        update_browser_position()
    map_frame.bind("<Configure>", _on_map_frame_configure)
    root.bind("<Configure>", _on_map_frame_configure)

    # Ensure final geometry applied before first CEF tick
    root.after(50, update_browser_position)
    root.after(10, loop_cef)
    root.protocol("WM_DELETE_WINDOW", on_closing)
    root.mainloop()


if __name__ == "__main__":
    main()
