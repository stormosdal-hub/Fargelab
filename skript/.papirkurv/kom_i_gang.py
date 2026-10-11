# Kom i gang: Python med OpenCV, numpy og matplotlib, rett i nettleseren.
# Trykk Kjør (eller Ctrl+Enter). Det du skriver ut med print() havner under Utdata.
# Ctrl+S lagrer filen i mappen skript/ i prosjektet.
import os
import sys
import cv2
import numpy as np

print("Python", sys.version.split()[0])
print("OpenCV", cv2.__version__)
print("numpy", np.__version__)

# Alt i mappen bilder/ ligger der skriptet kjører, så du trenger ikke skrive stien.
print("Filer du kan åpne:", sorted(os.listdir()))

img = cv2.imread("eksempel.png")
print("eksempel.png har formen", img.shape, "(høyde, bredde, kanaler)")

# Samme konvertering som i Fargelab-fanen, for pikselen midt i den røde sirkelen
piksel = img[170:171, 110:111]   # et bilde på 1 × 1 piksel
hsv = cv2.cvtColor(piksel, cv2.COLOR_BGR2HSV)
print("BGR", piksel[0, 0], "-> HSV", hsv[0, 0])

# cv2.imshow viser bildet under Utdata
cv2.imshow("eksempel.png", img)
