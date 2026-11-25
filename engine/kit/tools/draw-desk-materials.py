from PIL import Image
import numpy as np
from pathlib import Path
dest=Path('engine/kit/showcase/materials')
# One uninterrupted slice of crotch walnut, with broad growth rings and much finer pores.
y,x=np.mgrid[0:320,0:1024]; rng=np.random.default_rng(442)
warp=10*np.sin(x/200+y/62)+5*np.sin(x/99+y/47)+2*np.sin(x/57+y/35)
ring=y+warp+.001*(x-460)**2/15
g=6*np.sin(ring*.29)+3*np.sin(ring*1.5)+3*np.sin(ring*.85)+4*np.sin(ring*.061)+rng.normal(0,2.1,x.shape)
rgb=np.stack([150+g*1.24,99+g,63+g*.8],axis=2)
Image.fromarray(np.uint8(rgb.clip(0,255))).save(dest/'walnut.jpg',quality=88)
# Contour intervals of a folded field, drawn once like ink on woven fabric.
y,x=np.mgrid[0:680,0:1200]; f=(np.sin(x/169+y/183)*1.8+np.sin(x/115-y/117)*.58+np.cos(y/87+x/220)*.54+np.sin(x/52+y/91)*.13)
phase=f*7; dist=abs(phase-np.rint(phase)); grad=np.hypot(*np.gradient(phase))
a=np.uint8(np.clip(1-dist/(grad*.86+.0002),0,1)*105)
im=Image.new('RGBA',(1200,680),(206,220,185)); im.putalpha(Image.fromarray(a)); im.save(dest/'contours.png',optimize=True)
