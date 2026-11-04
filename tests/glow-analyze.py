import json, sys, numpy as np
from PIL import Image
D=sys.argv[1]
R=json.load(open(f'{D}/glow_curve_report.json'))
def lum(p): a=np.asarray(Image.open(p).convert('RGB')).astype(float)/255; return a, a@[0.2126,0.7152,0.0722]
def smooth(v,k=5): return np.convolve(v,np.ones(k)/k,mode='same')
def peaks(prof):
    s=smooth(prof); pk=s.max(); n=0
    for i in range(2,len(s)-2):
        if s[i]==max(s[i-2:i+3]) and s[i]>0.5*pk:
            l=s[max(0,i-20):i].min(); r=s[i+1:i+21].min()
            if s[i]-max(l,r)>0.08: n+=1
    return n
CSSW={'pc':1600,'mobile':390}
for tag in ('pc','mobile'):
    info=R[tag]; b=info['box']
    on,lon=lum(f'{D}/{tag}_glow_on.png'); off,loff=lum(f'{D}/{tag}_glow_off.png')
    sc=on.shape[1]/CSSW[tag]
    print(f'== {tag}  layout={info["layout"]}  console errors={len(info["errors"])}  bloom pass={info["composerOk"] and info["bloomPassOk"]}')
    print(f'  thread geometry radius {info["radius"]*1000} mm -> {info["threadDiameterCssPx"]} css px wide')
    x0=int((b['x0']+(b['x1']-b['x0'])*0.08)*sc); x1=int((b['x0']+(b['x1']-b['x0'])*0.6)*sc)
    y0=int((b['y0']+(b['y1']-b['y0'])*0.15)*sc); y1=int((b['y0']+(b['y1']-b['y0'])*0.85)*sc)
    d=np.abs(on[y0:y1,x0:x1]-off[y0:y1,x0:x1])*255
    print(f'  music box glow on vs off: mean {d.mean():.2f}/255, 99th pct {np.percentile(d,99):.1f}/255')
    H,W=lon.shape
    idx=[int(W*f) for f in (0.5,0.62,0.75)] if tag=='pc' else [int(H*f) for f in (0.4,0.55,0.7)]
    for i in idx:
        pon,poff,rgb,rgboff=(lon[:,i],loff[:,i],on[:,i],off[:,i]) if tag=='pc' else (lon[i,:],loff[i,:],on[i,:],off[i,:])
        k=int(np.argmax(pon)); g=int(round(15*sc))
        cw_on=(pon>0.6*pon.max()).sum(); cw_off=(poff>0.6*poff.max()).sum()
        print(f'  @{i}: core width off {cw_off}px / on {cw_on}px | peaks {peaks(pon[max(0,k-int(60*sc)):k+int(60*sc)])} | 15css px away lum {poff[k+g]:.2f}->{pon[k+g]:.2f} | centre RGB off {tuple(int(x) for x in rgboff[k]*255)} on {tuple(int(x) for x in rgb[k]*255)} | halo RGB {tuple(int(x) for x in rgb[k+g]*255)}')
print('== curves')
for m,v in R['curves'].items(): print(f'  {m}:  (amplitude ratio now/previous = {v["amplitudeRatio"]})\n    stage1   {v["stage1"]}\n    previous {v["previous"]}\n    now      {v["now"]}')
