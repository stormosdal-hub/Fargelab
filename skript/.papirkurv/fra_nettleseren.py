# Gråtone og cv2.threshold på bildet fra Fargelab-fanen (eller testbildet)
import cv2
import fargelab

img = cv2.imread(fargelab.bilde or "eksempel.png")
gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

thresh, maxval = 127, 255
_, binary = cv2.threshold(gray, thresh, maxval, cv2.THRESH_BINARY)

# Med THRESH_OTSU finner OpenCV en terskel selv
otsu_t, otsu = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
print("Otsu valgte terskelen", otsu_t)

cv2.imshow("Gråtone", gray)
cv2.imshow(f"Binær, thresh = {thresh}", binary)
cv2.imshow(f"Otsu, thresh = {otsu_t:.0f}", otsu)
