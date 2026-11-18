# Put the Vox Block and Vox Sign web fonts into the kit's stylesheet as data URIs. Run after rebuilding them.
import base64, re, subprocess
p = 'css/_kit.css'; s = open(p).read()
for fam, path in [('Vox Block', 'vox-block/vox-block-400-normal.woff2'), ('Vox Sign', 'vox-sign/vox-sign-400-normal.woff2')]:
    b = base64.b64encode(open('fonts/' + path, 'rb').read()).decode()
    pat = re.compile(r'@font-face \{ font-family: "%s"; src: [^}]*\}' % re.escape(fam))
    s = pat.sub('@font-face { font-family: "%s"; src: url("data:font/woff2;base64,%s") format("woff2"); font-weight: 400; font-display: block; }' % (fam, b), s, count=1)
open(p, 'w').write(s)
subprocess.run(['node', 'tools/css.mjs'], check=True)
print('inlined')
