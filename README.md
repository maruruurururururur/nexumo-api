# NEXUMO API (backend serverless para Vercel)

Express en una sola función (`api/index.js`). Tokens de descarga firmados
(HMAC, sin estado) + precios validados en servidor.

## Subir a GitHub + Vercel (CMD)

```bat
cd C:\Users\maru\Desktop\M\mi-tienda\nexumo-api
git init
git add -A
git commit -m "nexumo-api: backend serverless"
git branch -M main
git remote add origin https://github.com/maruruurururururur/nexumo-api.git
git push -u origin main
```

Antes: crea el repo vacío `nexumo-api` en https://github.com/new
(sin README, sin .gitignore).

En Vercel: New Project → Import `nexumo-api` → Framework `Other` →
Root `./` → pega las Environment Variables de `.env.example`
(con tus valores reales) → Deploy. La URL será algo como
`https://nexumo-api.vercel.app`.

## Probar en local

```bat
cd nexumo-api
npm install
copy ..\thema-shopify\server\.env .env
node local.js
```

Salud: http://localhost:3100/api/health
