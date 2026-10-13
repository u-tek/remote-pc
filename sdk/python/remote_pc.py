"""Remote PC SDK for Python (3.8+, no dependencies): put your program on the iPhone as a native app.

    from remote_pc import PhoneApp, ui

    state = {"on": False}

    def home(app):
        return ui.screen("Lights", [
            ui.toggle("Desk lamp", state["on"], lambda on: state.update(on=on)),
        ])

    PhoneApp("lights", "Lights", home, icon=ui.icon("lightbulb.fill", "yellow")).run()

Protocol: ../PROTOCOL.md
"""
from __future__ import annotations

import base64
import inspect
import json
import os
import re
import socket
import struct
import threading
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional
from urllib.parse import quote, urlparse

PROTOCOL_VERSION = 1

__all__ = ["PhoneApp", "ui", "discover", "PROTOCOL_VERSION"]


def discover() -> Dict[str, str]:
    """Where the agent says how to reach it (sdk.json, written by the agent on start)."""
    url, token = os.environ.get("REMOTE_PC_SDK_URL"), os.environ.get("REMOTE_PC_SDK_TOKEN")
    if url and token:
        return {"url": url, "token": token}
    if os.environ.get("REMOTE_PC_HOME"):
        folder = Path(os.environ["REMOTE_PC_HOME"])
    elif os.name == "nt":
        folder = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming")) / "RemotePC"
    else:
        folder = Path.home() / ".config" / "remote-pc"
    path = folder / "sdk.json"
    try:
        info = json.loads(path.read_text(encoding="utf-8"))
    except OSError as err:
        raise RuntimeError(f"Remote PC agent not found ({path} is missing). Start the agent, or set REMOTE_PC_SDK_URL and REMOTE_PC_SDK_TOKEN.") from err
    return {"url": info["url"], "token": info["token"]}


# ----------------------------------------------------------------------------------------------
# A small WebSocket client (RFC 6455, text frames, client masking) so the SDK needs nothing else.


class _WebSocket:
    def __init__(self, url: str, timeout: float = 10):
        u = urlparse(url)
        if u.scheme != "ws":
            raise ValueError("Only ws:// URLs are supported (the agent listens on 127.0.0.1)")
        self.sock = socket.create_connection((u.hostname, u.port or 80), timeout=timeout)
        key = base64.b64encode(os.urandom(16)).decode()
        path = (u.path or "/") + (f"?{u.query}" if u.query else "")
        request = (
            f"GET {path} HTTP/1.1\r\nHost: {u.hostname}:{u.port or 80}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
        )
        self.sock.sendall(request.encode())
        response = b""
        while b"\r\n\r\n" not in response:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise ConnectionError("The agent closed the connection")
            response += chunk
        head, self._buffer = response.split(b"\r\n\r\n", 1)
        status = head.split(b"\r\n", 1)[0]
        if b" 101 " not in status:
            raise ConnectionError(f"The agent refused the connection: {status.decode(errors='replace')}")
        self.sock.settimeout(None)
        self._lock = threading.Lock()

    def _read(self, n: int) -> bytes:
        while len(self._buffer) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise ConnectionError("connection closed")
            self._buffer += chunk
        out, self._buffer = self._buffer[:n], self._buffer[n:]
        return out

    def _frame(self, opcode: int, payload: bytes) -> None:
        header = bytearray([0x80 | opcode])
        n = len(payload)
        if n < 126:
            header.append(0x80 | n)
        elif n < 65536:
            header.append(0x80 | 126)
            header += struct.pack(">H", n)
        else:
            header.append(0x80 | 127)
            header += struct.pack(">Q", n)
        mask = os.urandom(4)
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        with self._lock:
            self.sock.sendall(bytes(header) + mask + masked)

    def send(self, text: str) -> None:
        self._frame(0x1, text.encode("utf-8"))

    def recv(self) -> Optional[str]:
        """Next text message, or None when the connection closes."""
        message = b""
        while True:
            b1, b2 = self._read(2)
            fin, opcode = b1 & 0x80, b1 & 0x0F
            n = b2 & 0x7F
            if n == 126:
                n = struct.unpack(">H", self._read(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", self._read(8))[0]
            if b2 & 0x80:
                mask = self._read(4)
                payload = bytes(b ^ mask[i % 4] for i, b in enumerate(self._read(n)))
            else:
                payload = self._read(n)
            if opcode == 0x8:
                return None
            if opcode == 0x9:
                self._frame(0xA, payload)
                continue
            if opcode == 0xA:
                continue
            message += payload
            if fin:
                return message.decode("utf-8")

    def close(self) -> None:
        try:
            self._frame(0x8, b"")
        except OSError:
            pass
        self.sock.close()


# ----------------------------------------------------------------------------------------------
# Building views. Callbacks become refs while rendering; refs come from ids/titles so they stay
# the same between renders.

_ctx: Optional[Dict[str, Any]] = None


def _slug(s: Any) -> str:
    return re.sub(r"^-|-$", "", re.sub(r"[^a-z0-9]+", "-", str(s or "").lower()))[:40]


def _bind(fn: Optional[Callable], hint: str) -> Optional[str]:
    if fn is None:
        return None
    if _ctx is None:
        raise RuntimeError("UI elements with callbacks must be built inside a render function")
    seen = _ctx["seen"]
    seen[hint] = seen.get(hint, 0) + 1
    ref = hint if seen[hint] == 1 else f"{hint}#{seen[hint]}"
    _ctx["handlers"][ref] = fn
    return ref


def _id(kind: str, title: Any, given: Optional[str]) -> str:
    if given:
        return str(given)
    base = f"{kind}-{_slug(title) or 'x'}"
    if _ctx is None:
        return base
    ids = _ctx["ids"]
    ids[base] = ids.get(base, 0) + 1
    return base if ids[base] == 1 else f"{base}-{ids[base]}"


def _clean(d: Dict[str, Any]) -> Dict[str, Any]:
    return {k: v for k, v in d.items() if v is not None}


def _act(title: Optional[str], on_tap: Optional[Callable], id: str, symbol: str = None, role: str = None, disabled: bool = None, confirm: str = None) -> Dict[str, Any]:
    ref = _bind(on_tap, f"a:{id}") or f"noop:{id}"
    return _clean({"ref": ref, "title": title, "symbol": symbol, "role": role, "disabled": disabled, "confirm": confirm})


class ui:
    """Builders for screens, sections and items (see PROTOCOL.md for every field)."""

    @staticmethod
    def icon(symbol: str, color: str = "blue", style: str = "tile") -> Dict[str, Any]:
        return {"symbol": symbol, "color": color, "style": style}

    @staticmethod
    def initials(text: str, color: str = "gray") -> Dict[str, Any]:
        return {"text": text, "color": color, "style": "circle"}

    @staticmethod
    def action(title: str, on_tap: Callable, symbol: str = None, role: str = None, id: str = None) -> Dict[str, Any]:
        return _act(title, on_tap, id or _slug(title) or "action", symbol=symbol, role=role)

    @staticmethod
    def menu(title: str, target: Any, symbol: str = None, checked: bool = None, role: str = None) -> Dict[str, Any]:
        if isinstance(target, list):
            return _clean({"title": title, "symbol": symbol, "children": target})
        return _clean({"title": title, "symbol": symbol, "action": _act(title, target, f"menu-{_slug(title)}"), "checked": checked, "role": role})

    @staticmethod
    def screen(title: str, content: List[Any] = (), id: str = None, style: str = None, subtitle: str = None, large_title: bool = None,
               actions: List[Dict] = None, menu: List[Dict] = None, bottom_bar: List[Dict] = None, empty: Dict = None,
               search: Dict = None, segments: Dict = None, composer: Dict = None, document: Dict = None,
               refresh: Callable = None, more: Callable = None) -> Dict[str, Any]:
        content = list(content)
        sections = content if content and isinstance(content[0], dict) and "items" in content[0] else [ui.section(content)]
        sid = id or f"screen-{_slug(title)}"
        s = _clean({"id": sid, "title": title, "subtitle": subtitle, "style": style, "largeTitle": large_title, "actions": actions, "menu": menu,
                    "bottomBar": bottom_bar, "empty": empty, "sections": [x for x in sections if x["items"]]})
        if search is not None:
            s["search"] = _clean({"ref": _bind(search.get("on_change"), f"search:{sid}") or f"search:{sid}", "placeholder": search.get("placeholder", "Search"),
                                  "value": search.get("value", ""), "submit": _act("Search", search["on_submit"], f"submit-{sid}") if search.get("on_submit") else None})
        if segments is not None:
            items = [{"id": c, "title": c} if isinstance(c, str) else c for c in segments["items"]]
            s["segments"] = _clean({"items": items, "selected": segments.get("selected"), "ref": _bind(segments.get("on_change"), f"segments:{sid}")})
        if composer is not None:
            s["composer"] = _clean({"ref": _bind(composer.get("on_send"), f"send:{sid}") or f"send:{sid}", "placeholder": composer.get("placeholder", "Message"),
                                    "attach": _act("Attach", composer["on_attach"], f"attach-{sid}", symbol="plus") if composer.get("on_attach") else None})
        if document is not None:
            s["document"] = _clean({"text": document.get("text", ""), "ref": _bind(document.get("on_change"), f"doc:{sid}"), "format": document.get("format")})
        if refresh:
            s["refresh"] = _act("Refresh", refresh, f"refresh-{sid}")
        if more:
            s["more"] = _act("More", more, f"more-{sid}")
        return s

    @staticmethod
    def section(header_or_items: Any, items: List[Any] = None, footer: str = None, style: str = None, id: str = None) -> Dict[str, Any]:
        if isinstance(header_or_items, list):
            header, items = None, header_or_items
        else:
            header, items = header_or_items, items or []
        flat: List[Dict] = []
        for x in items:
            if isinstance(x, list):
                flat.extend(i for i in x if i)
            elif x:
                flat.append(x)
        return _clean({"id": id or f"section-{_slug(header or (flat[0]['id'] if flat else 'main'))}", "header": header, "footer": footer, "style": style, "items": flat})

    @staticmethod
    def nav(title: str, on_tap: Callable, subtitle: str = None, value: str = None, icon: Dict = None, badge: str = None, id: str = None) -> Dict[str, Any]:
        i = _id("nav", title, id)
        return _clean({"id": i, "kind": "nav", "title": title, "subtitle": subtitle, "value": value, "icon": icon, "badge": badge, "tap": _act(title, on_tap, i)})

    @staticmethod
    def toggle(title: str, on: bool, on_change: Callable[[bool], Any], subtitle: str = None, icon: Dict = None, disabled: bool = None, id: str = None) -> Dict[str, Any]:
        i = _id("toggle", title, id)
        return _clean({"id": i, "kind": "toggle", "title": title, "subtitle": subtitle, "icon": icon, "on": bool(on), "ref": _bind(on_change, f"t:{i}") or f"noop:{i}", "disabled": disabled})

    @staticmethod
    def choice(title: str, options: List[Any], selected: Optional[str], on_change: Callable[[str], Any], style: str = None, id: str = None) -> Dict[str, Any]:
        i = _id("choice", title, id)
        opts = [{"id": o, "title": o} if isinstance(o, str) else o for o in options]
        chosen = next((o for o in opts if o["id"] == selected), None)
        return _clean({"id": i, "kind": "choice", "title": title, "value": chosen["title"] if chosen else None, "options": opts, "selected": selected,
                       "ref": _bind(on_change, f"c:{i}") or f"noop:{i}", "style": style})

    @staticmethod
    def slider(title: str, value: float, on_change: Callable[[float], Any], min: float = 0, max: float = 100, step: float = None, id: str = None) -> Dict[str, Any]:
        i = _id("slider", title, id)
        return _clean({"id": i, "kind": "slider", "title": title, "min": min, "max": max, "step": step, "value": value, "ref": _bind(on_change, f"s:{i}") or f"noop:{i}"})

    @staticmethod
    def stepper(title: str, value: float, on_change: Callable[[float], Any], min: float = None, max: float = None, step: float = None, id: str = None) -> Dict[str, Any]:
        i = _id("stepper", title, id)
        return _clean({"id": i, "kind": "stepper", "title": title, "value": value, "min": min, "max": max, "step": step, "ref": _bind(on_change, f"n:{i}") or f"noop:{i}"})

    @staticmethod
    def field(title: Optional[str], value: str, on_change: Callable[[str], Any], placeholder: str = None, secure: bool = None, multiline: bool = None,
              keyboard: str = None, on_submit: Callable = None, id: str = None) -> Dict[str, Any]:
        i = _id("field", title or placeholder, id)
        return _clean({"id": i, "kind": "field", "title": title, "placeholder": placeholder, "value": value or "", "ref": _bind(on_change, f"f:{i}") or f"noop:{i}",
                       "secure": secure, "multiline": multiline, "keyboard": keyboard, "submit": _act("Go", on_submit, f"submit-{i}") if on_submit else None})

    @staticmethod
    def button(title: str, on_tap: Callable, style: str = None, role: str = None, symbol: str = None, confirm: str = None, id: str = None) -> Dict[str, Any]:
        i = _id("button", title, id)
        return _clean({"id": i, "kind": "button", "action": _act(title, on_tap, i, symbol=symbol, role=role, confirm=confirm), "style": style})

    @staticmethod
    def check(title: str, on: bool, on_change: Callable[[bool], Any], subtitle: str = None, radio: bool = None, id: str = None) -> Dict[str, Any]:
        i = _id("check", title, id)
        return _clean({"id": i, "kind": "check", "title": title, "subtitle": subtitle, "on": bool(on), "ref": _bind(on_change, f"k:{i}") or f"noop:{i}", "radio": radio})

    @staticmethod
    def text(text: Any, style: str = None, label: str = None, copyable: bool = None, id: str = None) -> Dict[str, Any]:
        return _clean({"id": _id("text", label or text, id), "kind": "text", "text": str(text), "style": style, "label": label, "copyable": copyable})

    @staticmethod
    def label(label: str, value: Any, id: str = None) -> Dict[str, Any]:
        return ui.text(value, label=label, id=id)

    @staticmethod
    def heading(text: str, level: int = 2, id: str = None) -> Dict[str, Any]:
        return {"id": _id("heading", text, id), "kind": "heading", "text": text, "level": level}

    @staticmethod
    def paragraph(text: str, bullet: str = None, quote: bool = None, id: str = None) -> Dict[str, Any]:
        return _clean({"id": _id("para", text, id), "kind": "paragraph", "runs": [{"text": text}], "bullet": bullet, "quote": quote})

    @staticmethod
    def image(image: str, caption: str = None, aspect: float = None, on_tap: Callable = None, id: str = None) -> Dict[str, Any]:
        i = _id("image", caption or "image", id)
        return _clean({"id": i, "kind": "image", "image": image, "caption": caption, "aspect": aspect, "tap": _act("Open", on_tap, i) if on_tap else None})

    @staticmethod
    def progress(value: Optional[float], title: str = None, label: str = None, id: str = None) -> Dict[str, Any]:
        return _clean({"id": _id("progress", title, id), "kind": "progress", "title": title, "value": value, "label": label})

    @staticmethod
    def item(title: str, subtitle: str = None, detail: str = None, meta: str = None, icon: Dict = None, on_tap: Callable = None, chevron: bool = None,
             unread: bool = None, checked: bool = None, swipe: List[Dict] = None, menu: List[Dict] = None, id: str = None) -> Dict[str, Any]:
        i = _id("item", title, id)
        sw = [_act(s["title"], s.get("on_tap"), f"{i}-s{n}", symbol=s.get("symbol"), role=s.get("role")) for n, s in enumerate(swipe or [])] or None
        return _clean({"id": i, "kind": "item", "title": title, "subtitle": subtitle, "detail": detail, "meta": meta, "icon": icon, "chevron": chevron, "unread": unread,
                       "checked": checked, "tap": _act(title, on_tap, i) if on_tap else None, "swipe": sw, "menu": menu})

    @staticmethod
    def tile(title: str, icon: Dict = None, image: str = None, subtitle: str = None, on_tap: Callable = None, id: str = None) -> Dict[str, Any]:
        i = _id("tile", title, id)
        return _clean({"id": i, "kind": "tile", "title": title, "subtitle": subtitle, "icon": icon, "image": image, "tap": _act(title, on_tap, i) if on_tap else None})

    @staticmethod
    def message(text: str, author: str = None, time: str = None, outgoing: bool = None, avatar: Dict = None, system: bool = None, id: str = None) -> Dict[str, Any]:
        return _clean({"id": _id("msg", f"{author or ''}{time or ''}{text}"[:30], id), "kind": "message", "text": text, "author": author, "time": time,
                       "outgoing": outgoing, "avatar": avatar, "system": system})

    @staticmethod
    def record(title: str, fields: Any, on_tap: Callable = None, id: str = None) -> Dict[str, Any]:
        i = _id("record", title, id)
        pairs = [{"label": k, "value": str(v)} for k, v in fields.items()] if isinstance(fields, dict) else fields
        return _clean({"id": i, "kind": "record", "title": title, "fields": pairs, "tap": _act(title, on_tap, i) if on_tap else None})

    @staticmethod
    def buttons(items: List[Dict], id: str = None) -> Dict[str, Any]:
        i = _id("buttons", "-".join(b["title"] for b in items), id)
        return {"id": i, "kind": "buttons", "actions": [_act(b["title"], b.get("on_tap"), f"{i}-{n}", symbol=b.get("symbol"), role=b.get("role")) for n, b in enumerate(items)]}

    @staticmethod
    def profile(title: str, subtitle: str = None, icon: Dict = None, on_tap: Callable = None, id: str = None) -> Dict[str, Any]:
        i = _id("profile", title, id)
        return _clean({"id": i, "kind": "profile", "title": title, "subtitle": subtitle, "icon": icon, "tap": _act(title, on_tap, i) if on_tap else None})

    @staticmethod
    def divider() -> Dict[str, Any]:
        return {"id": _id("divider", "d", None), "kind": "divider"}


# ----------------------------------------------------------------------------------------------


def _call(fn: Callable, value: Any) -> Any:
    """Call a handler with the value if it takes an argument (on_tap handlers usually don't)."""
    try:
        takes = len(inspect.signature(fn).parameters) > 0
    except (TypeError, ValueError):
        takes = True
    return fn(value) if takes else fn()


class PhoneApp:
    """A program shown on the phone. `render(app)` returns a screen; call `update()` when state changes."""

    def __init__(self, id: str, name: str, render: Callable[["PhoneApp"], Dict] = None, icon: Dict = None, tint: str = None, description: str = None):
        self.info = _clean({"id": id, "name": name, "icon": icon, "tint": tint, "description": description})
        self.stack: List[Callable] = [render] if render else []
        self._sheet: Optional[Callable] = None
        self._alert: Optional[Dict] = None
        self.handlers: Dict[str, Callable] = {}
        self.viewers = 0
        self._ws: Optional[_WebSocket] = None
        self._closed = False
        self._listeners: Dict[str, List[Callable]] = {"open": [], "close": [], "refresh": []}
        self._lock = threading.RLock()

    def render(self, fn: Callable[["PhoneApp"], Dict]) -> "PhoneApp":
        self.stack[:1] = [fn]
        self.update()
        return self

    def push(self, fn: Callable[["PhoneApp"], Dict]) -> None:
        self.stack.append(fn)
        self.update()

    def pop(self) -> None:
        if len(self.stack) > 1:
            self.stack.pop()
        self.update()

    def sheet(self, fn: Callable[["PhoneApp"], Dict]) -> None:
        self._sheet = fn
        self.update()

    def close_sheet(self) -> None:
        self._sheet = None
        self.update()

    def alert(self, title: str, message: str = None, actions: List[Dict] = None) -> None:
        self._alert = {"title": title, "message": message, "actions": actions or [{"title": "OK"}]}
        self.update()

    def toast(self, text: str) -> None:
        self._send({"type": "toast", "text": str(text)})

    def on(self, event: str, fn: Callable) -> "PhoneApp":
        self._listeners[event].append(fn)
        return self

    def view(self) -> Dict[str, Any]:
        global _ctx
        with self._lock:
            _ctx = {"handlers": {}, "seen": {}, "ids": {}}
            try:
                screens = []
                for n, fn in enumerate(self.stack):
                    s = fn(self)
                    s["id"] = f"{n}:{s.get('id', s['title'])}"
                    screens.append(s)
                view: Dict[str, Any] = {"screens": screens}
                if self._sheet:
                    view["sheet"] = self._sheet(self)
                if self._alert:
                    a = self._alert

                    def chooser(spec):
                        def run():
                            self._alert = None
                            if spec.get("on_tap"):
                                _call(spec["on_tap"], None)
                        return run

                    view["alert"] = _clean({"title": a["title"], "message": a.get("message"),
                                            "actions": [_act(x["title"], chooser(x), f"alert-{n}", role=x.get("role")) for n, x in enumerate(a["actions"])]})
                self.handlers = _ctx["handlers"]
                return view
            finally:
                _ctx = None

    def update(self) -> None:
        if self._ws and self.stack:
            self._send({"type": "view", "view": self.view()})

    def _send(self, msg: Dict) -> None:
        ws = self._ws
        if ws:
            try:
                ws.send(json.dumps(msg))
            except OSError:
                pass

    def _handle(self, msg: Dict) -> None:
        kind = msg.get("type")
        if kind == "welcome":
            self._send({"type": "hello", "protocol": PROTOCOL_VERSION, "app": self.info})
            self.update()
        elif kind == "open":
            self.viewers = msg.get("viewers", 1)
            for fn in self._listeners["open"]:
                fn()
            self.update()
        elif kind == "close":
            self.viewers = 0
            for fn in self._listeners["close"]:
                fn()
        elif kind == "action":
            fn = self.handlers.get(msg.get("ref"))
            if fn:
                try:
                    _call(fn, msg.get("value"))
                except Exception as err:  # show app errors on the phone instead of dying
                    self.toast(str(err))
            self.update()
        elif kind == "pop":
            depth = max(1, int(msg.get("depth", 1)))
            del self.stack[depth:]
            self.update()
        elif kind == "dismiss":
            self._sheet = None
            self._alert = None
            self.update()
        elif kind == "refresh":
            for fn in self._listeners["refresh"]:
                fn()
            self.update()

    def run(self, target: Dict[str, str] = None, background: bool = False) -> None:
        """Connect and serve the phone forever (reconnecting as needed). background=True returns at once."""
        if background:
            threading.Thread(target=self.run, kwargs={"target": target}, daemon=True).start()
            return
        target = target or discover()
        sep = "&" if "?" in target["url"] else "?"
        url = f"{target['url']}{sep}token={quote(target['token'])}"
        delay = 0.5
        while not self._closed:
            try:
                self._ws = _WebSocket(url)
                delay = 0.5
                while not self._closed:
                    text = self._ws.recv()
                    if text is None:
                        break
                    try:
                        self._handle(json.loads(text))
                    except ValueError:
                        pass
            except (OSError, ConnectionError):
                pass
            finally:
                if self._ws:
                    self._ws.close()
                self._ws = None
            if not self._closed:
                time.sleep(delay)
                delay = min(delay * 2, 10)

    def close(self) -> None:
        self._closed = True
        if self._ws:
            self._ws.close()
