/*
 * widgets-py.js – Python-moduler som Python-fanen legger inn i Pyodide
 *
 * python.js skriver filene under inn i mappen /fargelab før Python starter.
 * Mappen ligger først i sys.path, så import ipywidgets og
 * from IPython.display import display finner disse filene:
 *
 *   ipywidgets.py         widgets (glidebrytere, knapper …), interact og display
 *   IPython/__init__.py   en liten IPython med bare display, clear_output og Image
 *   IPython/display.py
 *
 * Koden er vanlig Python i JavaScript-maler (backticks). Den kan derfor ikke
 * inneholde backticks, bakoverstreker eller dollartegn rett før krøllparentes.
 */
(function (root) {
  'use strict';

  root.FargelabPythonModuler = {
    'ipywidgets.py': `"""
ipywidgets – en liten utgave av ipywidgets for Fargelab

Widgets (glidebrytere, knapper, avkrysningsbokser …) vises under cellen eller
skriptet, og endringene går tilbake til Python mens siden er åpen. Navnene og
måten å bruke dem på er de samme som i ipywidgets, så koden virker også i
Google Colab og Jupyter. Bare en del av ipywidgets finnes her:

  IntSlider, FloatSlider, Checkbox, Dropdown, RadioButtons, Button, Text,
  Textarea, ColorPicker, Label, HBox, VBox, Output, Layout
  interact, interactive, interact_manual, fixed, display

Popup finnes bare i Fargelab: et lite vindu over siden med widgets i.

Eksempel:

    from ipywidgets import interact

    @interact(thresh=(0, 255))
    def vis(thresh=127):
        _, b = cv2.threshold(gray, thresh, 255, cv2.THRESH_BINARY)
        cv2.imshow("binær", b)
"""
import builtins as _b
import inspect
import itertools
import json
import numbers
import sys
import traceback

import _fargelab_bro
import _fargelab_hjelp

__version__ = "8.1.0+fargelab"
__all__ = [
    "Widget", "IntSlider", "FloatSlider", "Checkbox", "Dropdown", "RadioButtons", "Button",
    "Text", "Textarea", "ColorPicker", "Label", "Box", "HBox", "VBox", "Output", "Layout",
    "Popup", "interact", "interactive", "interact_manual", "fixed", "display",
]

_MISSING = object()
_ids = itertools.count(1)
_registry = {}   # id -> widget, så hendelser fra nettleseren finner riktig widget


def _send(op):
    # Utskrift som venter, sendes først, så rekkefølgen under cellen blir riktig
    sys.stdout.flush()
    sys.stderr.flush()
    _fargelab_bro.widget(json.dumps(op, default=str))


def _same(a, b):
    try:
        return bool(a == b)
    except Exception:
        return a is b


def _clamp(v, lo, hi):
    return lo if v < lo else hi if v > hi else v


def _print_exc(e):
    # Feilmelding uten linjene fra denne modulen, så den starter i koden din
    frames = [f for f in traceback.extract_tb(e.__traceback__) if f.filename != __file__]
    text = "Traceback (most recent call last):" + chr(10)
    text += "".join(traceback.format_list(frames))
    text += "".join(traceback.format_exception_only(type(e), e))
    print(text, end="", file=sys.stderr)


class Layout:
    """Godtas, så kode fra Colab virker, men utseendet styres av Fargelab."""

    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)


class _Trait:
    """En egenskap som sendes til nettleseren når den endres."""

    def __init__(self, default=None, coerce=None):
        self.default = default
        self.coerce = coerce

    def __set_name__(self, owner, name):
        self.name = name

    def __get__(self, obj, cls=None):
        if obj is None:
            return self
        return obj.__dict__.get(self.name, self.default)

    def __set__(self, obj, value):
        obj._set(self.name, value)


_bool = lambda self, v: bool(v)
_str = lambda self, v: "" if v is None else str(v)


class Widget:
    _kind = "Widget"
    _keys = ("description", "disabled")
    description = _Trait("", _str)
    disabled = _Trait(False, _bool)

    def __init__(self, description="", disabled=False, layout=None, style=None, **kwargs):
        d = self.__dict__
        d["_id"] = "w%d" % next(_ids)
        d["_observers"] = []
        d["_shown"] = False
        self.description = description
        self.disabled = disabled
        self.layout = layout or Layout()
        self.style = style
        d.update(kwargs)   # navn som ikke brukes her (for eksempel tooltip), lagres bare
        _registry[self._id] = self

    # --- egenskaper ---
    def _set(self, name, value, received=_MISSING):
        trait = getattr(type(self), name, None)
        if isinstance(trait, _Trait):
            if trait.coerce is not None:
                value = trait.coerce(self, value)
            old = self.__dict__.get(name, trait.default)
        else:
            old = self.__dict__.get(name)
        self.__dict__[name] = value
        if self.__dict__.get("_shown") and name in self._keys:
            wired = self._wire(name)
            # Kom verdien fra nettleseren, sendes den bare tilbake hvis den ble endret her
            if received is _MISSING or not _same(wired, received):
                _send({"op": "update", "id": self._id, "props": {name: wired}})
        if not _same(old, value):
            self._notify(name, old, value)
            self._after(name, old, value)

    def _after(self, name, old, new):
        pass

    def _wire(self, name):
        return getattr(self, name)

    def _from_frontend(self, value):
        self._set("value", value, received=value)

    # --- observe ---
    def observe(self, handler, names="value", type="change"):
        if isinstance(names, str):
            names = [names]
        self._observers.append((handler, set(names)))

    def unobserve(self, handler, names="value", type="change"):
        self._observers[:] = [(h, n) for h, n in self._observers if h is not handler]

    def _notify(self, name, old, new):
        change = {"name": name, "old": old, "new": new, "owner": self, "type": "change"}
        for handler, names in list(self._observers):
            if name in names:
                handler(change)

    # --- visning ---
    def _spec(self):
        self.__dict__["_shown"] = True
        return {"id": self._id, "kind": self._kind, "props": {k: self._wire(k) for k in self._keys}}

    def _ipython_display_(self):
        display(self)

    def close(self):
        _send({"op": "close", "id": self._id})
        _registry.pop(self._id, None)

    def __repr__(self):
        parts = []
        for k in self._keys:
            v = getattr(self, k)
            if k in ("disabled", "children", "options") or v in ("", None):
                continue
            parts.append("%s=%r" % (k, v))
        return "%s(%s)" % (type(self).__name__, ", ".join(parts))


class IntSlider(Widget):
    _kind = "IntSlider"
    _keys = Widget._keys + ("value", "min", "max", "step", "continuous_update", "readout", "readout_format")
    min = _Trait(0, lambda self, v: int(v))
    max = _Trait(100, lambda self, v: int(v))
    step = _Trait(1, lambda self, v: _b.max(1, int(v)))
    value = _Trait(0, lambda self, v: _clamp(int(round(v)), self.min, self.max))
    continuous_update = _Trait(True, _bool)
    readout = _Trait(True, _bool)
    readout_format = _Trait("d", _str)

    def __init__(self, value=0, min=0, max=100, step=1, continuous_update=True, readout=True, readout_format=None, **kwargs):
        super().__init__(**kwargs)
        self.min, self.max, self.step = min, max, step
        self.continuous_update, self.readout = continuous_update, readout
        if readout_format is not None:
            self.readout_format = readout_format
        self.value = value

    def _after(self, name, old, new):
        if name in ("min", "max"):
            self.value = self.value   # holder verdien innenfor de nye grensene


def _snap(v, lo, step):
    return round(lo + round((v - lo) / step) * step, 12)


class FloatSlider(IntSlider):
    _kind = "FloatSlider"
    min = _Trait(0.0, lambda self, v: float(v))
    max = _Trait(10.0, lambda self, v: float(v))
    step = _Trait(0.1, lambda self, v: float(v) if v else 0.1)
    value = _Trait(0.0, lambda self, v: _clamp(_snap(float(v), self.min, self.step), self.min, self.max))
    readout_format = _Trait(".2f", _str)

    def __init__(self, value=0.0, min=0.0, max=10.0, step=0.1, **kwargs):
        super().__init__(value=value, min=min, max=max, step=step, **kwargs)


class Checkbox(Widget):
    _kind = "Checkbox"
    _keys = Widget._keys + ("value",)
    value = _Trait(False, _bool)

    def __init__(self, value=False, indent=True, **kwargs):
        super().__init__(**kwargs)
        self.value = value


def _options(options):
    if isinstance(options, dict):
        return tuple((str(k), v) for k, v in options.items())
    out = []
    for o in options:
        if isinstance(o, (tuple, list)) and len(o) == 2 and isinstance(o[0], str):
            out.append((o[0], o[1]))
        else:
            out.append((str(o), o))
    return tuple(out)


class Dropdown(Widget):
    """Valgene kan være en liste, en liste med (tekst, verdi) eller en dict."""

    _kind = "Dropdown"
    _keys = Widget._keys + ("options", "index")
    options = _Trait((), lambda self, v: _options(v))
    index = _Trait(None, lambda self, v: None if v is None or not self.options else _clamp(int(v), 0, len(self.options) - 1))

    def __init__(self, options=(), value=_MISSING, index=_MISSING, label=_MISSING, **kwargs):
        super().__init__(**kwargs)
        self.options = options
        if value is not _MISSING:
            self.value = value
        elif label is not _MISSING:
            self.label = label
        elif index is not _MISSING:
            self.index = index
        else:
            self.index = 0 if self.options else None

    @property
    def value(self):
        return None if self.index is None else self.options[self.index][1]

    @value.setter
    def value(self, value):
        for i, (_, v) in enumerate(self.options):
            if v is value or _same(v, value):
                self.index = i
                return
        raise ValueError("%r er ikke et av valgene i %s" % (value, type(self).__name__))

    @property
    def label(self):
        return None if self.index is None else self.options[self.index][0]

    @label.setter
    def label(self, label):
        labels = [lab for lab, _ in self.options]
        if label not in labels:
            raise ValueError("%r er ikke et av valgene" % (label,))
        self.index = labels.index(label)

    def _wire(self, name):
        if name == "options":
            return [lab for lab, _ in self.options]
        return getattr(self, name)

    def _from_frontend(self, index):
        self._set("index", index, received=index)

    def _after(self, name, old, new):
        if name == "index":
            entry = lambda i: (None, None) if i is None or i >= len(self.options) else self.options[i]
            (old_label, old_value), (new_label, new_value) = entry(old), entry(new)
            self._notify("label", old_label, new_label)
            if not _same(old_value, new_value):
                self._notify("value", old_value, new_value)
        elif name == "options":
            if self.index is None or self.index >= len(self.options):
                self.index = 0 if self.options else None

    def __repr__(self):
        return "%s(options=%r, value=%r)" % (type(self).__name__, [lab for lab, _ in self.options], self.value)


class RadioButtons(Dropdown):
    _kind = "RadioButtons"


class Button(Widget):
    _kind = "Button"
    _keys = Widget._keys + ("button_style", "tooltip")
    button_style = _Trait("", _str)
    tooltip = _Trait("", _str)

    def __init__(self, button_style="", tooltip="", icon="", **kwargs):
        super().__init__(**kwargs)
        self.button_style, self.tooltip, self.icon = button_style, tooltip, icon
        self.__dict__["_clicks"] = []

    def on_click(self, callback, remove=False):
        if remove:
            self._clicks[:] = [c for c in self._clicks if c is not callback]
        else:
            self._clicks.append(callback)

    def click(self):
        for callback in list(self._clicks):
            callback(self)

    def _from_frontend(self, value):
        self.click()


class Text(Widget):
    _kind = "Text"
    _keys = Widget._keys + ("value", "placeholder", "continuous_update")
    value = _Trait("", _str)
    placeholder = _Trait("", _str)
    continuous_update = _Trait(True, _bool)

    def __init__(self, value="", placeholder="", continuous_update=True, **kwargs):
        super().__init__(**kwargs)
        self.placeholder, self.continuous_update = placeholder, continuous_update
        self.value = value


class Textarea(Text):
    _kind = "Textarea"


class ColorPicker(Widget):
    _kind = "ColorPicker"
    _keys = Widget._keys + ("value",)
    value = _Trait("black", _str)

    def __init__(self, value="black", concise=False, **kwargs):
        super().__init__(**kwargs)
        self.value = value


class Label(Widget):
    _kind = "Label"
    _keys = ("value",)
    value = _Trait("", _str)

    def __init__(self, value="", **kwargs):
        super().__init__(**kwargs)
        self.value = value


class Box(Widget):
    _kind = "VBox"
    _keys = ("children",)
    children = _Trait((), lambda self, v: tuple(v))

    def __init__(self, children=(), **kwargs):
        super().__init__(**kwargs)
        self.children = children

    def _wire(self, name):
        if name == "children":
            return [c._spec() for c in self.children]
        return getattr(self, name)


class VBox(Box):
    _kind = "VBox"


class HBox(Box):
    _kind = "HBox"


class Popup(Box):
    """
    Et lite vindu over siden med widgetene du gir det. Det legger seg ved siden
    av der du sist klikket. Popup finnes bare i Fargelab, ikke i Jupyter og Colab.

        vindu = Popup([IntSlider(description="B"), Button(description="OK")], title="Farge")
        vindu.show()    # åpner vinduet
        vindu.close()   # lukker det

    Lukker du vinduet med ×, Esc eller et klikk utenfor, blir open False, og
    vindu.observe(f, names="open") får vite det.
    """

    _kind = "Popup"
    _keys = ("children", "title", "open")
    title = _Trait("", _str)
    open = _Trait(False, _bool)

    def __init__(self, children=(), title="", **kwargs):
        super().__init__(children=children, **kwargs)
        self.title = title

    def show(self):
        # Første gang legges vinduet i utdataene der show() kalles, og åpnes derfra
        if not self._shown:
            display(self)
        self.open = True

    def close(self):
        self.open = False

    def _from_frontend(self, value):
        self._set("open", value, received=value)


class Output(Widget):
    """
    Et område for utdata. Det som skrives ut eller vises inne i en with-blokk,
    havner i området:

        ut = Output()
        display(ut)
        with ut:
            print("hei")
    """

    _kind = "Output"
    _keys = ()

    def __enter__(self):
        _send({"op": "target", "id": self._id})
        return self

    def __exit__(self, etype, evalue, tb):
        handled = False
        if etype is not None and issubclass(etype, Exception):
            _print_exc(evalue)   # feilen vises i området, som i Jupyter
            handled = True
        _send({"op": "untarget"})
        return handled

    def clear_output(self, wait=False):
        _send({"op": "clear", "id": self._id, "wait": bool(wait)})

    def append_stdout(self, text):
        with self:
            print(text, end="")

    def append_stderr(self, text):
        with self:
            print(text, end="", file=sys.stderr)

    def append_display_data(self, obj):
        with self:
            display(obj)


def display(*objs, **kwargs):
    """Viser widgets, matplotlib-figurer og andre verdier under cellen."""
    for obj in objs:
        if isinstance(obj, Widget):
            _send({"op": "display", "view": obj._spec()})
        elif hasattr(obj, "savefig") and hasattr(obj, "canvas"):
            _fargelab_hjelp.vis_figur(obj)
        elif callable(getattr(obj, "_repr_png_", None)):
            png = obj._repr_png_()
            if png:
                _fargelab_hjelp.send_png(png, type(obj).__name__)
        else:
            _send({"op": "text", "text": repr(obj)})


def clear_output(wait=False):
    """Tømmer utdataene under cellen (eller i Output-området du er inne i)."""
    _send({"op": "clear", "id": None, "wait": bool(wait)})


# --- interact ---
class fixed:
    """En verdi som sendes til funksjonen uendret, uten noen widget."""

    def __init__(self, value):
        self.value = value

    def __repr__(self):
        return "fixed(%r)" % (self.value,)


def _number(x):
    return isinstance(x, numbers.Real) and not isinstance(x, bool)


def _min_max(value):
    if value == 0:
        return value, value + 1
    if value > 0:
        return -value, 3 * value
    return 3 * value, -value


def _widget_for(name, abbrev, default):
    if isinstance(abbrev, (Widget, fixed)):
        return abbrev
    if isinstance(abbrev, bool):
        return Checkbox(value=abbrev, description=name)
    if isinstance(abbrev, numbers.Integral):
        lo, hi = _min_max(int(abbrev))
        return IntSlider(value=abbrev, min=lo, max=hi, description=name)
    if _number(abbrev):
        lo, hi = _min_max(float(abbrev))
        return FloatSlider(value=abbrev, min=lo, max=hi, step=(hi - lo) / 100, description=name)
    if isinstance(abbrev, str):
        return Text(value=abbrev, description=name)
    if isinstance(abbrev, tuple) and 2 <= len(abbrev) <= 3 and all(_number(x) for x in abbrev):
        lo, hi = abbrev[0], abbrev[1]
        if any(isinstance(x, float) for x in abbrev):
            step = float(abbrev[2]) if len(abbrev) == 3 else (hi - lo) / 100
            w = FloatSlider(min=lo, max=hi, step=step, description=name)
            middle = lo + (hi - lo) / 2
        else:
            step = int(abbrev[2]) if len(abbrev) == 3 else 1
            w = IntSlider(min=lo, max=hi, step=step, description=name)
            middle = lo + ((hi - lo) // 2 // step) * step
        w.value = default if _number(default) and lo <= default <= hi else middle
        return w
    if isinstance(abbrev, (dict, list, tuple)):
        w = Dropdown(options=abbrev, description=name)
        if default is not _MISSING:
            try:
                w.value = default
            except ValueError:
                pass
        return w
    raise ValueError(
        "interact forstår ikke %s=%r. Bruk for eksempel %s=(0, 255), %s=True, en liste eller en widget."
        % (name, abbrev, name, name))


class interactive(VBox):
    """Widgets for argumentene til en funksjon, og et område for det funksjonen viser."""

    def __init__(self, __interact_f, __options={}, **kwargs):
        f = __interact_f
        manual = __options.get("manual", False)
        controls = {}
        params = inspect.signature(f).parameters
        for name, p in params.items():
            if p.kind in (p.VAR_POSITIONAL, p.VAR_KEYWORD):
                continue
            default = _MISSING if p.default is p.empty else p.default
            if name in kwargs:
                controls[name] = _widget_for(name, kwargs[name], default)
            elif default is not _MISSING:
                controls[name] = _widget_for(name, default, default)
            else:
                raise ValueError("Gi interact en verdi for %s, for eksempel %s=(0, 255)." % (name, name))
        for name in kwargs:
            if name not in controls:
                controls[name] = _widget_for(name, kwargs[name], _MISSING)

        self.__dict__.update(f=f, result=None, kwargs_widgets=list(controls.values()))
        self.__dict__["_controls"] = controls
        self.__dict__["out"] = Output()
        widgets = [w for w in controls.values() if isinstance(w, Widget)]
        children = list(widgets)
        if manual:
            for w in widgets:
                if hasattr(w, "continuous_update"):
                    w.continuous_update = False
            button = Button(description=__options.get("manual_name", "Kjør"), button_style="primary")
            button.on_click(lambda b: self.update())
            children.append(button)
        else:
            for w in widgets:
                w.observe(self.update, names="value")
        super().__init__(children=children + [self.out])
        if not manual:
            self.update()

    @property
    def kwargs(self):
        return {name: w.value for name, w in self._controls.items()}

    def update(self, *args):
        with self.out:
            self.out.clear_output(wait=True)
            try:
                self.__dict__["result"] = self.f(**self.kwargs)
                if self.result is not None:
                    display(self.result)
                _fargelab_hjelp.vis_figurer()
            except Exception as e:
                _print_exc(e)


def interact(__interact_f=None, **kwargs):
    """
    Lager widgets for argumentene og kjører funksjonen hver gang en endres:

        @interact(x=(0, 10), farge=["rød", "grønn"], vis=True)
        def f(x, farge, vis): ...
    """
    if __interact_f is None:
        return lambda f: interact(f, **kwargs)
    display(interactive(__interact_f, **kwargs))
    return __interact_f


def interact_manual(__interact_f=None, **kwargs):
    """Som interact, men funksjonen kjører bare når du trykker på Kjør."""
    if __interact_f is None:
        return lambda f: interact_manual(f, **kwargs)
    display(interactive(__interact_f, {"manual": True}, **kwargs))
    return __interact_f


def _event(widget_id, kind, value=None):
    """Kalles når du endrer en widget i nettleseren."""
    w = _registry.get(widget_id)
    if w is None:
        return
    if kind == "click":
        w.click()
    else:
        w._from_frontend(value)
`,
    'IPython/__init__.py': `"""En liten erstatning for IPython i Fargelab. Bare IPython.display finnes."""
from .display import display, clear_output, Image
`,
    'IPython/display.py': `"""display, clear_output og Image, som i Jupyter og Colab."""
from ipywidgets import display, clear_output


class Image:
    """Et bilde fra en fil eller fra bytes, vist med display(Image("navn.png"))."""

    def __init__(self, data=None, filename=None, **kwargs):
        if filename is None and isinstance(data, str):
            filename, data = data, None
        if filename is not None:
            with open(filename, "rb") as f:
                data = f.read()
        self.data = data
        self.filename = filename

    def _repr_png_(self):
        if self.data[:8] == bytes([137, 80, 78, 71, 13, 10, 26, 10]):
            return self.data
        # Andre formater (JPEG osv.) gjøres om til PNG med OpenCV
        import cv2
        import numpy as np
        img = cv2.imdecode(np.frombuffer(self.data, np.uint8), cv2.IMREAD_UNCHANGED)
        ok, png = cv2.imencode(".png", img)
        return png.tobytes() if ok else None
`
  };
})(typeof self !== 'undefined' ? self : this);
