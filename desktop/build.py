"""Gera o dist/DesafioBobRoll.exe (versão offline para eventos).

Rode de novo depois de mudar o jogo para regenerar o .exe:
    python desktop/build.py
Requer: pip install pyinstaller pillow
"""
import os
import subprocess
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
GAME_FILES = [
    "index.html", "style.css", "game.js",
    "Novo-Logotipo-HiperRoll.png", "bobroll-sheet.png", "bobroll-icon.png",
]

icon_path = os.path.join(HERE, "icon.ico")
logo = Image.open(os.path.join(ROOT, "bobroll-icon.png")).convert("RGBA")
side = max(logo.size)
canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
canvas.paste(logo, ((side - logo.width) // 2, (side - logo.height) // 2), logo)
canvas.save(icon_path, sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])

cmd = [
    sys.executable, "-m", "PyInstaller", "--noconfirm", "--onefile", "--noconsole",
    "--name", "DesafioBobRoll", "--icon", icon_path,
    "--distpath", os.path.join(ROOT, "dist"),
    "--workpath", os.path.join(ROOT, "build"),
    "--specpath", os.path.join(ROOT, "build"),
]
for f in GAME_FILES:
    cmd += ["--add-data", f"{os.path.join(ROOT, f)}{os.pathsep}."]
cmd.append(os.path.join(HERE, "launcher.py"))
subprocess.check_call(cmd)
print("\nOK ->", os.path.join(ROOT, "dist", "DesafioBobRoll.exe"))
