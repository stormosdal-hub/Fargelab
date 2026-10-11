import cv2
import numpy as np

img         = cv2.imread('stack_2.png')
img_gray    = cv2.cvtColor(img, cv2.BGR2GRAY)


cv2.imshow("bilde", img_gray)
