# Makes OCRTests' pictures in Tests/DigUpKitTests/Pictures: screenshot-text.png, a made-up 1280×420 screenshot of notes
# and a terminal, in UI-sized text (16 and 15 pixels), and scan.pdf, an A4 page that is only a picture of a line of text
# (150 dpi, as a scanner makes it; ScannedPDF in TextPDF.swift draws the same on a Mac). Needs Pillow and the DejaVu
# fonts (Ubuntu's fonts-dejavu-core):
#   python3 scripts/testbed/make_ocr_picture.py Tests/DigUpKitTests/Pictures
import sys
from PIL import Image, ImageDraw, ImageFont

fonts = "/usr/share/fonts/truetype/dejavu/"
sans = ImageFont.truetype(fonts + "DejaVuSans.ttf", 16)
mono = ImageFont.truetype(fonts + "DejaVuSansMono.ttf", 15)
image = Image.new("RGB", (1280, 420), "white")
draw = ImageDraw.Draw(image)
draw.rectangle((0, 0, 1280, 36), fill=(236, 236, 236))
draw.text((20, 9), "Notes — March budget review", font=sans, fill=(40, 40, 40))
lines = [
    "Invoice 4417 from the hardware store was paid on Tuesday.",
    "The payment for the Kyoto trip was declined twice; call the bank before Friday.",
    "Priya will send the meeting notes and the travel draft after lunch.",
]
for index, line in enumerate(lines):
    draw.text((20, 60 + index * 30), line, font=sans, fill=(30, 30, 30))
draw.rectangle((0, 180, 1280, 420), fill=(30, 30, 30))
terminal = [
    "$ pip install requests",
    "error: externally-managed-environment",
    "This environment is externally managed. To install packages, use a virtual environment.",
]
for index, line in enumerate(terminal):
    draw.text((20, 200 + index * 26), line, font=mono, fill=(230, 230, 230))
folder = sys.argv[1].rstrip("/")
image.save(folder + "/screenshot-text.png", optimize=True)

scan = Image.new("L", (1240, 1754), 255)
ImageDraw.Draw(scan).text((100, 160), "Invoice QXTEST87231. Payment due Friday.",
                          font=ImageFont.truetype(fonts + "DejaVuSans.ttf", 36), fill=0)
scan.save(folder + "/scan.pdf", resolution=150)
