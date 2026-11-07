# 部署说明

这个项目是**纯静态站点**：没有构建步骤、没有后端、没有运行时依赖。
仓库里的 `public/` 目录就是最终要发布的内容。

---

## 方式一：一键上传到 GitHub（本机脚本）

前置：有 GitHub 账号、电脑能上网。脚本会检查 git 是否装好。

```powershell
# 在仓库根目录执行
powershell -ExecutionPolicy Bypass -File scripts/upload.ps1
```

脚本会做四件事：

1. 检查 git、Node 是否可用
2. 问你要一个 **Personal Access Token**
3. 调用 GitHub API 建仓库（默认私有）
4. `git push` 把代码推上去

### 拿 Token（只需一次）

1. 打开 <https://github.com/settings/tokens>
2. 点 **Generate new token (classic)**
3. Note 随便写（比如 `fitcheck-upload`），Expiration 选 30 天
4. 勾上 **`repo`** 这一个权限就够了
5. 生成后复制那串 `ghp_...`，**只显示一次**

> 安全提示：Token 等同于密码。脚本只在本次运行中用一次，不会写进仓库和配置文件。
> 用完建议到同一页面 **Revoke** 掉。
>
> 如果你想要更细的权限，也可以用 Fine-grained token，勾选：
> `Repository permissions → Contents: Read and write`，
> 以及 `Account permissions → Administration: Read and write`（用于创建仓库）。

---

## 方式二：手动上传（不碰命令行）

1. 打开 <https://github.com/new>
2. 仓库名填 `fitcheck`（或你喜欢的），**Public** 或 Private 都行
3. **不要**勾选 "Add a README"
4. 创建后，页面上会有 "uploading an existing file" 的链接，把 `public/` 里的文件拖进去

> 拖拽上传比较适合文件少的项目。这个项目有 20 来个文件，
> 建议还是用方式一或下面的手动 git 命令。

---

## 方式三：手动 git 命令

```bash
cd fitcheck

git init
git add .
git commit -m "feat: 尺码助手 v1.0.0"

# 换成你的用户名和仓库名
git remote add origin https://github.com/<你的用户名>/fitcheck.git

# 推 main
git branch -M main
git push -u origin main
```

首次 push 时 git 会弹窗让你登录 GitHub（或要 token）。

---

## 开启 GitHub Pages

仓库推上去之后：

1. 进仓库 → **Settings** → 左侧 **Pages**
2. **Source** 选 `Deploy from a branch`
3. **Branch** 选 `main`，目录选 **`/docs`** 不行，要选 **`/ (root)`**
4. 但站点在 `public/` 子目录里，所以需要额外一步，见下

### 让 Pages 指向 `public/`

GitHub Pages 的 "root" 指的是**仓库根目录**，而我们的站点在 `public/`。
有两个办法，任选其一：

**办法 A：改用一个 workflow（推荐，最省心）**

仓库里已经放好了 `.github/workflows/pages.yml`。
推上去后：

1. Settings → Pages → **Source** 选 **`GitHub Actions`**
2. 下次 push 会自动发布 `public/` 目录

**办法 B：手动建分支**

```bash
cd fitcheck
git subtree push --prefix public origin gh-pages
```

然后把 Pages 的 Branch 设成 `gh-pages` / `root`。

发布后的地址形如：

```
https://<你的用户名>.github.io/fitcheck/
```

### 验证

打开页面，在 Chrome/Edge 地址栏右侧应该能看到**安装图标**（⊕），
说明 PWA manifest 生效了。手机上用浏览器打开后选「添加到主屏幕」。

---

## 其他托管

`public/` 目录可以直接部署到：

| 平台 | 做法 |
| --- | --- |
| Cloudflare Pages | 构建命令留空，输出目录填 `public` |
| Netlify | Publish directory 填 `public` |
| Vercel | Framework 选 Other，Output 填 `public` |
| 对象存储 / NAS | 整个 `public/` 上传即可，注意 mime 类型 |

> **必须 HTTPS**，否则 Service Worker 和「添加到主屏幕」不生效
> （`localhost` 和 `127.0.0.1` 例外）。

---

## 更新站点

改完代码后：

```bash
git add .
git commit -m "fix: 说明改了什么"
git push
```

如果用了 GitHub Actions，几十秒后自动生效。

**注意**：如果你改了需要预缓存的静态资源，记得把 `public/sw.js` 里的
`VERSION` 改一下（比如 `v1.0.0` → `v1.0.1`），否则老用户可能一直用缓存。
