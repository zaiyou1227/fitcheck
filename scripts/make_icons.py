import os
from PIL import Image

base = r"C:\Users\liubin\Projects\fitcheck-dachu\public\icons"
src = Image.open(os.path.join(base, "icon-512.png")).convert("RGBA")

# 统一尺寸
src = src.resize((512, 512), Image.LANCZOS)
src.save(os.path.join(base, "icon-512.png"), "PNG")

for size in (192, 180):
    img = src.resize((size, size), Image.LANCZOS)
    name = "icon-192.png" if size == 192 else "apple-touch-icon.png"
    img.save(os.path.join(base, name), "PNG")
    print(name, img.size, os.path.getsize(os.path.join(base, name)))

# 顺带生成一个 favicon 小图
src.resize((64, 64), Image.LANCZOS).save(os.path.join(base, "favicon-64.png"), "PNG")
print("favicon-64.png ok")
