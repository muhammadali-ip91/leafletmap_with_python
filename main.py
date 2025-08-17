from cefpython3 import cefpython as cef
import tkinter as tk
import sys
import os
import platform
import time
from style import style
import json 
from tkinter import filedialog, colorchooser
import threading

# Windows-specific imports
if platform.system() == "Windows":
    import ctypes
    from ctypes import wintypes

# Offline elevation (optional). Configure DEM_PATH to enable.
DEM_PATH = r"C:\\data\\dem.tif"  # Set this to your DEM GeoTIFF or VRT path
_elev_ds = None
_elev_transformer = None
_elev_available = False
try:
    import rasterio  # type: ignore
    import numpy as np  # type: ignore
    from pyproj import Transformer  # type: ignore
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
    """Return elevations for given JSON points list [{lat,lng},...] using local DEM."""
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
        vals = list(_elev_ds.sample(zip(xs, ys)))  # nearest neighbour
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

    root = tk.Tk()
    root.geometry("900x750")
    root.title("Tkinter + cefpython + Leaflet")

    map_frame = tk.Frame(root, width=950, height=750)
    map_frame.pack(fill=tk.BOTH, expand=True)

    cef.Initialize()

    def get_map_frame_dimensions():
        width = map_frame.winfo_width()
        height = map_frame.winfo_height()
        return width, height

    def resize_browser_window(browser, x, y, width, height):
        if platform.system() == "Windows":
            try:
                window_handle = browser.GetWindowHandle()
                if window_handle:
                    ctypes.windll.user32.SetWindowPos(
                        window_handle, 0,
                        x, y, width, height,
                        0x0040  # SWP_SHOWWINDOW
                    )
            except Exception as e:
                print(f"Error resizing browser: {e}")

    def create_browser():
        """Create CEF browser as a child window, bind JS first, then load the map."""
        global browser
        map_frame.update()
        width, height = get_map_frame_dimensions()
        if width > 0 and height > 0:
            menu_width = 1
            browser_x = menu_width + 3
            browser_width = width - browser_x
            window_info = cef.WindowInfo()
            window_info.SetAsChild(map_frame.winfo_id(), [browser_x, 0, browser_x + browser_width, height])

            # Create hidden/blank first
            browser_local = cef.CreateBrowserSync(window_info, url="about:blank")

            # Bindings BEFORE loading the real page
            bindings = cef.JavascriptBindings(bindToFrames=False, bindToPopups=False)
            bindings.SetObject("cefPythonBindings", JSBindings(browser_local, root))
            browser_local.SetJavascriptBindings(bindings)

            # Now load the actual map html
            map_path = os.path.abspath(style.map_path1).replace("\\", "/")
            browser_local.LoadUrl("file:///" + map_path)

            browser = browser_local
            return browser_local
        return None

    class JSBindings:
        def __init__(self, browser_instance, tk_root):
            self.browser = browser_instance
            self.tk_root = tk_root
            
        def saveShapesToFile(self, json_str, file_path):
            print("saveShapesToFile called!")
            print("File path:", file_path)
            try:
                with open(file_path, "w", encoding="utf-8") as f:
                    f.write(json_str)
                print("File saved successfully.")
            except Exception as e:
                print("Error saving file:", e)
                
        def openColorPicker(self, current_color="#3388ff"):
            def show_color_picker():
                try:
                    # Convert hex color to RGB tuple for initial color
                    if isinstance(current_color, str) and current_color.startswith('#') and len(current_color) == 7:
                        hex_color = current_color[1:]
                        rgb = tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))
                    else:
                        rgb = (51, 136, 255)  # Default blue color
                    # Open color chooser dialog on Tk main thread
                    color = colorchooser.askcolor(color=rgb, title="Choose Shape Color")
                    if color and color[1]:
                        selected_color = color[1]
                        # Post to CEF UI thread
                        try:
                            cef.PostTask(cef.TID_UI, lambda: (
                                self.browser and self.browser.GetMainFrame().ExecuteFunction("changeShapeColor", selected_color)
                            ))
                        except Exception as e:
                            print(f"JS call changeShapeColor failed: {e}")
                except Exception as e:
                    print(f"Error in color picker: {e}")
            # Ensure dialog runs on Tk main loop
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

    # JS bindings class defined; now create browser
    browser = create_browser()
    
    def update_browser_position():
        global browser
        if browser:
            width, height = get_map_frame_dimensions()
            menu_width = menu_bar_frame.winfo_width()
            browser_x = menu_width + 3
            browser_width = width - browser_x
            if browser_width > 0 and height > 0:
                resize_browser_window(browser, browser_x, 0, browser_width, height)

    resize_pending = [False]

    def on_frame_configure(event=None):
        if not resize_pending[0]:
            resize_pending[0] = True
            root.after(100, lambda: (
                update_browser_position(),
                resize_pending.__setitem__(0, False)
            ))

    map_frame.bind("<Configure>", on_frame_configure)


    

    # JS bindings are set in create_browser() before loading the map

    # Menu bar
    
    menu_bar_frame = tk.Frame(map_frame, bg=style.menu_bar_frame_colour)
    menu_bar_frame.pack(side=tk.LEFT, fill=tk.Y, padx=3, pady=4)
    menu_bar_frame.pack_propagate(False)
    menu_bar_frame.configure(width=1)

    close_btn_icon = tk.PhotoImage(file=style.close_icon_image)
    toggle_icon = tk.PhotoImage(file=style.toggle_icon_image)

    def extending_animation():
        current_width = menu_bar_frame.winfo_width()
        if current_width < 171:
            current_width += 10
            menu_bar_frame.config(width=current_width)
            update_browser_position()
            map_frame.after(8, extending_animation)
        else:
            update_browser_position()

    def extend_menu_bar():
        extending_animation()
        toggle_icon_btn.configure(image=close_btn_icon)
        toggle_icon_btn.configure(command=fold_menu_bar)

    def folding_animation():
        current_width = menu_bar_frame.winfo_width()
        if current_width > 1:
            current_width -= 10
            menu_bar_frame.config(width=current_width)
            update_browser_position()
            map_frame.after(8, folding_animation)
        else:
            update_browser_position()

    def fold_menu_bar():
        folding_animation()
        toggle_icon_btn.configure(image=toggle_icon)
        toggle_icon_btn.configure(command=extend_menu_bar)

    toggle_icon_btn = tk.Button(
        root, image=toggle_icon, bg=style.menu_bar_frame_colour,
        activebackground=style.menu_bar_frame_colour, relief=tk.FLAT, bd=0,
        command=extend_menu_bar
    )
    toggle_icon_btn.place(x=4, y=10)

    def deselect():
        pin_btn.configure(bg=style.menu_bar_frame_colour)
        pin_btn.configure(command=pin_marker)
        if browser:
            browser.ExecuteFunction("togglePinMode")

    def pin_marker():
        pin_btn.configure(bg='yellow')
        pin_btn.configure(command=deselect)
        if browser:
            browser.ExecuteFunction("togglePinMode")

    pin_btn = tk.Button(menu_bar_frame, text='Pin Marker', font=style.btn_font,bg=style.menu_bar_frame_colour, activebackground=style.menu_bar_frame_colour,relief=tk.RAISED, bd=3,command=pin_marker)
    pin_btn.place(x=10, y=50,width=140)

    # languages = ["Python", "JavaScript", "Java", "Swift", "GoLang", "C#", "C++", "Scala"]
    # selected_lang = tk.StringVar()
    # selected_lang.set("Select")

    # def option_changed(value):
    #     print("You selected:", value)

    # option_menu = tk.OptionMenu(menu_bar_frame, selected_lang, *languages, command=option_changed)
    # option_menu.configure(font=("Arial", 14, "bold"),bg=style.menu_bar_frame_colour,activebackground="yellow",relief=tk.RAISED,bd=3,highlightthickness=0)
    # option_menu.place(x=10, y=100, width=140)

    # def deselect_language():
    #     selected_lang.set("Select")
    def deselect_item():
        if browser:
            browser.ExecuteFunction("deselect")


    deselect_btn = tk.Button(menu_bar_frame, text='Deselect', font=style.btn_font,bg=style.menu_bar_frame_colour, activebackground=style.menu_bar_frame_colour,relief=tk.RAISED, bd=3,command=deselect_item)
    deselect_btn.place(x=10, y=100,width=140)

    def export_shapes():
        file_path = filedialog.asksaveasfilename(
            defaultextension=".json",
            filetypes=[("JSON files", "*.json")],
            title="Export Shapes"
        )
        if file_path:
            browser.ExecuteFunction("exportShapes", file_path)

    export_btn = tk.Button(menu_bar_frame, text='Export', font=style.btn_font,bg=style.menu_bar_frame_colour, activebackground=style.menu_bar_frame_colour,relief=tk.RAISED, bd=3,command=export_shapes)
    export_btn.place(x=10, y=150,width=140)

    def import_shapes():
        file_path = filedialog.askopenfilename(
            filetypes=[("JSON files", "*.json")],
            title="Import Shapes"
        )
        if file_path:
            with open(file_path, "r", encoding="utf-8") as f:
                json_str = f.read()
            browser.ExecuteFunction("importShapes", json_str)

    import_btn = tk.Button(menu_bar_frame, text='Import', font=style.btn_font,bg=style.menu_bar_frame_colour, activebackground=style.menu_bar_frame_colour,relief=tk.RAISED, bd=3,command=import_shapes)
    import_btn.place(x=10, y=200,width=140)

    # remove_btn = tk.Button(menu_bar_frame, text='Remove', font=style.btn_font,bg=style.menu_bar_frame_colour, activebackground=style.menu_bar_frame_colour,relief=tk.RAISED, bd=3)
    # remove_btn.place(x=10, y=300,width=140)

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
    root.after(10, loop_cef)
    root.protocol("WM_DELETE_WINDOW", on_closing)
    root.mainloop()

if __name__ == '__main__':
    main()
