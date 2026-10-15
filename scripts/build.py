"""Copy only the public site files into dist/ (no .env, scripts, notes)."""
import os, shutil
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'dist')
shutil.rmtree(OUT, ignore_errors=True)
os.makedirs(OUT)
shutil.copy(os.path.join(ROOT, 'index.html'), OUT)
for d in ('css', 'js', 'data'):
    shutil.copytree(os.path.join(ROOT, d), os.path.join(OUT, d))
print('built', OUT)
