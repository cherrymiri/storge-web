"""Bundle dist/ into ONE self-contained HTML (font, GLB, CSS, JS inlined) for hosting
as a claude.ai artifact or opening by double-click. Run after `npm run build`:
    python3 scripts/make-single-html.py dist out/STORGE.html
"""
import base64, glob, os, re, sys

dist, out = sys.argv[1], sys.argv[2]
b64 = lambda p: base64.b64encode(open(p, 'rb').read()).decode()

html = open(os.path.join(dist, 'index.html'), encoding='utf-8').read()
css_path = glob.glob(os.path.join(dist, 'assets', 'index-*.css'))[0]
js_path = glob.glob(os.path.join(dist, 'assets', 'index-*.js'))[0]
css = open(css_path, encoding='utf-8').read()
js = open(js_path, encoding='utf-8').read()

font = glob.glob(os.path.join(dist, 'assets', 'PretendardVariable-*.woff2'))[0]
css = re.sub(r'url\(\./PretendardVariable-[^)]+\.woff2\)', f'url(data:font/woff2;base64,{b64(font)})', css)
glb = os.path.join(dist, 'models', 'STORGE_MusicBox.glb')
glb_b64 = b64(glb)   # decoded in script by MusicBox.load (no fetch -> works under strict CSP)
js = js.replace('</script', '<\\/script')

title = re.search(r'<title>(.*?)</title>', html, re.S).group(1)
body = re.search(r'<body>(.*)</body>', html, re.S).group(1)
body = re.sub(r'<script[^>]*src="[^"]*"[^>]*></script>', '', body)

page = f"""<title>STORGE 가족의 사랑</title>
<meta name="theme-color" content="#000000" />
<style>
:root {{ color-scheme: dark; }}
{css}
</style>
{body.strip()}
<script>window.__STORGE_GLB_B64 = "{glb_b64}";</script>
<script type="module">
{js}
</script>
"""
os.makedirs(os.path.dirname(out) or '.', exist_ok=True)
open(out, 'w', encoding='utf-8').write(page)
print(out, round(len(page.encode()) / 1024 / 1024, 2), 'MB')
