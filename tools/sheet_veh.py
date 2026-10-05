import sys
from PIL import Image
k=sys.argv[1]; out=sys.argv[2]
names=['albedo','normal','rough','emit','ao','meta']
S=340
ims=[Image.open(f'build/veh/{k}_{n}.png').convert('RGB').resize((S,S)) for n in names]
sheet=Image.new('RGB',(S*3,S*2))
for i,im in enumerate(ims): sheet.paste(im,((i%3)*S,(i//3)*S))
sheet.save(out)
