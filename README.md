# Mesh Viewer

A small three.js viewer for 3D models: glTF/GLB, OBJ (+MTL), FBX, STL and PLY.
It opens with an animated fox. You can also drag and drop your own files.

## Run locally

```sh
npm install
npm run dev        # http://localhost:5173
npm run build      # static site in dist/
```

## Deploy to GitHub Pages

1. Push this repo to GitHub on the `main` branch.
2. In the repo, open **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Each push to `main` runs `.github/workflows/deploy.yml`, which builds the site and publishes it to `https://<user>.github.io/<repo>/`.

`vite.config.js` uses a relative `base: './'`, so the site works under any repo name.

Commit models as regular files, not Git LFS. GitHub Pages serves LFS pointer files instead of the actual content.

## Assets

From [Khronos glTF Sample Assets](https://github.com/KhronosGroup/glTF-Sample-Assets):

- **Fox** (`public/models/Fox.glb`): model by PixelMannen (CC0 1.0), rigging and animation by tomkranis ([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)), glTF conversion by AsoboStudio and scurest (CC BY 4.0).
- **Damaged Helmet** (`public/models/DamagedHelmet.glb`): original model by theblueturtle_ ([CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/), **non-commercial**), rebuild and glTF conversion by ctxwing (CC BY 4.0).
